import pytest
import datetime
from backend.core.baseline_engine import baseline_engine

class MockReading:
    def __init__(self, mic_db=45.0, accel_magnitude=240.0, pressure_hpa=1013.0, wifi_rssi=1.2, ble_count=3, time=None):
        self.mic_db = mic_db
        self.accel_magnitude = accel_magnitude
        self.pressure_hpa = pressure_hpa
        self.wifi_rssi = wifi_rssi
        self.ble_count = ble_count
        self.time = time or datetime.datetime.now(datetime.timezone.utc)

@pytest.mark.asyncio
async def test_cold_start_baseline_provisional():
    readings = [MockReading() for _ in range(10)]
    provisional = await baseline_engine.cold_start_baseline(readings)
    
    assert provisional is not None
    assert provisional.sample_count == 10
    assert provisional.hour_of_day == -1
    assert provisional.mic_mean == 45.0
    assert provisional.mic_std == 0.0  # constant readings list has 0 standard deviation
