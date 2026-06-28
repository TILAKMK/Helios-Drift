import os
import torch
import torch.nn as nn

class PhantomLSTM(nn.Module):
    """
    Two-output LSTM for anomaly prediction.

    Architecture:
      Input:  (batch, seq_len=30, input_size=1)
      LSTM:   2 layers, hidden_size=64, dropout=0.2
      FC1:    Linear(64, 32) + ReLU
      Head 1: Linear(32, 1) + Sigmoid  -> p_event (probability of event in 30 min)
      Head 2: Linear(32, 1) + ReLU     -> minutes_to_event (regression, only meaningful when p_event > 0.5)
    """

    def __init__(self, hidden_size=64, num_layers=2, dropout=0.2):
        super().__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.dropout = dropout

        self.lstm = nn.LSTM(
            input_size=1,
            hidden_size=hidden_size,
            num_layers=num_layers,
            dropout=dropout if num_layers > 1 else 0.0,
            batch_first=True
        )
        self.fc1 = nn.Linear(hidden_size, 32)
        self.relu = nn.ReLU()
        self.head_event = nn.Linear(32, 1)
        self.head_minutes = nn.Linear(32, 1)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        # x: (batch, 30, 1)
        lstm_out, _ = self.lstm(x)
        last_hidden = lstm_out[:, -1, :]   # take last timestep
        features = self.relu(self.fc1(last_hidden))
        
        p_event = self.sigmoid(self.head_event(features)).squeeze(-1)
        minutes = self.relu(self.head_minutes(features)).squeeze(-1)
        return p_event, minutes

    def save(self, path: str):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        state = {
            'state_dict': self.state_dict(),
            'hidden_size': self.hidden_size,
            'num_layers': self.num_layers,
            'dropout': self.dropout
        }
        torch.save(state, path)

    @classmethod
    def load(cls, path: str) -> 'PhantomLSTM':
        state = torch.load(path, map_location=torch.device('cpu'))
        model = cls(
            hidden_size=state.get('hidden_size', 64),
            num_layers=state.get('num_layers', 2),
            dropout=state.get('dropout', 0.2)
        )
        model.load_state_dict(state['state_dict'])
        return model
