import time
import numpy as np
import datetime
from sqlalchemy import select, and_, func
from backend.models import SensorReading, Baseline
from backend.database import AsyncSessionLocal
from typing import Dict, Any, Optional

class TTLCache:
    def __init__(self, ttl_seconds: int = 3600):
        self.ttl = ttl_seconds
        self.cache = {}

    def get(self, key: Any) -> Optional[Any]:
        if key in self.cache:
            val, expiry = self.cache[key]
            if time.time() < expiry:
                return val
            else:
                del self.cache[key]
        return None

    def set(self, key: Any, val: Any):
        self.cache[key] = (val, time.time() + self.ttl)

    def clear(self):
        self.cache.clear()

class BaselineEngine:
    def __init__(self):
        self.cache = TTLCache(ttl_seconds=3600)

    async def compute_baseline(self, env_id: str, days: int = 7) -> dict:
        """
        Query last N days of sensor_readings for env_id.
        Group by hour_of_day (0-23).
        Compute mean, std, sample_count for each channel.
        Minimum 50 samples per hour required.
        Hours with insufficient data inherit from nearest valid hour.
        Upsert into baselines table.
        """
        async with AsyncSessionLocal() as session:
            cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
            stmt = select(SensorReading).where(
                and_(
                    SensorReading.env_id == env_id,
                    SensorReading.time >= cutoff
                )
            )
            result = await session.execute(stmt)
            readings = result.scalars().all()
            
            # Group by hour
            readings_by_hour = {h: [] for h in range(24)}
            for r in readings:
                h = r.time.hour
                readings_by_hour[h].append(r)
                
            valid_baselines = {}
            for h in range(24):
                hour_readings = readings_by_hour[h]
                count = len(hour_readings)
                if count >= 50:
                    mic_vals = [r.mic_db for r in hour_readings if r.mic_db is not None]
                    acc_vals = [r.accel_magnitude for r in hour_readings if r.accel_magnitude is not None]
                    prs_vals = [r.pressure_hpa for r in hour_readings if r.pressure_hpa is not None]
                    wif_vals = [r.wifi_rssi for r in hour_readings if r.wifi_rssi is not None]
                    ble_vals = [r.ble_count for r in hour_readings if r.ble_count is not None]
                    
                    valid_baselines[h] = {
                        "sample_count": count,
                        "mic_mean": float(np.mean(mic_vals)) if mic_vals else 0.0,
                        "mic_std": float(np.std(mic_vals)) if mic_vals else 1.0,
                        "accel_mean": float(np.mean(acc_vals)) if acc_vals else 0.0,
                        "accel_std": float(np.std(acc_vals)) if acc_vals else 1.0,
                        "pressure_mean": float(np.mean(prs_vals)) if prs_vals else 0.0,
                        "pressure_std": float(np.std(prs_vals)) if prs_vals else 1.0,
                        "wifi_mean": float(np.mean(wif_vals)) if wif_vals else 0.0,
                        "wifi_std": float(np.std(wif_vals)) if wif_vals else 1.0,
                        "ble_mean": float(np.mean(ble_vals)) if ble_vals else 0.0,
                        "ble_std": float(np.std(ble_vals)) if ble_vals else 1.0,
                    }
            
            # Interpolation fallback for sparse hours
            final_baselines = {}
            if valid_baselines:
                for h in range(24):
                    if h in valid_baselines:
                        final_baselines[h] = valid_baselines[h]
                    else:
                        # Find nearest valid hour
                        nearest_h = min(valid_baselines.keys(), key=lambda v_h: min(abs(h - v_h), 24 - abs(h - v_h)))
                        final_baselines[h] = valid_baselines[nearest_h].copy()
            else:
                # If no hour has >= 50 samples, fallback to provisional baseline using all readings
                provisional = await self.cold_start_baseline(readings)
                if provisional:
                    for h in range(24):
                        final_baselines[h] = {
                            "sample_count": provisional.sample_count,
                            "mic_mean": provisional.mic_mean,
                            "mic_std": provisional.mic_std,
                            "accel_mean": provisional.accel_mean,
                            "accel_std": provisional.accel_std,
                            "pressure_mean": provisional.pressure_mean,
                            "pressure_std": provisional.pressure_std,
                            "wifi_mean": provisional.wifi_mean,
                            "wifi_std": provisional.wifi_std,
                            "ble_mean": provisional.ble_mean,
                            "ble_std": provisional.ble_std,
                        }
            
            # Upsert into DB and update memory cache
            now = datetime.datetime.now(datetime.timezone.utc)
            for h, stats in final_baselines.items():
                stats_db = stats.copy()
                stats_db["computed_at"] = now
                
                stmt_find = select(Baseline).where(
                    and_(
                        Baseline.env_id == env_id,
                        Baseline.hour_of_day == h
                    )
                )
                db_res = await session.execute(stmt_find)
                db_obj = db_res.scalar_one_or_none()
                
                if db_obj:
                    for k, v in stats_db.items():
                        setattr(db_obj, k, v)
                else:
                    db_obj = Baseline(env_id=env_id, hour_of_day=h, **stats_db)
                    session.add(db_obj)
                    
                # Cache entry
                self.cache.set((env_id, h), db_obj)
                
            await session.commit()
            return final_baselines

    async def get_baseline(self, env_id: str, hour: int) -> Optional[Baseline]:
        """
        Fetch baseline for env_id at given hour from DB.
        Cache in memory (TTL 1 hour).
        """
        cached = self.cache.get((env_id, hour))
        if cached:
            return cached
            
        async with AsyncSessionLocal() as session:
            stmt = select(Baseline).where(
                and_(
                    Baseline.env_id == env_id,
                    Baseline.hour_of_day == hour
                )
            )
            result = await session.execute(stmt)
            db_obj = result.scalar_one_or_none()
            if db_obj:
                self.cache.set((env_id, hour), db_obj)
            return db_obj

    async def cold_start_baseline(self, readings: list) -> Optional[Baseline]:
        """
        Compute provisional baseline from available readings.
        """
        count = len(readings)
        if count == 0:
            return None
            
        mic_vals = [r.mic_db for r in readings if r.mic_db is not None]
        acc_vals = [r.accel_magnitude for r in readings if r.accel_magnitude is not None]
        prs_vals = [r.pressure_hpa for r in readings if r.pressure_hpa is not None]
        wif_vals = [r.wifi_rssi for r in readings if r.wifi_rssi is not None]
        ble_vals = [r.ble_count for r in readings if r.ble_count is not None]
        
        provisional = Baseline(
            env_id="provisional",
            hour_of_day=-1,
            sample_count=count,
            computed_at=datetime.datetime.now(datetime.timezone.utc),
            mic_mean=float(np.mean(mic_vals)) if mic_vals else 0.0,
            mic_std=float(np.std(mic_vals)) if mic_vals else 1.0,
            accel_mean=float(np.mean(acc_vals)) if acc_vals else 0.0,
            accel_std=float(np.std(acc_vals)) if acc_vals else 1.0,
            pressure_mean=float(np.mean(prs_vals)) if prs_vals else 0.0,
            pressure_std=float(np.std(prs_vals)) if prs_vals else 1.0,
            wifi_mean=float(np.mean(wif_vals)) if wif_vals else 0.0,
            wifi_std=float(np.std(wif_vals)) if wif_vals else 1.0,
            ble_mean=float(np.mean(ble_vals)) if ble_vals else 0.0,
            ble_std=float(np.std(ble_vals)) if ble_vals else 1.0,
        )
        return provisional

    async def schedule_recomputation(self):
        """
        APScheduler job: recompute baseline for all active env_ids every 24h at 2am.
        Active env_id = had readings in last 48h.
        """
        async with AsyncSessionLocal() as session:
            cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=48)
            stmt = select(SensorReading.env_id).where(SensorReading.time >= cutoff).distinct()
            result = await session.execute(stmt)
            active_envs = result.scalars().all()
            
            for env_id in active_envs:
                try:
                    await self.compute_baseline(env_id)
                except Exception as e:
                    print(f"Error computing baseline for {env_id}: {e}")

baseline_engine = BaselineEngine()
