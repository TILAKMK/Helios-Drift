import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Modal, TextInput, Alert, Share, Platform, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path, Polyline } from 'react-native-svg';
import { sessionManager } from '../src/services/SessionManager';
import { storageService } from '../src/services/StorageService';
import { wsService } from '../src/services/WebSocketService';
import { SensorPayload, AlertEvent } from '../src/types';

// Simple custom sparkline using Polyline
function Sparkline({ values, width = 80, height = 30, color = '#a78bfa' }: { values: number[], width?: number, height?: number, color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1.0);
  const min = Math.min(...values, 0.0);
  const range = max - min || 1.0;

  const points = values.map((val, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <Svg width={width} height={height}>
      <Polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        points={points}
      />
    </Svg>
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ envId: string, backendUrl: string }>();
  const envId = params.envId || 'classroom-nie-204';
  const backendUrl = params.backendUrl || 'ws://192.168.1.100:8000';

  const [isRunning, setIsRunning] = useState(false);
  const [uptime, setUptime] = useState('00:00:00');
  
  // Real-time sensor state
  const [compositeScore, setCompositeScore] = useState(0.0);
  const [anomalyState, setAnomalyState] = useState<'STABLE' | 'DRIFTING' | '⚠ ALERT'>('STABLE');
  const [channelsAbove, setChannelsAbove] = useState<string[]>([]);
  
  // Stats
  const [readingsSent, setReadingsSent] = useState(0);
  const [readingsBuffered, setReadingsBuffered] = useState(0);
  const [wsStatus, setWsStatus] = useState('disconnected');
  
  // Signal history arrays for sparklines (keep last 30 readings)
  const [micHistory, setMicHistory] = useState<number[]>([]);
  const [accelHistory, setAccelHistory] = useState<number[]>([]);
  const [baroHistory, setBaroHistory] = useState<number[]>([]);
  const [wifiHistory, setWifiHistory] = useState<number[]>([]);
  const [bleHistory, setBleHistory] = useState<number[]>([]);
  const [scoreHistory, setScoreHistory] = useState<number[]>([]);

  // Logs and UI states
  const [latestReadings, setLatestReadings] = useState<SensorPayload | null>(null);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [labelModalVisible, setLabelModalVisible] = useState(false);
  const [isSubmittingLabel, setIsSubmittingLabel] = useState(false);

  // Label Form Fields
  const [eventType, setEventType] = useState('false_alarm');
  const [severity, setSeverity] = useState(1);
  const [notes, setNotes] = useState('');

  // Refs for tracking timers
  const timerRef = useRef<any>(null);

  useEffect(() => {
    // Start Session Manager
    const start = async () => {
      try {
        await sessionManager.startSession(envId, backendUrl);
        setIsRunning(true);
      } catch (err) {
        Alert.alert('Session Error', 'Could not establish connection to backend.');
        router.back();
      }
    };
    start();

    // Map UI Updates
    sessionManager.onReading((payload) => {
      setLatestReadings(payload);
      
      // Update sparkline histories
      setMicHistory(prev => [...prev.slice(-29), payload.readings.mic_db ?? 30]);
      setAccelHistory(prev => [...prev.slice(-29), payload.readings.accel_magnitude ?? 0]);
      setBaroHistory(prev => [...prev.slice(-29), payload.readings.pressure_hpa ?? 1013]);
      setWifiHistory(prev => [...prev.slice(-29), payload.readings.wifi_rssi ?? -100]);
      setBleHistory(prev => [...prev.slice(-29), payload.readings.ble_count ?? 0]);

      // Update local telemetry stats
      const stats = sessionManager.getSessionStats();
      setReadingsSent(stats.readings_sent);
      setReadingsBuffered(stats.readings_buffered);
      setWsStatus(stats.ws_status);
    });

    sessionManager.onAlert((alert) => {
      setAlerts(prev => [alert, ...prev.slice(0, 4)]);
      setCompositeScore(alert.composite_score);
      setChannelsAbove(alert.channels_above);
      setAnomalyState(alert.composite_score > 0.6 ? '⚠ ALERT' : 'DRIFTING');
    });

    // Directly intercept stream websocket to receive live composite scores
    const monitorWsPackets = () => {
      const wsRaw = (wsService as any).ws;
      if (wsRaw) {
        wsRaw.addEventListener('message', (event: any) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'drift_result') {
              const score = data.composite_score || 0;
              setCompositeScore(score);
              setChannelsAbove(data.channels_above || []);
              setScoreHistory(prev => [...prev.slice(-29), score]);

              if (score > 0.6) {
                setAnomalyState('⚠ ALERT');
              } else if (score > 0.3) {
                setAnomalyState('DRIFTING');
              } else {
                setAnomalyState('STABLE');
              }
            }
          } catch {}
        });
      }
    };

    // Wait a brief moment for ws setup to bind message event listener
    setTimeout(monitorWsPackets, 1500);

    // Track Uptime Clock
    timerRef.current = setInterval(() => {
      const stats = sessionManager.getSessionStats();
      const s = stats.uptime_seconds;
      const hrs = Math.floor(s / 3600).toString().padStart(2, '0');
      const mins = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
      const secs = (s % 60).toString().padStart(2, '0');
      setUptime(`${hrs}:${mins}:${secs}`);
    }, 1000);

    return () => {
      clearInterval(timerRef.current);
      sessionManager.stopSession();
    };
  }, []);

  const handleStop = async () => {
    await sessionManager.stopSession();
    setIsRunning(false);
    router.back();
  };

  const handleExport = async () => {
    const stats = sessionManager.getSessionStats();
    if (!stats.session_id) return;
    
    try {
      const jsonStr = await storageService.exportSession(stats.session_id);
      await Share.share({
        title: 'Export Telemetry Session',
        message: jsonStr
      });
    } catch (err) {
      Alert.alert('Export Failed', String(err));
    }
  };

  const handleLabelSubmit = async () => {
    setIsSubmittingLabel(true);
    const stats = sessionManager.getSessionStats();
    
    const labelPayload = {
      env_id: envId,
      device_id: stats.device_id,
      session_id: stats.session_id,
      event_type: eventType,
      severity: severity,
      notes: notes || '',
      timestamp: new Date().toISOString(),
      composite_score_at_time: compositeScore
    };

    try {
      const httpBase = backendUrl.replace('ws://', 'http://').replace('wss://', 'https://');
      const response = await fetch(`${httpBase}/api/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(labelPayload)
      });

      if (!response.ok) throw new Error('API rejection');

      Alert.alert('Label Logged', '✓ Ground truth tag synced to server.');
      setLabelModalVisible(false);
      setNotes('');
    } catch {
      Alert.alert('Sync Offline', 'Saved label locally only. Will flush on recovery.');
      setLabelModalVisible(false);
    } finally {
      setIsSubmittingLabel(false);
    }
  };

  const getScoreColor = () => {
    if (compositeScore > 0.6) return '#ef4444'; // Red
    if (compositeScore > 0.3) return '#fbbf24'; // Amber
    return '#10b981'; // Green
  };

  // SVG parameters for circular score gauge
  const radius = 50;
  const strokeWidth = 8;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (compositeScore * circumference);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.badgeRow}>
            <View style={[styles.pulseBadge, wsStatus === 'connected' ? styles.pulseBadgeGreen : styles.pulseBadgeAmber]} />
            <Text style={styles.uptime}>{uptime}</Text>
          </View>
          <Text style={styles.envTitle}>{envId.toUpperCase()}</Text>
          <TouchableOpacity style={styles.stopBtn} onPress={handleStop}>
            <Text style={styles.stopBtnText}>STOP</Text>
          </TouchableOpacity>
        </View>

        {/* GAUGE CARD */}
        <View style={styles.gaugeCard}>
          <View style={styles.gaugeContainer}>
            <Svg width="140" height="140" style={styles.gaugeSvg}>
              <Circle
                cx="70"
                cy="70"
                r={radius}
                stroke="#1e293b"
                strokeWidth={strokeWidth}
                fill="transparent"
              />
              <Circle
                cx="70"
                cy="70"
                r={radius}
                stroke={getScoreColor()}
                strokeWidth={strokeWidth}
                fill="transparent"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                transform="rotate(-90 70 70)"
              />
            </Svg>
            <View style={styles.gaugeTextContainer}>
              <Text style={[styles.gaugeVal, { color: getScoreColor() }]}>
                {compositeScore.toFixed(2)}
              </Text>
            </View>
          </View>
          <Text style={[styles.gaugeStatusLabel, { color: getScoreColor() }]}>
            {anomalyState}
          </Text>
        </View>

        {/* METRICS GRID */}
        <View style={styles.grid}>
          {/* MIC */}
          <View style={[styles.card, channelsAbove.includes('mic') && styles.cardGlow]}>
            <Text style={styles.cardName}>MIC dB</Text>
            <Text style={styles.cardVal}>{latestReadings?.readings.mic_db?.toFixed(1) || '0.0'}</Text>
            <View style={styles.sparkWrapper}>
              <Sparkline values={micHistory} color={channelsAbove.includes('mic') ? '#c084fc' : '#38bdf8'} />
            </View>
          </View>

          {/* ACCEL */}
          <View style={[styles.card, channelsAbove.includes('accel') && styles.cardGlow]}>
            <Text style={styles.cardName}>ACCEL (g)</Text>
            <Text style={styles.cardVal}>{latestReadings?.readings.accel_magnitude?.toFixed(3) || '0.000'}</Text>
            <View style={styles.sparkWrapper}>
              <Sparkline values={accelHistory} color={channelsAbove.includes('accel') ? '#c084fc' : '#34d399'} />
            </View>
          </View>

          {/* PRESSURE */}
          <View style={[styles.card, channelsAbove.includes('pressure') && styles.cardGlow]}>
            <Text style={styles.cardName}>PRESSURE (hPa)</Text>
            <Text style={styles.cardVal}>{latestReadings?.readings.pressure_hpa?.toFixed(1) || '0.0'}</Text>
            <View style={styles.sparkWrapper}>
              <Sparkline values={baroHistory} color={channelsAbove.includes('pressure') ? '#c084fc' : '#a78bfa'} />
            </View>
          </View>

          {/* WIFI */}
          <View style={[styles.card, channelsAbove.includes('wifi') && styles.cardGlow]}>
            <Text style={styles.cardName}>WIFI RSSI</Text>
            <Text style={styles.cardVal}>{latestReadings?.readings.wifi_rssi || 'N/A'}</Text>
            <View style={styles.sparkWrapper}>
              <Sparkline values={wifiHistory} color={channelsAbove.includes('wifi') ? '#c084fc' : '#fb7185'} />
            </View>
          </View>

          {/* BLE */}
          <View style={[styles.card, channelsAbove.includes('ble') && styles.cardGlow]}>
            <Text style={styles.cardName}>BLE SCAN</Text>
            <Text style={styles.cardVal}>{latestReadings?.readings.ble_count || '0'} dev</Text>
            <View style={styles.sparkWrapper}>
              <Sparkline values={bleHistory} color={channelsAbove.includes('ble') ? '#c084fc' : '#f59e0b'} />
            </View>
          </View>

          {/* COMPOSITE */}
          <View style={[styles.card, compositeScore > 0.5 && styles.cardGlow]}>
            <Text style={styles.cardName}>RISK SCORE</Text>
            <Text style={styles.cardVal}>{compositeScore.toFixed(2)}</Text>
            <View style={styles.sparkWrapper}>
              <Sparkline values={scoreHistory} color={getScoreColor()} />
            </View>
          </View>
        </View>

        {/* CONNECTION STATS */}
        <View style={styles.statsBar}>
          <Text style={styles.statsText}>Sent: {readingsSent}</Text>
          <Text style={styles.statsText}>Buffered: {readingsBuffered}</Text>
          <Text style={styles.statsText}>Socket: {wsStatus.toUpperCase()}</Text>
        </View>

        {/* ALERT LOG */}
        <View style={styles.logBox}>
          <Text style={styles.logHeader}>CRITICAL ALERT FEED</Text>
          {alerts.length === 0 ? (
            <Text style={styles.logPlaceholder}>No anomalies triggered in current session</Text>
          ) : (
            alerts.map((al, idx) => (
              <Text key={idx} style={styles.logText}>
                {new Date(al.triggered_at).toLocaleTimeString()} ⚠ score: {al.composite_score.toFixed(2)} channels: {al.channels_above.join(',')}
              </Text>
            ))
          )}
        </View>

        {/* EXPORT ACTION */}
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport}>
          <Text style={styles.exportBtnText}>EXPORT SESSION JSON</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* FLOATING ACTION LABEL BUTTON */}
      <TouchableOpacity 
        style={styles.labelBtn} 
        onPress={() => setLabelModalVisible(true)}
        activeOpacity={0.85}
      >
        <Text style={styles.labelBtnText}>TAG</Text>
      </TouchableOpacity>

      {/* MODAL CONFIG */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={labelModalVisible}
        onRequestClose={() => setLabelModalVisible(false)}
      >
        <View style={styles.modalBg}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Tag Environment Moment</Text>

            <View style={styles.modalForm}>
              <Text style={styles.formLabel}>EVENT TYPE</Text>
              <View style={styles.pickerAlternative}>
                {['fire_drill', 'power_cut', 'crowd_surge', 'equipment_failure', 'weather_change', 'false_alarm'].map(type => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.pickerBtn, eventType === type && styles.pickerBtnSelected]}
                    onPress={() => setEventType(type)}
                  >
                    <Text style={[styles.pickerBtnText, eventType === type && styles.pickerBtnTextSelected]}>
                      {type.replace('_', ' ').toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.formLabel}>SEVERITY (1 - 5)</Text>
              <View style={styles.severityRow}>
                {[1, 2, 3, 4, 5].map(num => (
                  <TouchableOpacity
                    key={num}
                    style={[styles.severityBtn, severity === num && styles.severityBtnSelected]}
                    onPress={() => setSeverity(num)}
                  >
                    <Text style={[styles.severityBtnText, severity === num && styles.severityBtnTextSelected]}>
                      {num}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.formLabel}>ADDITIONAL CONTEXT</Text>
              <TextInput
                style={styles.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="Describe current environmental circumstances..."
                placeholderTextColor="#64748b"
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={styles.modalCancel} 
                onPress={() => setLabelModalVisible(false)}
                disabled={isSubmittingLabel}
              >
                <Text style={styles.modalCancelText}>CANCEL</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.modalSubmit} 
                onPress={handleLabelSubmit}
                disabled={isSubmittingLabel}
              >
                {isSubmittingLabel ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalSubmitText}>SUBMIT LOG</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1B2A',
  },
  scrollContainer: {
    padding: 20,
    paddingTop: 54,
    paddingBottom: 80,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1b263b',
    paddingBottom: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pulseBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pulseBadgeGreen: {
    backgroundColor: '#10b981',
  },
  pulseBadgeAmber: {
    backgroundColor: '#f59e0b',
  },
  uptime: {
    color: '#94a3b8',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontWeight: 'bold',
  },
  envTitle: {
    color: '#8b5cf6',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  stopBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
  },
  stopBtnText: {
    color: '#ef4444',
    fontSize: 10,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  gaugeCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 20,
    marginBottom: 20,
  },
  gaugeContainer: {
    position: 'relative',
    width: 140,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gaugeSvg: {
    position: 'absolute',
  },
  gaugeTextContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  gaugeVal: {
    fontSize: 28,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  gaugeStatusLabel: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  card: {
    width: '48%',
    backgroundColor: '#1b263b',
    borderWidth: 1,
    borderColor: '#415a77',
    borderRadius: 6,
    padding: 12,
    position: 'relative',
  },
  cardGlow: {
    borderColor: '#8b5cf6',
    borderWidth: 1.5,
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 3,
  },
  cardName: {
    fontSize: 9,
    color: '#64748b',
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  cardVal: {
    fontSize: 15,
    color: '#f8fafc',
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    marginBottom: 8,
  },
  sparkWrapper: {
    alignItems: 'center',
    marginTop: 4,
  },
  statsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 4,
    padding: 10,
    marginBottom: 20,
  },
  statsText: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  logBox: {
    backgroundColor: '#09111e',
    borderWidth: 1,
    borderColor: '#1b263b',
    borderRadius: 6,
    padding: 12,
    height: 120,
    marginBottom: 20,
  },
  logHeader: {
    fontSize: 9,
    color: '#64748b',
    fontWeight: 'bold',
    letterSpacing: 1.5,
    marginBottom: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  logPlaceholder: {
    color: '#475569',
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 24,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  logText: {
    color: '#f43f5e',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    marginBottom: 4,
  },
  exportBtn: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 6,
    paddingVertical: 14,
    alignItems: 'center',
  },
  exportBtnText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  labelBtn: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
  labelBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(9, 17, 30, 0.85)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0D1B2A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 20,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  modalForm: {
    marginBottom: 24,
  },
  formLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: 'bold',
    letterSpacing: 1.5,
    marginBottom: 8,
    marginTop: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  pickerAlternative: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pickerBtn: {
    backgroundColor: '#1b263b',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#415a77',
  },
  pickerBtnSelected: {
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  pickerBtnText: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  pickerBtnTextSelected: {
    color: '#fff',
  },
  severityRow: {
    flexDirection: 'row',
    gap: 12,
  },
  severityBtn: {
    flex: 1,
    backgroundColor: '#1b263b',
    paddingVertical: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#415a77',
    alignItems: 'center',
  },
  severityBtnSelected: {
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  severityBtnText: {
    color: '#94a3b8',
    fontWeight: 'bold',
  },
  severityBtnTextSelected: {
    color: '#fff',
  },
  notesInput: {
    backgroundColor: '#1b263b',
    borderWidth: 1,
    borderColor: '#415a77',
    borderRadius: 6,
    color: '#f8fafc',
    padding: 12,
    textAlignVertical: 'top',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 16,
  },
  modalCancel: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#415a77',
    borderRadius: 6,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  modalSubmit: {
    flex: 2,
    backgroundColor: '#ef4444',
    borderRadius: 6,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalSubmitText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  }
});
