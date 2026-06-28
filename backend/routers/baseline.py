from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database import get_db
from backend.models import Baseline
from backend.core.baseline_engine import baseline_engine

router = APIRouter()

@router.post("/api/baseline/{env_id}/compute")
async def trigger_recomputation(env_id: str):
    try:
        baselines = await baseline_engine.compute_baseline(env_id)
        return {"status": "success", "data": baselines}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/baseline/{env_id}")
async def get_all_baselines(env_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(Baseline).where(Baseline.env_id == env_id).order_by(Baseline.hour_of_day.asc())
    res = await db.execute(stmt)
    baselines = res.scalars().all()
    return baselines

@router.get("/api/baseline/{env_id}/status")
async def get_baseline_status(env_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(Baseline).where(Baseline.env_id == env_id)
    res = await db.execute(stmt)
    baselines = res.scalars().all()
    
    if not baselines:
        raise HTTPException(status_code=404, detail="Baseline status not found for unknown environment")
        
    total_samples = sum(b.sample_count for b in baselines)
    last_comp = max(b.computed_at for b in baselines)
    coverage = (len(baselines) / 24.0) * 100.0
    
    return {
        "sample_count": total_samples,
        "last_computed": last_comp,
        "coverage_percent": coverage
    }

@router.get("/api/baseline/{env_id}/{hour}")
async def get_hourly_baseline(env_id: str, hour: int):
    if hour < 0 or hour > 23:
        raise HTTPException(status_code=400, detail="Invalid hour. Must be between 0 and 23")
    baseline = await baseline_engine.get_baseline(env_id, hour)
    if not baseline:
        raise HTTPException(status_code=404, detail=f"Baseline not found for environment {env_id} at hour {hour}")
    return baseline
