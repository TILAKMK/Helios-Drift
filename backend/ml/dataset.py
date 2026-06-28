import torch
from torch.utils.data import Dataset

class PhantomDataset(Dataset):
    """
    PyTorch Dataset wrapping (X, y_event, y_minutes) tensors.
    X: float32 tensor (N, 30, 1)
    y_event: float32 tensor (N,)
    y_minutes: float32 tensor (N,)
    """
    def __init__(self, X, y_event, y_minutes):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y_event = torch.tensor(y_event, dtype=torch.float32)
        self.y_minutes = torch.tensor(y_minutes, dtype=torch.float32)

    def __len__(self):
        return len(self.X)

    def __getitem__(self, idx):
        return self.X[idx], self.y_event[idx], self.y_minutes[idx]
