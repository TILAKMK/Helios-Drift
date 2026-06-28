import math
import logging
import datetime
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, Depends
from pydantic import BaseModel, UUID4
from sqlalchemy import select, and_, text
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database import get_db, engine, AsyncSessionLocal
from backend.models import SensorReading, DriftScore, AlertEvent
from backend.core.drift_detector import DriftDetector, DriftResult
from backend.core.baseline_engine import baseline_engine
from backend.core.score_aggregator import estimate_lead_time

logger = logging.getLogger("phantom")
router = APIRouter()

# Global state for in-memory active drift detectors
# env_id -> DriftDetector
active_detectors = {}

class ConnectionManager:
    def __init__(self):
        self.active = {}

    async def connect(self, env_id: str, ws: WebSocket):
        await ws.accept()
        if env_id not in self.active:
            self.active[env_id] = []
        self.active[env_id].append(ws)

    async def disconnect(self, env_id: str, ws: WebSocket):
        if env_id in self.active:
            if ws in self.active[env_id]:
                self.active[env_id].remove(ws)
            if not self.active[env_id]:
                del self.active[env_id]

    async def broadcast(self, env_id: str, message: dict):
        if env_id in self.active:
            dead_connections = []
            for ws in self.active[env_id]:
                try:
                    await ws.send_json(message)
                except Exception:
                    dead_connections.append(ws)
            for ws in dead_connections:
                await self.disconnect(env_id, ws)

manager = ConnectionManager()

# Pydantic validation schemas
class ReadingsPayload(BaseModel):
    mic_db: float = None
    accel_x: float = None
    accel_y: float = None
    accel_z: float = None
    pressure_hpa: float = None
    wifi_rssi: float = None
    wifi_ap_count: int = None
    ble_count: int = None

class SensorStreamMessage(BaseModel):
    device_id: UUID4
    env_id: str
    session_id: UUID4
    timestamp: datetime.datetime
    readings: ReadingsPayload

async def get_detector(env_id: str) -> DriftDetector:
    if env_id not in active_detectors:
        current_hour = datetime.datetime.now(datetime.timezone.utc).hour
        baseline = await baseline_engine.get_baseline(env_id, current_hour)
        active_detectors[env_id] = DriftDetector(env_id, baseline)
    return active_detectors[env_id]

