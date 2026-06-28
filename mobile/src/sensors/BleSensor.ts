import { BleManager } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';

export class BleSensor {
  private manager: BleManager | null = null;
  private scanning = false;

  private getManager(): BleManager {
    if (!this.manager) {
      this.manager = new BleManager();
    }
    return this.manager;
  }

  async start(): Promise<void> {
    this.getManager();
  }

  async stop(): Promise<void> {
    if (this.manager && this.scanning) {
      this.manager.stopDeviceScan();
      this.scanning = false;
    }
  }

  private async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'ios') return true;

    try {
      // Android SDK 31+ requires explicit bluetooth scan/connect permissions
      if (Platform.OS === 'android' && Number(Platform.Version) >= 31) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return (
          granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
          granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED &&
          granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch (err) {
      console.warn('Error requesting BLE permissions:', err);
      return false;
    }
  }

  async scan(durationMs: number = 1800): Promise<{ device_count: number; mean_rssi: number | null }> {
    const hasPerms = await this.requestPermissions();
    if (!hasPerms) {
      return { device_count: 0, mean_rssi: null };
    }

    const manager = this.getManager();
    const foundDevices = new Map<string, number>();

    return new Promise((resolve) => {
      this.scanning = true;
      manager.startDeviceScan(null, null, (error, device) => {
        if (error) {
          console.warn('BLE Device scan error:', error);
          this.scanning = false;
          resolve({ device_count: 0, mean_rssi: null });
          return;
        }
        if (device && device.id) {
          foundDevices.set(device.id, device.rssi ?? -100);
        }
      });

      setTimeout(() => {
        if (this.scanning) {
          manager.stopDeviceScan();
          this.scanning = false;
        }

        const count = foundDevices.size;
        if (count === 0) {
          resolve({ device_count: 0, mean_rssi: null });
        } else {
          let sumRssi = 0;
          foundDevices.forEach((rssi) => {
            sumRssi += rssi;
          });
          resolve({
            device_count: count,
            mean_rssi: sumRssi / count
          });
        }
      }, durationMs);
    });
  }
}
