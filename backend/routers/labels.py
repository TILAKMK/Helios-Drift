import io
import csv
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, UUID4, Field
from sqlalchemy import select, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database import get_db
from backend.models import GroundTruthLabel, DriftScore

router = APIRouter()

class LabelCreate(BaseModel):
    env_id: str
    device_id: UUID4
    session_id: UUID4
    event_type: str
    severity: int = Field(..., ge=1, le=5)
    notes: str | None = None
    timestamp: datetime
    composite_score_at_time: float | None = None

class LeadTimeUpdate(BaseModel):
    lead_time_actual_min: float

@router.post("/api/labels")
async def create_label(payload: LabelCreate, db: AsyncSession = Depends(get_db)):
    db_label = GroundTruthLabel(
        env_id=payload.env_id,
        device_id=payload.device_id,
        session_id=payload.session_id,
        event_type=payload.event_type,
        severity=payload.severity,
        notes=payload.notes,
        labeled_at=payload.timestamp,
        score_at_time=payload.composite_score_at_time
    )
    db.add(db_label)
    await db.commit()
    await db.refresh(db_label)
    return {"status": "success", "id": db_label.id}

@router.get("/api/labels/{env_id}")
async def list_labels(env_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(GroundTruthLabel).where(GroundTruthLabel.env_id == env_id).order_by(GroundTruthLabel.labeled_at.desc())
    res = await db.execute(stmt)
    return res.scalars().all()

@router.patch("/api/labels/{id}/lead-time")
async def update_lead_time(id: int, payload: LeadTimeUpdate, db: AsyncSession = Depends(get_db)):
    stmt = select(GroundTruthLabel).where(GroundTruthLabel.id == id)
    res = await db.execute(stmt)
    label = res.scalar_one_or_none()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    label.lead_time_actual_min = payload.lead_time_actual_min
    await db.commit()
    return {"status": "success", "id": label.id}

@router.get("/api/labels/export/{env_id}")
async def export_labels_csv(env_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(GroundTruthLabel).where(GroundTruthLabel.env_id == env_id).order_by(GroundTruthLabel.labeled_at.asc())
    res = await db.execute(stmt)
    labels = res.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)

    # Compile dynamic preceding time headers (t-29 to t-0)
    headers = ["timestamp"]
    for i in range(29, -1, -1):
        headers.append(f"score_t-{i}")
    headers.extend(["event_in_30min", "minutes_to_event", "event_type"])
    writer.writerow(headers)

    for label in labels:
        stmt_scores = select(DriftScore.composite_score).where(
            and_(
                DriftScore.env_id == env_id,
                DriftScore.time <= label.labeled_at
            )
        ).order_by(desc(DriftScore.time)).limit(30)
        res_scores = await db.execute(stmt_scores)
        scores = res_scores.scalars().all()
        scores = list(reversed(scores))

        # Handle start-of-session padding
        if len(scores) < 30:
            padding_len = 30 - len(scores)
            scores = [0.0] * padding_len + scores

        min_to_event = label.lead_time_actual_min if label.lead_time_actual_min is not None else 0.0
        event_in_30min = 1 if min_to_event <= 30.0 else 0

        row = [label.labeled_at.isoformat()] + scores + [event_in_30min, min_to_event, label.event_type]
        writer.writerow(row)

    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=phantom_labels_{env_id}.csv"}
    )
