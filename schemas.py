from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List


# --- Sample Schemas ---

class SampleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    code: str = Field(..., min_length=1, max_length=100)
    category: str = ""
    brand: str = ""
    model: str = ""
    color_name: str = ""
    other_info: str = ""
    test_condition: str = ""
    aging_time: str = Field(..., min_length=1, description="老化时间(小时)，必填")
    device_info: str = ""
    test_device: str = ""
    measurement_test: str = ""
    description: str = ""


class SampleUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    code: Optional[str] = Field(None, min_length=1, max_length=100)
    category: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    color_name: Optional[str] = None
    other_info: Optional[str] = None
    test_condition: Optional[str] = None
    aging_time: Optional[str] = None
    device_info: Optional[str] = None
    test_device: Optional[str] = None
    measurement_test: Optional[str] = None
    description: Optional[str] = None


class SampleListItem(BaseModel):
    id: int
    name: str
    code: str
    category: str = ""
    brand: str = ""
    model: str = ""
    color_name: str = ""
    other_info: str = ""
    test_condition: str = ""
    aging_time: str = ""
    device_info: str = ""
    test_device: str = ""
    measurement_test: str = ""
    description: str = ""
    measurement_count: int = 0
    latest_delta_e: Optional[float] = None
    photo_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SampleOut(BaseModel):
    id: int
    name: str
    code: str
    category: str = ""
    brand: str = ""
    model: str = ""
    color_name: str = ""
    other_info: str = ""
    test_condition: str = ""
    aging_time: str = ""
    device_info: str = ""
    test_device: str = ""
    measurement_test: str = ""
    description: str = ""
    measurement_count: int = 0
    latest_delta_e: Optional[float] = None
    photo_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# --- Measurement Schemas ---

class MeasurementCreate(BaseModel):
    measurement_date: Optional[datetime] = None
    device: str = "SP64"
    angle: Optional[str] = None
    aging_hours: float = 0
    L: float = Field(..., ge=0, le=200)
    a: float
    b: float
    notes: str = ""


class MeasurementBatchCreate(BaseModel):
    """Batch create measurements (for MT12 multi-angle)."""
    measurement_date: Optional[datetime] = None
    device: str = "SP64"
    aging_hours: float = 0
    entries: List["MeasurementEntry"] = []


class MeasurementEntry(BaseModel):
    angle: Optional[str] = None
    L: float = Field(..., ge=0, le=200)
    a: float
    b: float


class MeasurementUpdate(BaseModel):
    measurement_date: Optional[datetime] = None
    device: Optional[str] = None
    angle: Optional[str] = None
    aging_hours: Optional[float] = None
    L: Optional[float] = Field(None, ge=0, le=100)
    a: Optional[float] = None
    b: Optional[float] = None
    notes: Optional[str] = None


class MeasurementOut(BaseModel):
    id: int
    sample_id: int
    measurement_date: datetime
    device: str = "SP64"
    angle: Optional[str] = None
    aging_hours: float = 0
    L: float
    a: float
    b: float
    delta_E: Optional[float] = None
    notes: str
    created_at: datetime
    is_baseline: bool = False
    photo_count: int = 0

    model_config = {"from_attributes": True}


class MeasurementListItem(BaseModel):
    id: int
    sample_id: int
    sample_name: str
    sample_code: str
    sample_brand: str = ""
    sample_model: str = ""
    sample_test_condition: str = ""
    sample_aging_time: str = ""
    measurement_date: datetime
    device: str = "SP64"
    angle: Optional[str] = None
    aging_hours: float = 0
    L: float
    a: float
    b: float
    delta_E: Optional[float] = None
    notes: str = ""
    created_at: datetime
    is_baseline: bool = False
    photo_count: int = 0


# --- Photo Schemas ---

class PhotoOut(BaseModel):
    id: int
    sample_id: int
    measurement_id: Optional[int] = None
    filename: str
    original_name: str
    upload_date: datetime
    notes: str

    model_config = {"from_attributes": True}


# --- Search Schema ---

class SearchResult(BaseModel):
    samples: List[SampleListItem]
    total: int
