import math
import numpy as np
from typing import List, Dict, Tuple, Optional

def estimate_lead_time(history_scores: List[float], alert_threshold: float = 0.5) -> Optional[float]:
    """
    Fits a simple linear regression on the last 30 composite scores.
    If the slope is positive and current score is < alert_threshold,
    extrapolates to alert_threshold and returns estimated minutes.
    """
    clean_history = [v for v in history_scores if v is not None and not math.isnan(v)]
    N = min(30, len(clean_history))
    if N < 5:
        return None
    
    y = clean_history[-N:]
    x = list(range(N))
    
    mean_x = sum(x) / N
    mean_y = sum(y) / N
    
    num = sum((x[i] - mean_x) * (y[i] - mean_y) for i in range(N))
    den = sum((x[i] - mean_x) ** 2 for i in range(N))
    
    if den == 0:
        return None
        
    slope = num / den
    current_val = y[-1]
    
    if slope > 0 and current_val < alert_threshold:
        steps = (alert_threshold - current_val) / slope
        lead_time_min = steps / 30.0
        return max(0.1, round(lead_time_min, 1))
        
    return None

def compute_bootstrap_ci(
    buffers: Dict[str, List[float]], 
    alpha: Dict[str, float], 
    beta: Dict[str, float], 
    num_bootstraps: int = 50
) -> Tuple[float, float]:
    """
    Computes a 90% confidence interval (5th and 95th percentile) for the composite score
    using bootstrap resampling over the signal buffers.
    """
    signals = ["mic", "accel", "pressure", "wifi", "ble"]
    bootstrap_scores = []
    
    w = {}
    sum_w = 0.0
    for s in signals:
        w[s] = alpha[s] / (alpha[s] + beta[s])
        sum_w += w[s]
        
    if sum_w == 0:
        return 0.0, 0.0
        
    for s in signals:
        if len(buffers.get(s, [])) == 0:
            return 0.0, 0.0
            
    for _ in range(num_bootstraps):
        numerator = 0.0
        for s in signals:
            buf = list(buffers[s])
            sample = np.random.choice(buf, size=len(buf), replace=True)
            bootstrap_drift = float(np.mean(sample))
            sig_s = 1.0 / (1.0 + math.exp(-bootstrap_drift))
            numerator += w[s] * sig_s
            
        raw_score = numerator / sum_w
        comp_score = max(0.0, min(1.0, (raw_score - 0.5) * 2.0))
        bootstrap_scores.append(comp_score)
        
    p5 = float(np.percentile(bootstrap_scores, 5))
    p95 = float(np.percentile(bootstrap_scores, 95))
    
    return p5, p95
