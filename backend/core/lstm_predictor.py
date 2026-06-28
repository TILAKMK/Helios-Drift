import os
import joblib
import torch
import numpy as np
from dataclasses import dataclass
from backend.ml.model import PhantomLSTM

@dataclass
class LSTMPrediction:
    p_event: float              # probability of event in next 30 min
    minutes_to_event: float     # estimated minutes (only if p_event > 0.5)
    alert_level: str            # "none" / "watch" / "warning" / "critical"

class LSTMPredictor:
    """
    Wraps trained PhantomLSTM for real-time inference.
    Loaded once at FastAPI startup, reused per request.
    """

    def __init__(self, model_path: str, scaler_path: str):
        self.model = PhantomLSTM.load(model_path)
        self.model.eval()
        self.scaler = joblib.load(scaler_path)

    def predict(self, score_history: list[float]) -> LSTMPrediction:
        """
        Input: last 30 composite score values
        If len < 30: pad with zeros on left
        """
        history = list(score_history)
        if len(history) < 30:
            padding_len = 30 - len(history)
            history = [0.0] * padding_len + history
        else:
            history = history[-30:]

        # Normalize score history using loaded scaler
        # MinMaxScaler expects shape (N_samples, n_features)
        history_np = np.array(history, dtype=np.float32).reshape(-1, 1)
        scaled_history = self.scaler.transform(history_np)

        # Reshape to (batch_size=1, seq_len=30, input_size=1)
        input_tensor = torch.tensor(scaled_history, dtype=torch.float32).unsqueeze(0)

        with torch.no_grad():
            p_event_tensor, minutes_tensor = self.model(input_tensor)
            p_event = float(p_event_tensor.item())
            # Scale back regression target to minutes
            minutes_to_event = float(minutes_tensor.item()) * 30.0

        # Classify alert levels
        if p_event < 0.3:
            alert_level = "none"
        elif p_event < 0.5:
            alert_level = "watch"
        elif p_event < 0.75:
            alert_level = "warning"
        else:
            alert_level = "critical"

        return LSTMPrediction(
            p_event=p_event,
            minutes_to_event=minutes_to_event if p_event >= 0.5 else 0.0,
            alert_level=alert_level
        )
