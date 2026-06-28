import pytest
import datetime
from backend.core.drift_detector import DriftDetector

class MockBaseline:
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

class MockReading:
    def __init__(self, mic_db=45.0, accel_magnitude=240.0, pressure_hpa=1013.0, wifi_rssi=1.2, ble_count=3.0):
        self.mic_db = mic_db
        self.accel_magnitude = accel_magnitude
        self.pressure_hpa = pressure_hpa
        self.wifi_rssi = wifi_rssi
        self.ble_count = ble_count
        self.time = datetime.datetime.now(datetime.timezone.utc)

def test_normal_readings_produce_low_score():
    baseline = MockBaseline()
    detector = DriftDetector("test-env", baseline)
    
    # Send multiple nominal readings to fill deques
    for _ in range(35):
        reading = MockReading()
        res = detector.update(reading)
        
    assert res.composite_score < 0.3
    assert not res.cross_channel_event

def test_single_signal_spike_no_cross_channel():
    baseline = MockBaseline()
    detector = DriftDetector("test-env", baseline)
    
    # Fill with nominal values
    for _ in range(30):
        detector.update(MockReading())
        
    # Spike on single channel repeatedly
    spiked_reading = MockReading(mic_db=80.0)
    for _ in range(25):
        res = detector.update(spiked_reading)
    
    assert not res.cross_channel_event

def test_three_simultaneous_signal_spikes():
    baseline = MockBaseline()
    detector = DriftDetector("test-env", baseline)
    
    # Fill buffers
    for _ in range(30):
        detector.update(MockReading())
        
    # Spike on 3 channels repeatedly
    spiked_reading = MockReading(mic_db=80.0, wifi_rssi=5.0, ble_count=20.0)
    for _ in range(25):
        res = detector.update(spiked_reading)
    
    assert res.cross_channel_event

def test_composite_score_monotonicity():
    baseline = MockBaseline()
    
    # 1 channel spiked
    detector1 = DriftDetector("test-env", baseline)
    for _ in range(30): detector1.update(MockReading())
    for _ in range(25): res1 = detector1.update(MockReading(mic_db=80.0))
    
    # 2 channels spiked
    detector2 = DriftDetector("test-env", baseline)
    for _ in range(30): detector2.update(MockReading())
    for _ in range(25): res2 = detector2.update(MockReading(mic_db=80.0, wifi_rssi=5.0))
    
    # 3 channels spiked
    detector3 = DriftDetector("test-env", baseline)
    for _ in range(30): detector3.update(MockReading())
    for _ in range(25): res3 = detector3.update(MockReading(mic_db=80.0, wifi_rssi=5.0, ble_count=20.0))
    
    assert res2.composite_score > res1.composite_score
    assert res3.composite_score > res2.composite_score

def test_alert_state_machine_transitions():
    baseline = MockBaseline()
    detector = DriftDetector("test-env", baseline)
    
    # Fill with nominal
    for _ in range(30):
        detector.update(MockReading())
    assert detector.state == "NORMAL"
    
    # Spike multiple channels to trigger ALERT state
    spiked = MockReading(mic_db=80.0, wifi_rssi=5.0, ble_count=20.0)
    triggered = False
    for _ in range(25):
        res = detector.update(spiked)
        if res.alert_triggered:
            triggered = True
            
    assert detector.state == "ALERT"
    assert triggered
    
    # Return to normal readings: feed nominal values until state transitions back to NORMAL
    cooldown_triggered = False
    for _ in range(60):
        detector.update(MockReading())
        if detector.state == "NORMAL":
            cooldown_triggered = True
            break
            
    assert cooldown_triggered

def test_bayesian_weight_update():
    baseline = MockBaseline()
    detector = DriftDetector("test-env", baseline)
    
    # Initial weights are uniform (alpha=1, beta=1) -> mean = 0.5
    w_initial = detector.alpha["mic"] / (detector.alpha["mic"] + detector.beta["mic"])
    
    # Update as true positive
    detector.update_weights("mic", was_true_positive=True)
    w_tp = detector.alpha["mic"] / (detector.alpha["mic"] + detector.beta["mic"])
    assert w_tp > w_initial  # weight increases
    
    # Update as false positive
    detector.update_weights("mic", was_true_positive=False)
    w_fp = detector.alpha["mic"] / (detector.alpha["mic"] + detector.beta["mic"])
    assert w_fp < w_tp  # weight decreases
