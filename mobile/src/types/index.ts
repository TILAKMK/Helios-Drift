export interface SensorPayload {
  device_id: string;
  env_id: string;
  session_id: string;
  timestamp: string;  // ISO8601
  readings: {
    mic_db: number | null;
    accel_x: number | null;
    accel_y: number | null;
    accel_z: number | null;
    accel_magnitude: number | null;
    pressure_hpa: number | null;
    wifi_rssi: number | null;
    wifi_ap_count: number | null;
    ble_count: number | null;
    ble_mean_rssi: number | null;
  };
}

export interface SessionStats {
  session_id: string;
  device_id: string;
  env_id: string;
  uptime_seconds: number;
  readings_sent: number;
  readings_buffered: number;
  ws_status: string;
  started_at: string;
}

export interface AlertEvent {
  env_id: string;
  composite_score: number;
  channels_above: string[];
  triggered_at: string;
  lead_time_estimate_min: number | null;
}
