import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, AsyncMock, MagicMock
from backend.main import app
from backend.database import get_db

class MockBaselineStats:
    def __init__(self):
        self.mic_mean = 45.0
        self.mic_std = 3.0
        self.accel_mean = 240.0
        self.accel_std = 15.0
        self.pressure_mean = 1013.0
        self.pressure_std = 5.0
        self.wifi_mean = 1.2
        self.wifi_std = 0.2
        self.ble_mean = 3.0
        self.ble_std = 1.0

# Mock DB Session Generator Dependency
async def override_get_db():
    mock_session = AsyncMock()
    mock_result = MagicMock()
    # Mock scalars().all() to return empty list
    mock_result.scalars.return_value.all.return_value = []
    mock_result.scalar_one_or_none.return_value = None
    
    mock_session.execute = AsyncMock(return_value=mock_result)
    yield mock_session

# Apply dependency overrides
app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(autouse=True)
def mock_db_connections():
    # Patch baseline engine database fetchers
    with patch("backend.core.baseline_engine.baseline_engine.get_baseline", new_callable=AsyncMock) as mock_get, \
         patch("backend.main.ping_db", new_callable=AsyncMock) as mock_ping, \
         patch("backend.database.ping_db", new_callable=AsyncMock) as mock_db_ping:
        mock_get.return_value = MockBaselineStats()
        mock_ping.return_value = True
        mock_db_ping.return_value = True
        yield

@pytest.mark.asyncio
async def test_health_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

@pytest.mark.asyncio
async def test_baseline_status_404():
    # Force mock database get_db to return 404 behavior by overriding session query
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/api/baseline/unknown_env_123_random/status")
    assert response.status_code == 404

@pytest.mark.asyncio
async def test_manual_baseline_compute():
    with patch("backend.core.baseline_engine.baseline_engine.compute_baseline", new_callable=AsyncMock) as mock_compute:
        mock_compute.return_value = {}
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.post("/api/baseline/test-env/compute")
        assert response.status_code == 200

@pytest.mark.asyncio
async def test_drift_latest_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/api/drift/test-env/latest")
    assert response.status_code == 200
    data = response.json()
    assert "env_id" in data
    assert "composite_score" in data
