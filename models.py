from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from database import Base, beijing_now


class Sample(Base):
    __tablename__ = "samples"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    code = Column(String(100), unique=True, nullable=False, index=True)
    category = Column(String(100), default="")          # 类别
    brand = Column(String(200), default="")             # 品牌
    model = Column(String(200), default="")             # 型号
    color_name = Column(String(200), default="")        # 颜色
    other_info = Column(Text, default="")               # 其他
    test_condition = Column(Text, default="")           # 测试条件
    aging_time = Column(String(200), default="")        # 老化时间
    device_info = Column(Text, default="")              # 设备信息
    test_device = Column(String(100), default="")       # 测试设备
    measurement_test = Column(Text, default="")         # 测量测试
    description = Column(Text, default="")              # 描述
    created_at = Column(DateTime, default=beijing_now)
    updated_at = Column(
        DateTime,
        default=beijing_now,
        onupdate=beijing_now
    )

    measurements = relationship(
        "ColorMeasurement", back_populates="sample",
        cascade="all, delete-orphan", order_by="ColorMeasurement.measurement_date"
    )
    photos = relationship(
        "Photo", back_populates="sample",
        cascade="all, delete-orphan"
    )


class ColorMeasurement(Base):
    __tablename__ = "color_measurements"

    id = Column(Integer, primary_key=True, index=True)
    sample_id = Column(Integer, ForeignKey("samples.id", ondelete="CASCADE"), nullable=False)
    measurement_date = Column(DateTime, default=beijing_now)
    device = Column(String(20), default="SP64")              # 测试设备: SP64 / MT12
    angle = Column(String(20), nullable=True, default=None)  # 角度: r45as-15, r45as15, ...
    aging_hours = Column(Float, default=0)                   # 老化时间(小时), 0=基线
    L = Column(Float, nullable=False)
    a = Column(Float, nullable=False)
    b = Column(Float, nullable=False)
    delta_E = Column(Float, nullable=True)
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=beijing_now)

    sample = relationship("Sample", back_populates="measurements")
    photos = relationship("Photo", back_populates="measurement")


class Photo(Base):
    __tablename__ = "photos"

    id = Column(Integer, primary_key=True, index=True)
    sample_id = Column(Integer, ForeignKey("samples.id", ondelete="CASCADE"), nullable=False)
    measurement_id = Column(
        Integer, ForeignKey("color_measurements.id", ondelete="SET NULL"), nullable=True
    )
    filename = Column(String(255), nullable=False)
    original_name = Column(String(255), nullable=False)
    upload_date = Column(DateTime, default=beijing_now)
    notes = Column(Text, default="")

    sample = relationship("Sample", back_populates="photos")
    measurement = relationship("ColorMeasurement", back_populates="photos")
