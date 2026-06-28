from sqlalchemy.orm import declarative_base
from sqlalchemy import Column, String, Integer, Float, DateTime, Boolean, ARRAY, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
import datetime

Base = declarative_base()

class SensorReading(Base):
    __tablename__ = 'sensor_readings'
    
    time = Column(DateTime(timezone=True), primary_key=True, nullable=False)
    device_id = Column(UUID(as_uuid=True), primary_key=True, nullable=False)
    env_id = Column(String, nullable=False)
    session_id = Column(UUID(as_uuid=True), nullable=False)
    mic_db = Column(Float)
    accel_x = Column(Float)
    accel_y = Column(Float)
    accel_z = Column(Float)
    accel_magnitude = Column(Float)
    pressure_hpa = Column(Float)
    wifi_rssi = Column(Float)
    wifi_ap_count = Column(Integer)
    ble_count = Column(Integer)

class Baseline(Base):
    __tablename__ = 'baselines'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    env_id = Column(String, nullable=False)
    hour_of_day = Column(Integer, nullable=False)
    computed_at = Column(DateTime(timezone=True), nullable=False, default=datetime.datetime.utcnow)
    sample_count = Column(Integer, nullable=False)
    mic_mean = Column(Float)
    mic_std = Column(Float)
    accel_mean = Column(Float)
    accel_std = Column(Float)
    pressure_mean = Column(Float)
    pressure_std = Column(Float)
    wifi_mean = Column(Float)
    wifi_std = Column(Float)
    ble_mean = Column(Float)
    ble_std = Column(Float)
    
    __table_args__ = (
        UniqueConstraint('env_id', 'hour_of_day', name='uq_env_hour'),
    )

class DriftScore(Base):
    __tablename__ = 'drift_scores'
    
    time = Column(DateTime(timezone=True), primary_key=True, nullable=False)
    env_id = Column(String, nullable=False)
    device_id = Column(UUID(as_uuid=True), primary_key=True, nullable=False)
    mic_drift = Column(Float)
    accel_drift = Column(Float)
    pressure_drift = Column(Float)
    wifi_drift = Column(Float)
    ble_drift = Column(Float)
    composite_score = Column(Float, nullable=False)
    channels_above_threshold = Column(Integer)
    cross_channel_event = Column(Boolean)

class AlertEvent(Base):
    __tablename__ = 'alert_events'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    env_id = Column(String, nullable=False)
    device_id = Column(UUID(as_uuid=True), nullable=False)
    triggered_at = Column(DateTime(timezone=True), nullable=False)
    peak_score = Column(Float)
    duration_seconds = Column(Integer)
    channels_involved = Column(ARRAY(String))
    resolved_at = Column(DateTime(timezone=True))
    ground_truth = Column(Boolean, default=None, nullable=True)
