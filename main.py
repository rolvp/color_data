import os
import csv
import traceback
from datetime import date
from typing import Optional, List

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Query, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from sqlalchemy.orm import Session
from io import BytesIO, StringIO

from database import engine, Base, get_db
from schemas import (
    SampleCreate, SampleUpdate, SampleListItem, SampleOut,
    MeasurementCreate, MeasurementBatchCreate, MeasurementUpdate, MeasurementOut, MeasurementListItem,
    PhotoOut, SearchResult,
)
import crud

app = FastAPI(title="颜色老化数据管理系统", version="1.0.0")

MT12_TEMPLATE_ANGLES = [
    "r45as-15",
    "r45as15",
    "r45as25",
    "r45as45",
    "r45as75",
    "r45as110",
]


def _ensure_sample_metadata_columns():
    with engine.begin() as conn:
        existing_columns = {
            row[1] for row in conn.exec_driver_sql("PRAGMA table_info(samples)").fetchall()
        }
        column_defs = {
            "other_info": "TEXT DEFAULT ''",
            "device_info": "TEXT DEFAULT ''",
            "test_device": "VARCHAR(100) DEFAULT ''",
            "measurement_test": "TEXT DEFAULT ''",
        }
        for column_name, column_def in column_defs.items():
            if column_name not in existing_columns:
                conn.exec_driver_sql(f"ALTER TABLE samples ADD COLUMN {column_name} {column_def}")


def _ensure_app_storage_ready():
    Base.metadata.create_all(bind=engine)
    _ensure_sample_metadata_columns()
    os.makedirs("uploads", exist_ok=True)
    os.makedirs("static", exist_ok=True)


_ensure_app_storage_ready()


