import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { wsService } from '../src/services/WebSocketService';
import { storageService } from '../src/services/StorageService';
import { CONFIG } from '../constants/Config';

export default function HomeScreen() {
  const router = useRouter();
  const [envId, setEnvId] = useState(CONFIG.ENV_ID);
  const [backendUrl, setBackendUrl] = useState(CONFIG.BACKEND_WS.replace('/ws/sensor-stream', ''));
  const [wsStatus, setWsStatus] = useState<'connected' | 'connecting' | 'disconnected' | 'reconnecting'>('disconnected');

  useEffect(() => {
    // Load config from storage if available
    const loadSavedConfig = async () => {
      try {
        const savedUrl = await storageService.getReadings(1); // probe storage
        // We can just keep the hooks initialized
      } catch {}
    };
    loadSavedConfig();

    // Listen to WS Service status changes
    setWsStatus(wsService.getStatus());
    wsService.onStatusChange((status: any) => {
      setWsStatus(status);
    });
  }, []);

  const handleStartSession = () => {
    if (!envId.trim() || !backendUrl.trim()) return;
    
    // Navigate and pass params
    router.push({
      pathname: '/dashboard',
      params: { envId, backendUrl }
    });
  };

  const getStatusBadgeStyle = () => {
    switch (wsStatus) {
      case 'connected': return styles.badgeLive;
      case 'connecting':
      case 'reconnecting': return styles.badgeConnecting;
      default: return styles.badgeDisconnected;
    }
  };

  const getStatusText = () => {
    switch (wsStatus) {
      case 'connected': return 'LIVE';
      case 'connecting': return 'CONNECTING';
      case 'reconnecting': return 'RECONNECTING';
      default: return 'DISCONNECTED';
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.header}>
        <Text style={styles.logo}>PHANTOM</Text>
        <Text style={styles.subtitle}>WEAK-SIGNAL FUSION COCKPIT</Text>
      </View>

      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>ENVIRONMENT ID</Text>
          <TextInput
            style={styles.input}
            value={envId}
            onChangeText={setEnvId}
            placeholder="e.g. classroom-nie-204"
            placeholderTextColor="#4b5563"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>BACKEND SERVER URL</Text>
          <TextInput
            style={styles.input}
            value={backendUrl}
            onChangeText={setBackendUrl}
            placeholder="ws://192.168.x.x:8000"
            placeholderTextColor="#4b5563"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>STATUS:</Text>
          <View style={[styles.badge, getStatusBadgeStyle()]}>
            <Text style={styles.badgeText}>{getStatusText()}</Text>
          </View>
        </View>

        <TouchableOpacity 
          style={styles.button}
          onPress={handleStartSession}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>START TELEMETRY SESSION</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.settingsButton}
          onPress={() => router.push('/settings')}
        >
          <Text style={styles.settingsButtonText}>SETTINGS & CONFIG</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1B2A',
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logo: {
    fontSize: 48,
    fontWeight: '900',
    color: '#8b5cf6', // neon purple
    letterSpacing: 6,
    textShadowColor: 'rgba(139, 92, 246, 0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 15,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  subtitle: {
    fontSize: 10,
    color: '#64748b',
    letterSpacing: 2,
    marginTop: 8,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  form: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    padding: 24,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  input: {
    backgroundColor: '#1b263b',
    borderWidth: 1,
    borderColor: '#415a77',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#f8fafc',
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    gap: 8,
  },
  statusLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  badgeLive: {
    backgroundColor: 'rgba(52, 211, 153, 0.1)',
    borderColor: '#34d399',
    color: '#34d399',
  },
  badgeConnecting: {
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    borderColor: '#fbbf24',
    color: '#fbbf24',
  },
  badgeDisconnected: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: '#ef4444',
    color: '#ef4444',
  },
  button: {
    backgroundColor: '#534AB7', // purple accent
    borderRadius: 6,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#6366f1',
    shadowColor: '#534AB7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  settingsButton: {
    alignItems: 'center',
    marginTop: 16,
  },
  settingsButtonText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  }
});