@router.websocket("/ws/sensor-stream/{env_id}")
async def ws_sensor_stream(websocket: WebSocket, env_id: str, device_id: str = Query(...)):
    await websocket.accept()
    logger.info(f"Sensor stream connection accepted for device {device_id} in {env_id}")
    
    session_count = 0
    start_time = datetime.datetime.now(datetime.timezone.utc)
    
    try:
        while True:
            data = await websocket.receive_json()
            # Validate payload
            msg = SensorStreamMessage.model_validate(data)
            
            # Calculations
            acc_x = msg.readings.accel_x or 0.0
            acc_y = msg.readings.accel_y or 0.0
            acc_z = msg.readings.accel_z or 0.0
            accel_magnitude = math.sqrt(acc_x**2 + acc_y**2 + acc_z**2)
            
            # Prepare bulk insert dictionary
            reading_dict = {
                "time": msg.timestamp,
                "device_id": msg.device_id,
                "env_id": msg.env_id,
                "session_id": msg.session_id,
                "mic_db": msg.readings.mic_db,
                "accel_x": acc_x,
                "accel_y": acc_y,
                "accel_z": acc_z,
                "accel_magnitude": accel_magnitude,
                "pressure_hpa": msg.readings.pressure_hpa,
                "wifi_rssi": msg.readings.wifi_rssi,
                "wifi_ap_count": msg.readings.wifi_ap_count,
                "ble_count": msg.readings.ble_count
            }
            
            # Raw Insert via Executesmany using session context
            async with AsyncSessionLocal() as session:
                query = text("""
                    INSERT INTO sensor_readings (
                        time, device_id, env_id, session_id,
                        mic_db, accel_x, accel_y, accel_z, accel_magnitude,
                        pressure_hpa, wifi_rssi, wifi_ap_count, ble_count
                    ) VALUES (
                        :time, :device_id, :env_id, :session_id,
                        :mic_db, :accel_x, :accel_y, :accel_z, :accel_magnitude,
                        :pressure_hpa, :wifi_rssi, :wifi_ap_count, :ble_count
                    )
                """)
                await session.execute(query, [reading_dict])
                await session.commit()
                
            session_count += 1
            
            # Compute drift score
            detector = await get_detector(env_id)
            drift_res = detector.update(SensorReading(**reading_dict))
            
            # Linear trend estimation for lead time
            lead_time = estimate_lead_time(detector.get_score_history(30), detector.ALERT_THRESHOLD)
            drift_res.lead_time_estimate_min = lead_time
            
            # Log alert event to DB on NORMAL->ALERT transition
            if drift_res.alert_triggered:
                async with AsyncSessionLocal() as session:
                    new_alert = AlertEvent(
                        env_id=env_id,
                        device_id=msg.device_id,
                        triggered_at=drift_res.timestamp,
                        peak_score=drift_res.composite_score,
                        channels_involved=drift_res.channels_above
                    )
                    session.add(new_alert)
                    await session.commit()
                    detector.current_alert_id = new_alert.id
            
            # If in ALERT state, update duration/peak score if relevant
            if detector.state == "ALERT" and detector.current_alert_id:
                async with AsyncSessionLocal() as session:
                    stmt = select(AlertEvent).where(AlertEvent.id == detector.current_alert_id)
                    db_res = await session.execute(stmt)
                    curr_alert = db_res.scalar_one_or_none()
                    if curr_alert:
                        dur = int((datetime.datetime.now(datetime.timezone.utc) - curr_alert.triggered_at.replace(tzinfo=datetime.timezone.utc)).total_seconds())
                        curr_alert.duration_seconds = dur
                        if drift_res.composite_score > (curr_alert.peak_score or 0.0):
                            curr_alert.peak_score = drift_res.composite_score
                        await session.commit()

            # If ALERT resolved, mark it
            if not drift_res.alert_triggered and detector.state == "NORMAL" and detector.current_alert_id:
                async with AsyncSessionLocal() as session:
                    stmt = select(AlertEvent).where(AlertEvent.id == detector.current_alert_id)
                    db_res = await session.execute(stmt)
                    curr_alert = db_res.scalar_one_or_none()
                    if curr_alert:
                        curr_alert.resolved_at = datetime.datetime.now(datetime.timezone.utc)
                        await session.commit()
                detector.current_alert_id = None
                
            # Log raw drift score to DB
            async with AsyncSessionLocal() as session:
                query_drift = text("""
                    INSERT INTO drift_scores (
                        time, env_id, device_id,
                        mic_drift, accel_drift, pressure_drift, wifi_drift, ble_drift,
                        composite_score, channels_above_threshold, cross_channel_event
                    ) VALUES (
                        :time, :env_id, :device_id,
                        :mic_drift, :accel_drift, :pressure_drift, :wifi_drift, :ble_drift,
                        :composite_score, :channels_above_threshold, :cross_channel_event
                    )
                """)
                await session.execute(query_drift, [{
                    "time": drift_res.timestamp,
                    "env_id": env_id,
                    "device_id": msg.device_id,
                    "mic_drift": drift_res.drift_per_signal["mic"],
                    "accel_drift": drift_res.drift_per_signal["accel"],
                    "pressure_drift": drift_res.drift_per_signal["pressure"],
                    "wifi_drift": drift_res.drift_per_signal["wifi"],
                    "ble_drift": drift_res.drift_per_signal["ble"],
                    "composite_score": drift_res.composite_score,
                    "channels_above_threshold": len(drift_res.channels_above),
                    "cross_channel_event": drift_res.cross_channel_event
                }])
                await session.commit()

            # Push live drift update to connected dashboard clients
            dashboard_msg = {
                "type": "drift_update",
                "composite_score": drift_res.composite_score,
                "drift_per_signal": drift_res.drift_per_signal,
                "channels_above": drift_res.channels_above,
                "cross_channel_event": drift_res.cross_channel_event,
                "alert_triggered": (detector.state == "ALERT"),
                "lead_time_estimate_min": drift_res.lead_time_estimate_min,
                "timestamp": drift_res.timestamp.isoformat()
            }
            await manager.broadcast(env_id, dashboard_msg)
            
    except WebSocketDisconnect:
        end_time = datetime.datetime.now(datetime.timezone.utc)
        duration = (end_time - start_time).total_seconds()
        logger.info(f"Sensor stream disconnect. Device: {device_id}, Env: {env_id}, Duration: {duration}s, Count: {session_count}")
    except Exception as e:
        logger.error(f"Error in sensor stream connection: {e}")
        await websocket.close()

@router.websocket("/ws/dashboard/{env_id}")
async def ws_dashboard(websocket: WebSocket, env_id: str):
    await manager.connect(env_id, websocket)
    logger.info(f"Dashboard client connected to env_id {env_id}")
    
    try:
        # Immediately backfill the last 150 composite scores
        async with AsyncSessionLocal() as session:
            stmt = select(DriftScore.composite_score).where(
                DriftScore.env_id == env_id
            ).order_by(DriftScore.time.desc()).limit(150)
            res = await session.execute(stmt)
            scores = res.scalars().all()
            # reverse order to keep chronological
            scores = list(reversed(scores))
            
        await websocket.send_json({
            "type": "backfill",
            "scores": scores
        })
        
        while True:
            # Just keep the socket alive. Pushes are broadcasted from sensor stream loop.
            await websocket.receive_text()
            
    except WebSocketDisconnect:
        await manager.disconnect(env_id, websocket)
        logger.info(f"Dashboard client disconnected from env_id {env_id}")
    except Exception as e:
        logger.error(f"Error in dashboard ws connection: {e}")
        await manager.disconnect(env_id, websocket)

# REST endpoints
@router.get("/api/sensors/{env_id}")
async def get_sensor_readings(
    env_id: str,
    start: datetime.datetime = Query(None),
    end: datetime.datetime = Query(None),
    limit: int = Query(1000),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(SensorReading).where(SensorReading.env_id == env_id)
    if start:
        stmt = stmt.where(SensorReading.time >= start)
    if end:
        stmt = stmt.where(SensorReading.time <= end)
    stmt = stmt.order_by(SensorReading.time.desc()).limit(limit)
    res = await db.execute(stmt)
    return res.scalars().all()

@router.get("/api/sensors/{env_id}/latest")
async def get_latest_sensor_readings(
    env_id: str,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(SensorReading).where(SensorReading.env_id == env_id).order_by(SensorReading.time.desc()).limit(30)
    res = await db.execute(stmt)
    return list(reversed(res.scalars().all()))

@router.get("/api/sensors/sessions/{device_id}")
async def get_device_sessions(
    device_id: UUID4,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(SensorReading.session_id).where(SensorReading.device_id == device_id).distinct()
    res = await db.execute(stmt)
    return res.scalars().all()
