import { Accelerometer } from 'expo-sensors';

export class AccelSensor {
  private subscription: { remove: () => void } | null = null;
  private readings: Array<{ x: number; y: number; z: number }> = [];

  async start(): Promise<void> {
    this.readings = [];
    Accelerometer.setUpdateInterval(500);
    this.subscription = Accelerometer.addListener((data) => {
      this.readings.push(data);
      if (this.readings.length > 4) {
        this.readings.shift();
      }
    });
  }

  async stop(): Promise<void> {
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
    this.readings = [];
  }

  getReading(): { x: number; y: number; z: number; magnitude: number } | null {
    if (this.readings.length === 0) return null;

    let avgX = 0;
    let avgY = 0;
    let avgZ = 0;
    for (const r of this.readings) {
      avgX += r.x;
      avgY += r.y;
      avgZ += r.z;
    }
    avgX /= this.readings.length;
    avgY /= this.readings.length;
    avgZ /= this.readings.length;

    // Convert from G units (default in expo-sensors) to m/s^2 (1G = 9.81 m/s^2)
    const xMs2 = avgX * 9.81;
    const yMs2 = avgY * 9.81;
    const zMs2 = avgZ * 9.81;

    const rawMagnitude = Math.sqrt(xMs2 * xMs2 + yMs2 * yMs2 + zMs2 * zMs2);
    // Gravity removal: subtract 9.81 m/s^2 for motion-only magnitude
    const magnitude = Math.max(0, rawMagnitude - 9.81);

    return {
      x: avgX,
      y: avgY,
      z: avgZ,
      magnitude
    };
  }
}
