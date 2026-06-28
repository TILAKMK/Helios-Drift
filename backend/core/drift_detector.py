import math
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from typing import Any

@dataclass
class DriftResult:
    timestamp: datetime
    env_id: str
    composite_score: float
    drift_per_signal: dict[str, float]
    channels_above: list[str]
    cross_channel_event: bool
    alert_triggered: bool
    lead_time_estimate_min: float | None
    lstm: Any = None

class DriftDetector:
    """
    Stateful per-environment drift detector.
    One instance per active env_id, held in memory.
    """

    THRESHOLDS = {
        "mic":      1.5,
        "accel":    1.8,
        "pressure": 1.2,
        "wifi":     1.6,
        "ble":      1.4,
    }
    WINDOW_SIZE = 30
    MIN_CHANNELS = 3
    ALERT_THRESHOLD = 0.5

    def __init__(self, env_id: str, baseline_stats: Any):
        self.env_id = env_id
        self.baseline = baseline_stats
        self.buffers = {
            "mic": deque(maxlen=self.WINDOW_SIZE),
            "accel": deque(maxlen=self.WINDOW_SIZE),
            "pressure": deque(maxlen=self.WINDOW_SIZE),
            "wifi": deque(maxlen=self.WINDOW_SIZE),
            "ble": deque(maxlen=self.WINDOW_SIZE),
        }
        self.alpha = {k: 1.0 for k in self.THRESHOLDS.keys()}
        self.beta = {k: 1.0 for k in self.THRESHOLDS.keys()}
        self.state = "NORMAL"
        self.cool_down_counter = 0
        self.history_scores = deque(maxlen=150)
        self.current_alert_id = None

    def update(self, reading: Any) -> DriftResult:
        drift_per_signal = {}
        channels_above = []
        
        signals = ["mic", "accel", "pressure", "wifi", "ble"]
        
        # Get raw readings
        readings_map = {
            "mic": getattr(reading, "mic_db", 0.0),
            "accel": getattr(reading, "accel_magnitude", 0.0),
            "pressure": getattr(reading, "pressure_hpa", 0.0),
            "wifi": getattr(reading, "wifi_rssi", 0.0),
            "ble": getattr(reading, "ble_count", 0.0),
        }
        
        for s in signals:
            x_s = readings_map[s]
            if x_s is None:
                x_s = 0.0
            
            # Get baseline mean and std for the signal
            mean_s = getattr(self.baseline, f"{s}_mean", 0.0) if self.baseline else 0.0
            std_s = getattr(self.baseline, f"{s}_std", 1.0) if self.baseline else 1.0
            if mean_s is None: mean_s = 0.0
            if std_s is None or std_s <= 0: std_s = 1.0
            
            # Z-score calculation
            z_s = abs(x_s - mean_s) / max(std_s, 0.001)
            
            # Smooth by rolling mean
            self.buffers[s].append(z_s)
            drift_s = sum(self.buffers[s]) / len(self.buffers[s])
            drift_per_signal[s] = drift_s
            
            # Check threshold
            if drift_s > self.THRESHOLDS[s]:
                channels_above.append(s)
                
        # Cross-channel event detection
        cross_channel_event = len(channels_above) >= self.MIN_CHANNELS
        
        # Bayesian composite score
        numerator = 0.0
        denominator = 0.0
        for s in signals:
            w_s = self.alpha[s] / (self.alpha[s] + self.beta[s])
            val_s = drift_per_signal[s]
            sig_s = 1.0 / (1.0 + math.exp(-val_s)) if val_s is not None else 0.5
            numerator += w_s * sig_s
            denominator += w_s
            
        raw_score = numerator / denominator if denominator > 0 else 0.5
        composite_score = max(0.0, min(1.0, (raw_score - 0.5) * 2.0))
        self.history_scores.append(composite_score)
        
        # Alert state machine
        alert_triggered = False
        if self.state == "NORMAL":
            if composite_score > self.ALERT_THRESHOLD:
                self.state = "ALERT"
                alert_triggered = True
                self.cool_down_counter = 0
        elif self.state == "ALERT":
            if composite_score < 0.35:
                self.cool_down_counter += 1
                if self.cool_down_counter >= 10:
                    self.state = "NORMAL"
                    self.cool_down_counter = 0
            else:
                self.cool_down_counter = 0
                
        timestamp = getattr(reading, "time", datetime.utcnow())
        
        return DriftResult(
            timestamp=timestamp,
            env_id=self.env_id,
            composite_score=composite_score,
            drift_per_signal=drift_per_signal,
            channels_above=channels_above,
            cross_channel_event=cross_channel_event,
            alert_triggered=alert_triggered,
            lead_time_estimate_min=None
        )

    def update_weights(self, signal: str, was_true_positive: bool):
        if signal in self.alpha:
            if was_true_positive:
                self.alpha[signal] += 1.0
            else:
                self.beta[signal] += 1.0

    def get_score_history(self, n: int = 150) -> list[float]:
        return list(self.history_scores)[-n:]
