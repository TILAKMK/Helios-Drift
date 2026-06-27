# Phantom Protocol
> Predict environmental anomalies before they happen — using only a smartphone.

![Built with JS](https://img.shields.io/badge/Built_with-JS-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Research Project](https://img.shields.io/badge/Status-Research_Project-0052CC?style=for-the-badge)
![Patent Pending](https://img.shields.io/badge/Patent-Pending-FF0000?style=for-the-badge)
![NIE Mysuru](https://img.shields.io/badge/Institution-NIE_Mysuru-10B981?style=for-the-badge)

## 🔍 What it does
Phantom Protocol is an early-warning multi-modal weak-signal fusion engine. It fuses 5 distinct ambient signals (mic noise floor, WiFi RSSI, accelerometer microvibration, BLE density, and barometer) into a single, unified composite risk score. By tracking subtle, correlated deviations across these diverse channels, the system can predict environmental anomalies and hazards 5–30 minutes *before* any single sensor crosses a traditional critical threshold.

## ⚡ Why it's different
* **Pre-emptive over Reactive:** Existing systems wait for strong, explicit signals (e.g., loud alarms, significant structural shaking) to trigger an alert. Phantom Protocol identifies weak precursor signals.
* **Cross-Channel Correlation:** It detects correlated statistical drift across completely unrelated sensor channels, establishing confidence through multi-modal alignment rather than sheer magnitude.
* **Zero Special Hardware:** The entire protocol is designed to run on commodity, off-the-shelf smartphones, leveraging the dense sensor arrays that already exist in billions of pockets.
* **Adaptive Baselines:** Uses continuous Online Exponential Moving Average (EMA) and dynamic Z-score calculations to adapt to natural diurnal environmental changes, drastically reducing false positives.

## 🏗️ Architecture

```text
+--------------------------------------------------------------------+
|                 LAYER 3: COMPOSITE RISK & ALERT                    |
|                                                                    |
|  [ Composite Risk Score (H) ] ----> [ Early Warning Alert Engine ] |
+-----------------------------^--------------------------------------+
                              |
+-----------------------------|--------------------------------------+
|             LAYER 2: FUSION & DRIFT DETECTION                      |
|                                                                    |
|  [ Normalcy Manifold ] -> [ Drift Detector ] -> [ Bayesian Agg. ]  |
+-----------------------------^--------------------------------------+
                              |
+-----------------------------|--------------------------------------+
|                 LAYER 1: SIGNAL COLLECTION                         |
|                                                                    |
| [ Mic/Audio ] [ WiFi RSSI ] [ Accel ] [ BLE Density ] [ Barometer ]|
+--------------------------------------------------------------------+
