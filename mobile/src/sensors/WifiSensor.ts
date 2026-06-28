import * as Network from 'expo-network';

export class WifiSensor {
  /**
   * Reads current network status using expo-network.
   * 
   * LIMITATION NOTE:
   * expo-network does not expose detailed Wi-Fi Access Point (AP) details or raw 
   * SSID/AP counts due to sandboxing and OS-level privacy locks. To compile full 
   * spatial AP metrics on Android, a custom native Expo module wrapping 
   * Android's WifiManager is needed to request ACCESS_FINE_LOCATION and execute startScan().
   * Here, we fetch connection state and return default signal strengths when active.
   */
  async getReading(): Promise<{ connected: boolean; type: string; strength: number | null }> {
    try {
      const state = await Network.getNetworkStateAsync();
      const isConnected = !!state.isConnected;
      const type = state.type ? state.type.toLowerCase() : 'none';
      
      // Default placeholder RSSI for WiFi signals
      const strength = (isConnected && type === 'wifi') ? -55.0 : null;

      return {
        connected: isConnected,
        type,
        strength
      };
    } catch (err) {
      console.warn('Error fetching Wifi network status:', err);
      return {
        connected: false,
        type: 'none',
        strength: null
      };
    }
  }
}
