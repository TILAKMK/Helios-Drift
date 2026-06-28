import { MicSensor } from '../sensors/MicSensor';
import { AccelSensor } from '../sensors/AccelSensor';
import { BaroSensor } from '../sensors/BaroSensor';
import { WifiSensor } from '../sensors/WifiSensor';
import { BleSensor } from '../sensors/BleSensor';
import { wsService } from './WebSocketService';
import { storageService } from './StorageService';
import { SensorPayload, SessionStats, AlertEvent } from '../types';
import { generateUUID } from '../utils/uuid';

export class SessionManager {
  private micSensor = new MicSensor();
  private accelSensor = new AccelSensor();
  private baroSensor = new BaroSensor();
  private wifiSensor = new WifiSensor();
  private bleSensor = new BleSensor();

  private pollingInterval: any = null;
  private isRunning = false;

  private sessionId = '';
  private deviceId = '';
  private envId = '';
  private startedAt = '';

  private readingsSent = 0;

  private readingListeners: Array<(payload: SensorPayload) => void> = [];
  private alertListeners: Array<(alert: AlertEvent) => void> = [];

  async startSession(envId: string, backendUrl: string): Promise<string> {
    if (this.isRunning) return this.sessionId;

    this.sessionId = generateUUID();
    this.deviceId = await storageService.getDeviceId();
    this.envId = envId;
    this.startedAt = new Date().toISOString();
    this.readingsSent = 0;
    this.isRunning = true;

    // 1. Init Storage session context
    await storageService.initSession(this.sessionId);

    // 2. Start all local sensor captures
    await this.micSensor.start();
    await this.accelSensor.start();
    await this.baroSensor.start();
    await this.bleSensor.start();

    // 3. Connect to WebSocket stream
    await wsService.connect(`${backendUrl}/ws/sensor-stream/${envId}?device_id=${this.deviceId}`);

    // Map WebSocket listener internally to propagate incoming alerts
    const wsRaw = (wsService as any).ws;
    if (wsRaw) {
      wsRaw.onmessage = (event: any) => {
        try {
          const data = JSON.parse(event.data);
          // If backend returns alert metrics (drift result)
          if (data.type === "drift_result" && data.alert_triggered) {
            const alert: AlertEvent = {
              env_id: this.envId,
              composite_score: data.composite_score,
              channels_above: data.channels_above || [],
              triggered_at: new Date().toISOString(),
              lead_time_estimate_min: data.lead_time_estimate_min,
            };
            this.alertListeners.forEach(listener => listener(alert));
          }
        } catch {}
      };
    }

    // 4. Start polling intervals
    this.pollingInterval = setInterval(async () => {
      await this.pollSensors();
    }, 2000);

    return this.sessionId;
  }

  private async pollSensors() {
    if (!this.isRunning) return;

    try {
      const micDb = this.micSensor.getCurrentDb();
      const accel = this.accelSensor.getReading();
      const pressure = this.baroSensor.getPressure();

      // Read WiFi and scan BLE concurrently
      const [wifi, ble] = await Promise.all([
        this.wifiSensor.getReading(),
        this.bleSensor.scan(1800),
      ]);

      const payload: SensorPayload = {
        device_id: this.deviceId,
        env_id: this.envId,
        session_id: this.sessionId,
        timestamp: new Date().toISOString(),
        readings: {
          mic_db: micDb,
          accel_x: accel ? accel.x : null,
          accel_y: accel ? accel.y : null,
          accel_z: accel ? accel.z : null,
          accel_magnitude: accel ? accel.magnitude : null,
          pressure_hpa: pressure,
          wifi_rssi: wifi.strength,
          wifi_ap_count: wifi.connected ? 1 : 0,
          ble_count: ble.device_count,
          ble_mean_rssi: ble.mean_rssi,
        },
      };

      // Disseminate to backend
      wsService.send(payload);
      if (wsService.getStatus() === 'connected') {
        this.readingsSent++;
      }

      // Save locally
      await storageService.saveReading(payload);

      // Notify UI
      this.readingListeners.forEach(listener => listener(payload));
    } catch (err) {
      console.warn('Error encountered in SessionManager polling loop:', err);
    }
  }

  async stopSession(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    await this.micSensor.stop();
    await this.accelSensor.stop();
    await this.baroSensor.stop();
    await this.bleSensor.stop();

    wsService.disconnect();
    await storageService.flushToDisk();
  }

  onReading(cb: (payload: SensorPayload) => void): void {
    this.readingListeners.push(cb);
  }

  onAlert(cb: (alert: AlertEvent) => void): void {
    this.alertListeners.push(cb);
  }

  getSessionStats(): SessionStats {
    const uptime = this.startedAt ? Math.round((Date.now() - Date.parse(this.startedAt)) / 1000) : 0;
    return {
      session_id: this.sessionId,
      device_id: this.deviceId,
      env_id: this.envId,
      uptime_seconds: uptime,
      readings_sent: this.readingsSent,
      readings_buffered: wsService.getBufferedCount(),
      ws_status: wsService.getStatus(),
      started_at: this.startedAt,
    };
  }
}
export const sessionManager = new SessionManager();
