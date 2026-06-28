import datetime
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database import get_db
from backend.models import AlertEvent, SensorReading, DriftScore
from backend.routers.sensors import active_detectors, get_detector

router = APIRouter()

class AlertResolve(BaseModel):
    ground_truth: bool = None

@router.get("/api/alerts/{env_id}")
async def list_alert_events(
    env_id: str,
    resolved: bool = Query(None),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(AlertEvent).where(AlertEvent.env_id == env_id)
    if resolved is not None:
        if resolved:
            stmt = stmt.where(AlertEvent.resolved_at.isnot(None))
        else:
            stmt = stmt.where(AlertEvent.resolved_at.is_(None))
    stmt = stmt.order_by(AlertEvent.triggered_at.desc())
    res = await db.execute(stmt)
    return res.scalars().all()

@router.get("/api/alerts/{env_id}/stats")
async def get_alert_stats(
    env_id: str,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(AlertEvent).where(AlertEvent.env_id == env_id)
    res = await db.execute(stmt)
    alerts = res.scalars().all()
    
    total = len(alerts)
    if total == 0:
        return {
            "total_alerts": 0,
            "false_positive_rate": 0.0,
            "avg_duration_seconds": 0.0,
            "avg_peak_score": 0.0
        }
        
    false_pos = sum(1 for a in alerts if a.ground_truth is False)
    true_pos = sum(1 for a in alerts if a.ground_truth is True)
    
    labeled_total = false_pos + true_pos
    fp_rate = false_pos / labeled_total if labeled_total > 0 else 0.0
    
    durations = [a.duration_seconds for a in alerts if a.duration_seconds is not None]
    peaks = [a.peak_score for a in alerts if a.peak_score is not None]
    
    avg_dur = sum(durations) / len(durations) if durations else 0.0
    avg_peak = sum(peaks) / len(peaks) if peaks else 0.0
    
    return {
        "total_alerts": total,
        "false_positive_rate": fp_rate,
        "avg_duration_seconds": avg_dur,
        "avg_peak_score": avg_peak
    }

@router.patch("/api/alerts/{env_id}/{alert_id}/resolve")
async def resolve_alert(
    env_id: str,
    alert_id: int,
    payload: AlertResolve,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(AlertEvent).where(and_(AlertEvent.id == alert_id, AlertEvent.env_id == env_id))
    res = await db.execute(stmt)
    alert = res.scalar_one_or_none()
    
    if not alert:
        raise HTTPException(status_code=404, detail="Alert event not found")
        
    alert.resolved_at = datetime.datetime.now(datetime.timezone.utc)
    if payload.ground_truth is not None:
        alert.ground_truth = payload.ground_truth
        
        # Trigger detector update
        detector = await get_detector(env_id)
        if alert.channels_involved:
            for signal in alert.channels_involved:
                detector.update_weights(signal, payload.ground_truth)
                
    await db.commit()
    return alert

@router.get("/api/alerts/export/{env_id}")
async def export_session_data(
    env_id: str,
    db: AsyncSession = Depends(get_db)
):
    # Fetch sensor readings
    stmt_readings = select(SensorReading).where(SensorReading.env_id == env_id).order_by(SensorReading.time.asc()).limit(2000)
    res_readings = await db.execute(stmt_readings)
    readings = res_readings.scalars().all()
    
    # Fetch drift scores
    stmt_drift = select(DriftScore).where(DriftScore.env_id == env_id).order_by(DriftScore.time.asc()).limit(2000)
    res_drift = await db.execute(stmt_drift)
    drifts = res_drift.scalars().all()
    
    # Fetch alerts
    stmt_alerts = select(AlertEvent).where(AlertEvent.env_id == env_id).order_by(AlertEvent.triggered_at.asc())
    res_alerts = await db.execute(stmt_alerts)
    alerts = res_alerts.scalars().all()
    
    export_data = {
        "session_timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "env_id": env_id,
        "sensor_readings": [
            {
                "time": r.time.isoformat(),
                "device_id": str(r.device_id),
                "session_id": str(r.session_id),
                "mic_db": r.mic_db,
                "accel_x": r.accel_x,
                "accel_y": r.accel_y,
                "accel_z": r.accel_z,
                "accel_magnitude": r.accel_magnitude,
                "pressure_hpa": r.pressure_hpa,
                "wifi_rssi": r.wifi_rssi,
                "wifi_ap_count": r.wifi_ap_count,
                "ble_count": r.ble_count
            }
            for r in readings
        ],
        "drift_scores": [
            {
                "time": d.time.isoformat(),
                "device_id": str(d.device_id),
                "mic_drift": d.mic_drift,
                "accel_drift": d.accel_drift,
                "pressure_drift": d.pressure_drift,
                "wifi_drift": d.wifi_drift,
                "ble_drift": d.ble_drift,
                "composite_score": d.composite_score,
                "channels_above_threshold": d.channels_above_threshold,
                "cross_channel_event": d.cross_channel_event
            }
            for d in drifts
        ],
        "alert_events": [
            {
                "id": a.id,
                "device_id": str(a.device_id),
                "triggered_at": a.triggered_at.isoformat(),
                "peak_score": a.peak_score,
                "duration_seconds": a.duration_seconds,
                "channels_involved": a.channels_involved,
                "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
                "ground_truth": a.ground_truth
            }
            for a in alerts
        ]
    }
    
    return export_data
