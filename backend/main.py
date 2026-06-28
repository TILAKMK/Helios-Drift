import logging
import datetime
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.config import settings
from backend.database import engine, ping_db
from backend.routers import sensors, baseline, drift, alerts, labels

# Structured JSON Logging Setup
class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_record = {
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "module": record.module,
            "line": record.lineno
        }
        if record.exc_info:
            log_record["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_record)

logger = logging.getLogger("phantom")
logger.setLevel(settings.LOG_LEVEL)
handler = logging.StreamHandler()
handler.setFormatter(JSONFormatter())
logger.addHandler(handler)

# Suppress debug logs from libraries unless needed
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

import os
from backend.core.lstm_predictor import LSTMPredictor

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Ping database to verify connection pool
    logger.info("Initializing Phantom Protocol FastAPI application...")
    db_ok = await ping_db()
    if db_ok:
        logger.info("Lifespan database connectivity verified.")
    else:
        logger.error("Lifespan database connectivity check failed!")
        
    # Load LSTM Predictor if best_model.pt and scaler.pkl exist
    model_path = "backend/ml/checkpoints/best_model.pt"
    scaler_path = "backend/ml/checkpoints/scaler.pkl"
    if os.path.exists(model_path) and os.path.exists(scaler_path):
        try:
            app.state.lstm_predictor = LSTMPredictor(model_path, scaler_path)
            logger.info("Trained PhantomLSTM inference engine loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load trained LSTM model: {e}")
            app.state.lstm_predictor = None
    else:
        logger.warning("LSTM model not trained yet, drift score only mode.")
        app.state.lstm_predictor = None

    yield
    # Shutdown: Dispose engine pool
    await engine.dispose()
    logger.info("Database engine connections closed.")

app = FastAPI(
    title="Phantom Protocol API",
    description="Early Warning Multi-Modal Weak-Signal Fusion Engine API",
    version="1.0.0",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount APIRouters (Prefixes are handled in the router decorators)
app.include_router(sensors.router)
app.include_router(baseline.router)
app.include_router(drift.router)
app.include_router(alerts.router)
app.include_router(labels.router)

from fastapi.responses import RedirectResponse

@app.get("/")
async def root_redirect():
    return RedirectResponse(url="/docs")

@app.get("/health")
async def health_check():
    db_ok = await ping_db()
    return {
        "status": "ok",
        "db": "ok" if db_ok else "fail",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }
