import pytest
import numpy as np
import torch
from backend.ml.data_pipeline import LSTMDataPipeline
from backend.ml.model import PhantomLSTM
from backend.core.lstm_predictor import LSTMPredictor, LSTMPrediction

@pytest.mark.asyncio
async def test_lstm_data_pipeline():
    pipeline = LSTMDataPipeline()
    # Forces synthetic pipeline run
    dataset = await pipeline.build_dataset(["test-env"])
    assert len(dataset) > 0
    
    # Check sequence shapes
    X, y_ev, y_min = dataset[0]
    assert X.shape == (30, 1)
    assert y_ev.shape == ()
    assert y_min.shape == ()
    
    # Check split
    train_ds, val_ds = pipeline.train_val_split(dataset, val_ratio=0.2)
    assert len(train_ds) > 0
    assert len(val_ds) > 0

def test_phantom_lstm_model():
    model = PhantomLSTM(hidden_size=16, num_layers=1, dropout=0.0)
    # Batch size 2, seq len 30, feature 1
    x = torch.randn(2, 30, 1)
    p, m = model(x)
    assert p.shape == (2,)
    assert m.shape == (2,)
    assert torch.all(p >= 0.0) and torch.all(p <= 1.0)
    assert torch.all(m >= 0.0)

def test_lstm_predictor_padding():
    # Save a temporary dummy model and scaler to test predictor padding
    model = PhantomLSTM(hidden_size=16, num_layers=1, dropout=0.0)
    import tempfile
    import os
    import joblib
    from sklearn.preprocessing import MinMaxScaler
    
    with tempfile.TemporaryDirectory() as tmpdir:
        model_path = os.path.join(tmpdir, "model.pt")
        scaler_path = os.path.join(tmpdir, "scaler.pkl")
        
        model.save(model_path)
        
        scaler = MinMaxScaler()
        scaler.fit(np.random.normal(size=(100, 1)))
        joblib.dump(scaler, scaler_path)
        
        predictor = LSTMPredictor(model_path, scaler_path)
        
        # Test short history padding
        history = [0.1, 0.2, 0.3]
        prediction = predictor.predict(history)
        assert isinstance(prediction, LSTMPrediction)
        assert 0.0 <= prediction.p_event <= 1.0
        assert prediction.alert_level in ["none", "watch", "warning", "critical"]
