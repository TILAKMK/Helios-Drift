import AsyncStorage from '@react-native-async-storage/async-storage';
import { SensorPayload } from '../types';
import { generateUUID } from '../utils/uuid';

const STORAGE_KEYS = {
  DEVICE_ID: '@phantom_device_id',
  READINGS_PREFIX: '@phantom_readings_',
  ACTIVE_SESSION: '@phantom_active_session_id',
  ALL_SESSIONS: '@phantom_sessions_list',
};

export class StorageService {
  private inMemoryReadings: SensorPayload[] = [];
  private currentSessionId = '';
  private lastSaveTime = 0;

  async getDeviceId(): Promise<string> {
    try {
      let id = await AsyncStorage.getItem(STORAGE_KEYS.DEVICE_ID);
      if (!id) {
        id = generateUUID();
        await AsyncStorage.setItem(STORAGE_KEYS.DEVICE_ID, id);
      }
      return id;
    } catch {
      return generateUUID();
    }
  }

  async setDeviceId(id: string): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.DEVICE_ID, id);
  }

  async initSession(sessionId: string): Promise<void> {
    this.currentSessionId = sessionId;
    this.inMemoryReadings = [];
    this.lastSaveTime = Date.now();
    await AsyncStorage.setItem(STORAGE_KEYS.ACTIVE_SESSION, sessionId);

    try {
      const listStr = await AsyncStorage.getItem(STORAGE_KEYS.ALL_SESSIONS);
      const list = listStr ? JSON.parse(listStr) : [];
      if (!list.includes(sessionId)) {
        list.push(sessionId);
        await AsyncStorage.setItem(STORAGE_KEYS.ALL_SESSIONS, JSON.stringify(list));
      }
    } catch {}
  }

  async saveReading(payload: SensorPayload): Promise<void> {
    this.inMemoryReadings.push(payload);

    if (this.inMemoryReadings.length > 5000) {
      this.inMemoryReadings.shift();
    }

    const now = Date.now();
    // Flush to disk every 10 seconds to avoid blocking main thread execution
    if (now - this.lastSaveTime > 10000) {
      await this.flushToDisk();
      this.lastSaveTime = now;
    }
  }

  async flushToDisk(): Promise<void> {
    if (!this.currentSessionId) return;
    try {
      await AsyncStorage.setItem(
        `${STORAGE_KEYS.READINGS_PREFIX}${this.currentSessionId}`,
        JSON.stringify(this.inMemoryReadings)
      );
    } catch (err) {
      console.warn('Error flushing telemetry buffer to AsyncStorage:', err);
    }
  }

  async getReadings(limit = 150): Promise<SensorPayload[]> {
    if (this.inMemoryReadings.length > 0) {
      return this.inMemoryReadings.slice(-limit);
    }

    try {
      const activeSession = await AsyncStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION);
      if (activeSession) {
        const dataStr = await AsyncStorage.getItem(`${STORAGE_KEYS.READINGS_PREFIX}${activeSession}`);
        if (dataStr) {
          const list = JSON.parse(dataStr);
          this.inMemoryReadings = list;
          return list.slice(-limit);
        }
      }
    } catch {}
    return [];
  }

  async exportSession(sessionId: string): Promise<string> {
    try {
      await this.flushToDisk();
      const dataStr = await AsyncStorage.getItem(`${STORAGE_KEYS.READINGS_PREFIX}${sessionId}`);
      if (!dataStr) return JSON.stringify({ error: "Session data not found" });

      const list = JSON.parse(dataStr);
      const deviceId = await this.getDeviceId();
      const exportObject = {
        session_id: sessionId,
        device_id: deviceId,
        exported_at: new Date().toISOString(),
        readings: list,
      };

      return JSON.stringify(exportObject, null, 2);
    } catch (err) {
      console.warn('Error exporting session telemetry:', err);
      return JSON.stringify({ error: String(err) });
    }
  }

  async clearSession(sessionId: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(`${STORAGE_KEYS.READINGS_PREFIX}${sessionId}`);
      const listStr = await AsyncStorage.getItem(STORAGE_KEYS.ALL_SESSIONS);
      if (listStr) {
        let list = JSON.parse(listStr);
        list = list.filter((id: string) => id !== sessionId);
        await AsyncStorage.setItem(STORAGE_KEYS.ALL_SESSIONS, JSON.stringify(list));
      }
      if (this.currentSessionId === sessionId) {
        this.currentSessionId = '';
        this.inMemoryReadings = [];
        await AsyncStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSION);
      }
    } catch (err) {
      console.warn('Error deleting session data:', err);
    }
  }

  async getAllSessions(): Promise<string[]> {
    try {
      const listStr = await AsyncStorage.getItem(STORAGE_KEYS.ALL_SESSIONS);
      return listStr ? JSON.parse(listStr) : [];
    } catch {
      return [];
    }
  }

  async clearAllData(): Promise<void> {
    try {
      const list = await this.getAllSessions();
      for (const id of list) {
        await AsyncStorage.removeItem(`${STORAGE_KEYS.READINGS_PREFIX}${id}`);
      }
      await AsyncStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSION);
      await AsyncStorage.removeItem(STORAGE_KEYS.ALL_SESSIONS);
      await AsyncStorage.removeItem(STORAGE_KEYS.DEVICE_ID);
      this.currentSessionId = '';
      this.inMemoryReadings = [];
    } catch (err) {
      console.warn('Error clearing entire AsyncStorage store:', err);
    }
  }
}
export const storageService = new StorageService();