# ============================================================
# Global Exception Handler (prevent 502 from unhandled errors)
# ============================================================

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch all unhandled exceptions and return a proper error response."""
    print(f"[ERROR] Unhandled exception on {request.method} {request.url.path}:")
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": f"服务器内部错误: {str(exc)}"},
    )


# ============================================================
# Startup
# ============================================================

@app.on_event("startup")
def on_startup():
    _ensure_app_storage_ready()


# ============================================================
# Sample Routes
# ============================================================

@app.get("/api/samples", response_model=List[SampleListItem])
def api_list_samples(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    return crud.list_samples(db, skip=skip, limit=limit)


@app.post("/api/samples", response_model=SampleOut, status_code=201)
def api_create_sample(data: SampleCreate, db: Session = Depends(get_db)):
    sample = crud.create_sample(db, data)
    return _enrich_sample(sample)


@app.get("/api/samples/{sample_id}", response_model=SampleOut)
def api_get_sample(sample_id: int, db: Session = Depends(get_db)):
    sample = crud.get_sample(db, sample_id)
    if not sample:
        raise HTTPException(status_code=404, detail="样品不存在")
    return _enrich_sample(sample)


@app.put("/api/samples/{sample_id}", response_model=SampleOut)
def api_update_sample(sample_id: int, data: SampleUpdate, db: Session = Depends(get_db)):
    sample = crud.update_sample(db, sample_id, data)
    return _enrich_sample(sample)


@app.delete("/api/samples/{sample_id}")
def api_delete_sample(sample_id: int, db: Session = Depends(get_db)):
    crud.delete_sample(db, sample_id)
    return {"ok": True, "message": "样品已删除"}


# ============================================================
# Measurement Routes
# ============================================================

@app.get("/api/samples/{sample_id}/measurements", response_model=List[MeasurementOut])
def api_list_measurements(sample_id: int, db: Session = Depends(get_db)):
    return crud.list_measurements(db, sample_id)


@app.get("/api/measurements", response_model=List[MeasurementListItem])
def api_list_all_measurements(db: Session = Depends(get_db)):
    return crud.list_all_measurements(db)


@app.post("/api/samples/{sample_id}/measurements", response_model=MeasurementOut, status_code=201)
def api_create_measurement(sample_id: int, data: MeasurementCreate, db: Session = Depends(get_db)):
    print(f"[DEBUG] Creating measurement: sample={sample_id}, device={data.device}, angle={data.angle}, L={data.L}, a={data.a}, b={data.b}")
    m = crud.create_measurement(db, sample_id, data)
    print(f"[DEBUG] Measurement created: id={m.id}, delta_E={m.delta_E}")
    enriched = _enrich_measurement(m, db)
    print(f"[DEBUG] Enriched: is_baseline={enriched.is_baseline}")
    return enriched


@app.post("/api/samples/{sample_id}/measurements/batch", response_model=List[MeasurementOut], status_code=201)
def api_create_measurements_batch(sample_id: int, data: MeasurementBatchCreate, db: Session = Depends(get_db)):
    """Batch create measurements for multi-angle devices (MT12)."""
    from datetime import datetime as dt
    date_val = data.measurement_date or dt.now()
    print(f"[DEBUG] Batch creating: sample={sample_id}, device={data.device}, aging={data.aging_hours}h, angles={len(data.entries)}")
    measurements = crud.create_measurements_batch(
        db, sample_id, date_val, data.device, data.aging_hours, "", data.entries
    )
    return [_enrich_measurement(m, db) for m in measurements]


@app.put("/api/measurements/{measurement_id}", response_model=MeasurementOut)
def api_update_measurement(measurement_id: int, data: MeasurementUpdate, db: Session = Depends(get_db)):
    print(f"[DEBUG] Updating measurement {measurement_id}: {data.model_dump(exclude_unset=True)}")
    m = crud.update_measurement(db, measurement_id, data)
    return _enrich_measurement(m, db)


@app.delete("/api/measurements/{measurement_id}")
def api_delete_measurement(measurement_id: int, db: Session = Depends(get_db)):
    crud.delete_measurement(db, measurement_id)
    return {"ok": True, "message": "测量记录已删除"}


# ============================================================
# Photo Routes
# ============================================================

@app.get("/api/samples/{sample_id}/photos", response_model=List[PhotoOut])
def api_list_photos(sample_id: int, db: Session = Depends(get_db)):
    return crud.list_photos_by_sample(db, sample_id)


@app.post("/api/samples/{sample_id}/photos", response_model=PhotoOut, status_code=201)
async def api_upload_photo(
    sample_id: int,
    file: UploadFile = File(...),
    measurement_id: Optional[int] = Form(None),
    notes: str = Form(""),
    db: Session = Depends(get_db),
):
    photo = crud.create_photo(db, sample_id, file, measurement_id, notes)
    return photo


@app.get("/api/photos/{photo_id}", response_model=PhotoOut)
def api_get_photo(photo_id: int, db: Session = Depends(get_db)):
    photo = crud.get_photo(db, photo_id)
    if not photo:
        raise HTTPException(status_code=404, detail="照片不存在")
    return photo


@app.get("/api/photos/{photo_id}/file")
def api_serve_photo(photo_id: int, db: Session = Depends(get_db)):
    photo = crud.get_photo(db, photo_id)
    if not photo:
        raise HTTPException(status_code=404, detail="照片不存在")
    filepath = os.path.join("uploads", photo.filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="照片文件不存在")
    return FileResponse(filepath, media_type="image/jpeg")


@app.delete("/api/photos/{photo_id}")
def api_delete_photo(photo_id: int, db: Session = Depends(get_db)):
    crud.delete_photo(db, photo_id)
    return {"ok": True, "message": "照片已删除"}


# ============================================================
# Import Route
# ============================================================

@app.post("/api/import")
async def api_import_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    # Validate file extension
    _, ext = os.path.splitext(file.filename or "")
    if ext.lower() not in {".xlsx", ".xls", ".csv"}:
        raise HTTPException(status_code=400, detail="仅支持 .xlsx、.xls 或 .csv 格式的文件")

    # Save temp file
    import tempfile
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        contents = await file.read()
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        result = crud.import_file(db, tmp_path, file.filename or "")
        return result
    finally:
        os.unlink(tmp_path)


@app.post("/api/import/preview")
async def api_import_preview(file: UploadFile = File(...)):
    _, ext = os.path.splitext(file.filename or "")
    if ext.lower() not in {".xlsx", ".xls", ".csv"}:
        raise HTTPException(status_code=400, detail="仅支持 .xlsx、.xls 或 .csv 格式的文件")

    import tempfile
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        contents = await file.read()
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        return crud.preview_import_file(tmp_path, file.filename or "")
    finally:
        os.unlink(tmp_path)


# ============================================================
# Search Route
# ============================================================

@app.get("/api/search", response_model=SearchResult)
def api_search(
    q: Optional[str] = Query(None, description="搜索关键词"),
    start_date: Optional[date] = Query(None, description="开始日期"),
    end_date: Optional[date] = Query(None, description="结束日期"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    results, total = crud.search_samples(db, q, start_date, end_date, skip, limit)
    return SearchResult(samples=results, total=total)


# ============================================================
# Chart Data Route
# ============================================================

@app.get("/api/samples/{sample_id}/chart")
def api_get_chart_data(sample_id: int, db: Session = Depends(get_db)):
    return crud.get_chart_data(db, sample_id)


@app.get("/api/samples/{sample_id}/upload-template")
def api_download_upload_template(sample_id: int, db: Session = Depends(get_db)):
    sample = crud.get_sample(db, sample_id)
    if not sample:
        raise HTTPException(status_code=404, detail="样品不存在")

    output = StringIO()
    writer = csv.writer(output, lineterminator="\n")
    headers = [
        "样品名称", "样品编号", "类别", "品牌", "型号", "颜色",
        "测试条件", "样品描述",
        "测量日期", "测试设备", "测量老化时间(小时)", "角度", "L*", "a*", "b*", "ΔE", "备注"
    ]
    writer.writerow(headers)

    base_row = [
        sample.name or "",
        sample.code or "",
        sample.category or "",
        sample.brand or "",
        sample.model or "",
        sample.color_name or "",
        sample.test_condition or "",
        sample.description or "",
    ]

    raw_test_device = (sample.test_device or "SP64").strip()
    normalized_test_device = raw_test_device.upper().replace("-", "")
    is_mt12 = normalized_test_device == "MT12"
    template_device = "MT12" if is_mt12 else (raw_test_device or "SP64")

    if is_mt12:
        for angle in MT12_TEMPLATE_ANGLES:
            writer.writerow(
                base_row + ["", template_device, "", angle, "", "", "", "", ""]
            )
    else:
        writer.writerow(base_row + ["", template_device, "", "", "", "", "", "", ""])

    filename_code = (sample.code or f"sample_{sample.id}").replace(" ", "_")
    csv_bytes = output.getvalue().encode("utf-8-sig")
    return StreamingResponse(
        BytesIO(csv_bytes),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="upload_data_template_for_{filename_code}.csv"'}
    )


# ============================================================
# Export Route
# ============================================================

@app.get("/api/samples/{sample_id}/export")
def api_export_sample(sample_id: int, db: Session = Depends(get_db)):
    sample = crud.get_sample(db, sample_id)
    if not sample:
        raise HTTPException(status_code=404, detail="样品不存在")

    excel_bytes = crud.export_to_excel(db, [sample_id])
    filename_code = (sample.code or f"sample_{sample.id}").replace(" ", "_")
    return StreamingResponse(
        BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=sample_data_{filename_code}.xlsx"}
    )

@app.get("/api/export")
def api_export(
    sample_ids: Optional[str] = Query(None, description="Comma-separated sample IDs"),
    db: Session = Depends(get_db),
):
    ids = None
    if sample_ids:
        ids = [int(x.strip()) for x in sample_ids.split(",") if x.strip()]
    excel_bytes = crud.export_to_excel(db, ids)
    return StreamingResponse(
        BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=color_data_export.xlsx"}
    )


# ============================================================
# Static Files & Frontend
# ============================================================

@app.get("/")
def serve_frontend():
    return FileResponse("static/index.html")


@app.get("/assets/3m-logo")
def serve_3m_logo():
    logo_path = "3M_logo.png"
    if not os.path.exists(logo_path):
        raise HTTPException(status_code=404, detail="Logo 文件不存在")
    return FileResponse(logo_path, media_type="image/png")


# Mount static directory for CSS/JS
if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")


# ============================================================
# Helper functions
# ============================================================

def _enrich_sample(sample) -> SampleOut:
    """Enrich a sample object with computed fields."""
    measurements = sample.measurements
    measurement_count = len(measurements)
    latest_delta_e = None
    if measurement_count > 0:
        sorted_meas = sorted(measurements, key=lambda m: m.measurement_date)
        latest_delta_e = sorted_meas[-1].delta_E
    return SampleOut(
        id=sample.id,
        name=sample.name,
        code=sample.code,
        category=sample.category or "",
        brand=sample.brand or "",
        model=sample.model or "",
        color_name=sample.color_name or "",
        other_info=sample.other_info or "",
        test_condition=sample.test_condition or "",
        aging_time=sample.aging_time or "",
        device_info=sample.device_info or "",
        test_device=sample.test_device or "",
        measurement_test=sample.measurement_test or "",
        description=sample.description or "",
        measurement_count=measurement_count,
        latest_delta_e=latest_delta_e,
        photo_count=len(sample.photos),
        created_at=sample.created_at,
        updated_at=sample.updated_at,
    )


def _enrich_measurement(m, db: Session) -> MeasurementOut:
    """Enrich a measurement with is_baseline and photo_count.
    is_baseline = True when aging_hours == 0."""
    try:
        is_baseline = (m.aging_hours == 0)
    except Exception:
        is_baseline = False

    try:
        p_count = len(m.photos) if hasattr(m, 'photos') and m.photos is not None else 0
    except Exception:
        p_count = 0

    return MeasurementOut(
        id=m.id,
        sample_id=m.sample_id,
        measurement_date=m.measurement_date,
        device=m.device or "SP64",
        angle=m.angle,
        aging_hours=m.aging_hours or 0,
        L=m.L,
        a=m.a,
        b=m.b,
        delta_E=m.delta_E,
        notes=m.notes or "",
        created_at=m.created_at,
        is_baseline=is_baseline,
        photo_count=p_count,
    )


# ============================================================
# Run
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
