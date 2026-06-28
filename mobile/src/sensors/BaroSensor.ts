import { Barometer } from 'expo-sensors';

export class BaroSensor {
  private subscription: { remove: () => void } | null = null;
  private currentPressure: number | null = null;
  private firstCall = true;
  private available = false;

  async start(): Promise<void> {
    const isAvail = await this.isAvailable();
    if (this.firstCall) {
      console.log(`Barometer device capability: ${isAvail ? 'AVAILABLE' : 'UNAVAILABLE'}`);
      this.firstCall = false;
      this.available = isAvail;
    }

    if (!isAvail) return;

    this.subscription = Barometer.addListener((data) => {
      this.currentPressure = data.pressure;
    });
  }

  async stop(): Promise<void> {
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
    this.currentPressure = null;
  }

  getPressure(): number | null {
    return this.currentPressure;
  }

  async isAvailable(): Promise<boolean> {
    try {
      return await Barometer.isAvailableAsync();
    } catch {
      return false;
    }
  }
}
