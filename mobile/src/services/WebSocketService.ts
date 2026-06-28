import { SensorPayload } from '../types';

export class WebSocketService {
  private ws: WebSocket | null = null;
  private url = '';
  private status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting' = 'disconnected';
  private statusListeners: Array<(status: string) => void> = [];

  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelayMs = 3000;
  private reconnectTimer: any = null;
  private shouldReconnect = false;

  private buffer: SensorPayload[] = [];
  private maxBufferSize = 50;

  private setStatus(newStatus: 'connected' | 'connecting' | 'disconnected' | 'reconnecting') {
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      try {
        listener(newStatus);
      } catch (err) {
        console.error('Error invoking status callback:', err);
      }
    }
  }

  async connect(url: string): Promise<void> {
    this.url = url;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this.initiateConnection();
  }

  private initiateConnection() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }

    if (this.reconnectAttempts === 0) {
      this.setStatus('connecting');
    } else {
      this.setStatus('reconnecting');
    }

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log(`WebSocket connected to ${this.url}`);
        this.setStatus('connected');
        this.reconnectAttempts = 0;
        this.flushBuffer();
      };

      this.ws.onclose = () => {
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.attemptReconnect();
        } else {
          this.setStatus('disconnected');
        }
      };

      this.ws.onerror = (err) => {
        console.warn('WebSocket error registered:', err);
      };
    } catch (err) {
      console.warn('Failed to initiate WebSocket connection:', err);
      this.attemptReconnect();
    }
  }

  private attemptReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectAttempts++;
    // Exponential backoff capped at 30 seconds
    const delay = Math.min(30000, this.reconnectDelayMs * Math.pow(1.5, this.reconnectAttempts - 1));
    
    this.reconnectTimer = setTimeout(() => {
      this.initiateConnection();
    }, delay);
  }

  send(payload: SensorPayload): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        console.warn('Error during WebSocket send, buffering message:', err);
        this.bufferPayload(payload);
      }
    } else {
      this.bufferPayload(payload);
    }
  }

  private bufferPayload(payload: SensorPayload) {
    this.buffer.push(payload);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
  }

  private flushBuffer() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    while (this.buffer.length > 0) {
      const payload = this.buffer.shift();
      if (payload) {
        try {
          this.ws.send(JSON.stringify(payload));
        } catch (err) {
          console.warn('Error flushing message, re-buffering:', err);
          this.buffer.unshift(payload);
          break;
        }
      }
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  getStatus(): 'connected' | 'connecting' | 'disconnected' | 'reconnecting' {
    return this.status;
  }

  onStatusChange(cb: (status: string) => void): void {
    this.statusListeners.push(cb);
  }

  getBufferedCount(): number {
    return this.buffer.length;
  }
}
export const wsService = new WebSocketService();
