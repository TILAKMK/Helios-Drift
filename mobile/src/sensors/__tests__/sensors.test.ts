import { MicSensor } from '../MicSensor';
import { AccelSensor } from '../AccelSensor';
import { BaroSensor } from '../BaroSensor';
import { WifiSensor } from '../WifiSensor';
import { BleSensor } from '../BleSensor';

// 1. Mock expo-av
jest.mock('expo-av', () => ({
  Audio: {
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    setAudioModeAsync: jest.fn(),
    Recording: {
      createAsync: jest.fn().mockResolvedValue({
        recording: {
          setProgressUpdateInterval: jest.fn(),
          setOnRecordingStatusUpdate: jest.fn((callback) => {
            // Trigger status update
            setTimeout(() => callback({ metering: -20.0 }), 10);
          }),
          stopAndUnloadAsync: jest.fn(),
        },
      }),
    },
  },
}));

// 2. Mock expo-sensors
jest.mock('expo-sensors', () => ({
  Accelerometer: {
    setUpdateInterval: jest.fn(),
    addListener: jest.fn((callback) => {
      // Simulate callbacks
      callback({ x: 0.1, y: 0.2, z: 0.9 });
      return { remove: jest.fn() };
    }),
  },
  Barometer: {
    isAvailableAsync: jest.fn().mockResolvedValue(true),
    addListener: jest.fn((callback) => {
      callback({ pressure: 1013.2 });
      return { remove: jest.fn() };
    }),
  },
}));

// 3. Mock expo-network
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn().mockResolvedValue({
    isConnected: true,
    type: 'WIFI',
  }),
}));

// 4. Mock react-native Platform & PermissionsAndroid
jest.mock('react-native', () => {
  const rn = jest.requireActual('react-native');
  rn.PermissionsAndroid = {
    request: jest.fn().mockResolvedValue('granted'),
    requestMultiple: jest.fn().mockResolvedValue({
      'android.permission.BLUETOOTH_SCAN': 'granted',
      'android.permission.BLUETOOTH_CONNECT': 'granted',
      'android.permission.ACCESS_FINE_LOCATION': 'granted',
    }),
    RESULTS: { GRANTED: 'granted' },
    PERMISSIONS: {
      BLUETOOTH_SCAN: 'android.permission.BLUETOOTH_SCAN',
      BLUETOOTH_CONNECT: 'android.permission.BLUETOOTH_CONNECT',
      ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
    },
  };
  rn.Platform = {
    OS: 'android',
    Version: '31',
  };
  return rn;
});

// 5. Mock react-native-ble-plx
jest.mock('react-native-ble-plx', () => {
  class MockBleManager {
    startDeviceScan = jest.fn((uuid, options, callback) => {
      // Return 2 devices
      callback(null, { id: 'dev-1', rssi: -60 });
      callback(null, { id: 'dev-2', rssi: -80 });
    });
    stopDeviceScan = jest.fn();
  }
  return { BleManager: MockBleManager };
});

describe('Sensors Module Unit Tests', () => {
  
  test('MicSensor returns mapped metering decibel level', async () => {
    const mic = new MicSensor();
    await mic.start();
    
    // Wait for setOnRecordingStatusUpdate callback
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    // -20 metering mapped to 100 - 20 = 80 dB SPL
    expect(mic.getCurrentDb()).toBe(80.0);
    
    await mic.stop();
    expect(mic.getCurrentDb()).toBeNull();
  });

  test('AccelSensor computes averaged magnitude with gravity subtraction', async () => {
    const accel = new AccelSensor();
    await accel.start();
    
    const reading = accel.getReading();
    expect(reading).not.toBeNull();
    if (reading) {
      expect(reading.x).toBeCloseTo(0.1);
      expect(reading.y).toBeCloseTo(0.2);
      expect(reading.z).toBeCloseTo(0.9);
      // Raw magnitude of G vector(0.1, 0.2, 0.9) converted to m/s^2 is sqrt(x^2+y^2+z^2)*9.81
      // sqrt(0.01 + 0.04 + 0.81)*9.81 = sqrt(0.86)*9.81 = 0.927*9.81 = 9.096 m/s^2
      // Subtract gravity (9.81) -> max(0, 9.096 - 9.81) = 0
      expect(reading.magnitude).toBe(0);
    }
    
    await accel.stop();
  });

  test('BaroSensor returns current pressure value', async () => {
    const baro = new BaroSensor();
    await baro.start();
    
    expect(baro.getPressure()).toBe(1013.2);
    await baro.stop();
  });

  test('WifiSensor fetches network type and default strength', async () => {
    const wifi = new WifiSensor();
    const reading = await wifi.getReading();
    
    expect(reading.connected).toBe(true);
    expect(reading.type).toBe('wifi');
    expect(reading.strength).toBe(-55.0);
  });

  test('BleSensor scans for device density and averages RSSI', async () => {
    const ble = new BleSensor();
    await ble.start();
    
    const reading = await ble.scan(100);
    expect(reading.device_count).toBe(2);
    // Average of -60 and -80 is -70
    expect(reading.mean_rssi).toBe(-70.0);
    
    await ble.stop();
  });
});
