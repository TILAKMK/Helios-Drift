import datetime
import asyncio
import json
import logging
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database import get_db
from backend.models import DriftScore, AlertEvent
from backend.routers.sensors import active_detectors, get_detector

logger = logging.getLogger("phantom")
router = APIRouter()

class LabelSubmit(BaseModel):
    alert_id: int
    was_true_positive: bool

@router.get("/api/drift/{env_id}/latest")
async def get_latest_drift_result(env_id: str):
    detector = await get_detector(env_id)
    # Return mock or actual state
    hist = detector.get_score_history(1)
    current_score = hist[0] if hist else 0.0
    
    # Construct a DriftResult-like dictionary
    return {
        "env_id": env_id,
        "composite_score": current_score,
        "drift_per_signal": {s: (sum(detector.buffers[s])/len(detector.buffers[s]) if len(detector.buffers[s]) > 0 else 0.0) for s in detector.THRESHOLDS.keys()},
        "channels_above": [s for s in detector.THRESHOLDS.keys() if (sum(detector.buffers[s])/len(detector.buffers[s]) if len(detector.buffers[s]) > 0 else 0.0) > detector.THRESHOLDS[s]],
        "state": detector.state,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }

@router.get("/api/drift/{env_id}/history")
async def get_drift_history(
    env_id: str,
    minutes: int = Query(5),
    db: AsyncSession = Depends(get_db)
):
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=minutes)
    stmt = select(DriftScore).where(
        and_(
            DriftScore.env_id == env_id,
            DriftScore.time >= cutoff
        )
    ).order_by(DriftScore.time.asc())
    res = await db.execute(stmt)
    return res.scalars().all()

@router.get("/api/drift/{env_id}/score-stream")
async def get_score_stream(env_id: str):
    async def event_generator():
        detector = await get_detector(env_id)
        while True:
            hist = detector.get_score_history(1)
            score = hist[0] if hist else 0.0
            data = {
                "score": score,
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
            }
            yield f"data: {json.dumps(data)}\n\n"
            await asyncio.sleep(2.0)
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.post("/api/drift/{env_id}/label")
async def submit_alert_label(
    env_id: str,
    payload: LabelSubmit,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(AlertEvent).where(AlertEvent.id == payload.alert_id)
    res = await db.execute(stmt)
    alert = res.scalar_one_or_none()
    
    if not alert:
        raise HTTPException(status_code=404, detail=f"Alert event {payload.alert_id} not found")
        
    alert.ground_truth = payload.was_true_positive
    
    # Trigger Bayesian weight updates for signals involved
    detector = await get_detector(env_id)
    if alert.channels_involved:
        for signal in alert.channels_involved:
            detector.update_weights(signal, payload.was_true_positive)
            
    await db.commit()
    return {"status": "success", "message": f"Weights updated for env {env_id} using event {payload.alert_id}"}
