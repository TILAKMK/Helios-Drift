# PATENT PROVISIONAL APPLICATION SPECIFICATIONS
**Title**: SYSTEM AND METHOD FOR MULTI-MODAL WEAK-SIGNAL FUSION AND EARLY-WARNING ENVIRONMENTAL HAZARD PREDICTION

---

## 1. Technical Field
The present invention relates generally to IoT sensing and time-series anomaly detection. More specifically, it relates to algorithms for baseline drift isolation and spatial topological amplification coupled with multi-task neural network structures for predicting environmental hazards.

---

## 2. Background and Prior Art
Traditional urban hazard monitoring relies on reactive sensors that sound alerts only upon a single physical parameter breach. These designs fail to detect situations where multiple "weak" signals deviate simultaneously, signaling danger prior to any individual channel threshold crossing. Further, existing systems suffer from high false positive rates due to sensor calibration drift and local transient noise. The present invention addresses these limitations.

---

## 3. Detailed Description of the Invention
The invention comprises four primary computational stages: Ingestion, Isolation, Spatial Fusion, and Recurrent Multi-task Inference.

### 3.1 Adaptive Baseline Calibration & Drift Isolation
For each sensor channel $S_i$, the system maintains exponential moving average (EMA) statistics for mean $\mu_t$ and variance $\sigma^2_t$:
$$\mu_t = (1-\alpha)\mu_{t-1} + \alpha x_t$$
$$\sigma^2_t = (1-\alpha)\sigma^2_{t-1} + \alpha (x_t - \mu_t)^2$$
Ingestion values are transformed to z-scores:
$$z_{t, S_i} = \frac{x_t - \mu_{t-1}}{\sigma_{t-1}}$$
The system flags a channel as suffering from isolated calibration drift if its z-score deviates while other channels remain nominal:
$$\text{Isolate}(S_i) = \mathbb{I}(z_{S_i} > \theta_{\text{drift}} \land \forall j \neq i, z_{S_j} < \theta_{\text{nominal}})$$
This corresponds to the isolation logic implemented in [drift_detector.py](file:///c:/Users/Tilak%20M%20K/OneDrive/Pictures/Desktop/Helios-Drift/backend/core/drift_detector.py).

### 3.2 Spatial Graph Correlation
Spatially correlated nodes distribute hazard warnings along predefined topology links. The spatially expanded score $H_{\text{expanded}}$ is:
$$H_{\text{expanded}} = H_{\text{local}} \times \left(1 + \gamma \sum_{n \in \mathcal{N}} e^{-d_n} H_n\right)$$
where $\gamma$ is the spatial amplification scaling factor, corresponding to the topological fusion loops in [app.js](file:///c:/Users/Tilak%20M%20K/OneDrive/Pictures/Desktop/Helios-Drift/frontend/app.js).

### 3.3 Two-Headed Recurrent Multi-task Inference
A dual-head PyTorch LSTM architecture (implemented in [model.py](file:///c:/Users/Tilak%20M%20K/OneDrive/Pictures/Desktop/Helios-Drift/backend/ml/model.py)) ingests history windows $X$ to return event probability $\hat{p}$ and lead time minutes $\hat{y}$. The network optimizes a joint loss function:
$$\mathcal{L} = \mathcal{L}_{\text{BCE}}(\hat{p}, y) + \lambda \cdot \mathbb{I}(y = 1) \cdot \left(\frac{\hat{y} - y}{30.0}\right)^2$$

---

## 4. Patent Claims

We claim:
1. A computer-implemented method for multi-modal weak-signal environmental hazard prediction, comprising:
   - Ingesting a plurality of commodity telemetry signals from at least one client device;
   - Computing adaptive exponential moving averages for mean and variance values per signal;
   - Transforming raw telemetry values into standard deviation z-scores;
   - Detecting single-channel baseline calibration drift via isolated threshold comparison;
   - Aggregating non-isolated z-scores into a localized composite hazard score;
   - Computing topological spatial danger correlations; and
   - Feeding history windows of composite hazard scores into a recurrent neural network to forecast hazard events and estimate lead times.
2. The method of claim 1, wherein the recurrent neural network is a PyTorch LSTM model as defined in [model.py](file:///c:/Users/Tilak%20M%20K/OneDrive/Pictures/Desktop/Helios-Drift/backend/ml/model.py).
3. The method of claim 1, wherein baseline calibration stats are updated adaptively as described in [baseline_engine.py](file:///c:/Users/Tilak%20M%20K/OneDrive/Pictures/Desktop/Helios-Drift/backend/core/baseline_engine.py).
4. The method of claim 1, wherein drift isolation is executed via isolated channel check loops in [drift_detector.py](file:///c:/Users/Tilak%20M%20K/OneDrive/Pictures/Desktop/Helios-Drift/backend/core/drift_detector.py).
5. The method of claim 1, wherein spatial topological correlations are evaluated as shown in [score_aggregator.py](file:///c:/Users/Tilak%20M%20K/OneDrive/Pictures/Desktop/Helios-Drift/backend/core/score_aggregator.py).
6. The method of claim 1, wherein the neural network has a double-head layout outputting a classification probability and a normalized regression output.
7. The method of claim 6, wherein regression targets are scaled using a maximum time limit parameter.
8. The method of claim 1, wherein training sequences are prepared from historical TimescaleDB records using [data_pipeline.py](file:///c:/Users/Tilak%20M%20K/OneDrive/Pictures/Desktop/Helios-Drift/backend/ml/data_pipeline.py).
9. The method of claim 1, wherein live predictions are pushed to WebSocket connections by [sensors.py](file:///c:/Users/Tilak%20M%20K/OneDrive/Pictures/Desktop/Helios-Drift/backend/routers/sensors.py).
10. The method of claim 1, wherein estimated lead times are dynamically updated on an HTML5 dashboard using [app.js](file:///c:/Users/Tilak%20M%20K/OneDrive/Pictures/Desktop/Helios-Drift/frontend/app.js).
