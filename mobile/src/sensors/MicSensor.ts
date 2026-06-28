import { Audio } from 'expo-av';

export class MicSensor {
  private recording: Audio.Recording | null = null;
  private currentDb: number | null = null;

  async start(): Promise<void> {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        console.warn('AUDIO_RECORDING permission denied');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Create recording in metering-only mode
      const { recording } = await Audio.Recording.createAsync(
        {
          android: {
            extension: '.m4a',
            outputFormat: 2, // MPEG_4
            audioEncoder: 3, // AAC
            sampleRate: 44100,
            numberOfChannels: 1,
            bitRate: 128000,
          },
          ios: {
            extension: '.m4a',
            audioQuality: 0x7f,
            sampleRate: 44100,
            numberOfChannels: 1,
            bitRate: 128000,
            linearPCMBitDepth: 16,
            linearPCMIsBigEndian: false,
            linearPCMIsFloat: false,
          },
          web: {},
        }
      );

      this.recording = recording;
      await this.recording.setProgressUpdateInterval(500);

      this.recording.setOnRecordingStatusUpdate((status) => {
        if (status.metering !== undefined) {
          // expo-av metering range is [-160, 0] dBFS
          // Map to a positive relative dB sound pressure level (SPL) offset (30 to 120 dB)
          const splDb = Math.max(30, 100 + status.metering);
          this.currentDb = splDb;
        }
      });
    } catch (err) {
      console.warn('Error starting MicSensor:', err);
    }
  }

  async stop(): Promise<void> {
    try {
      if (this.recording) {
        await this.recording.stopAndUnloadAsync();
        this.recording = null;
      }
      this.currentDb = null;
    } catch (err) {
      console.warn('Error stopping MicSensor:', err);
    }
  }

  getCurrentDb(): number | null {
    return this.currentDb;
  }
}
