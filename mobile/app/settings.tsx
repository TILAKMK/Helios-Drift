import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert, Platform, Clipboard } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { storageService } from '../src/services/StorageService';
import { CONFIG } from '../constants/Config';

export default function SettingsScreen() {
  const router = useRouter();
  const [backendUrl, setBackendUrl] = useState('');
  const [defaultEnvId, setDefaultEnvId] = useState('');
  const [pollInterval, setPollInterval] = useState('2');
  const [deviceId, setDeviceId] = useState('');
  const [sessionCount, setSessionCount] = useState(0);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const id = await storageService.getDeviceId();
        setDeviceId(id);

        const list = await storageService.getAllSessions();
        setSessionCount(list.length);

        const savedUrl = await AsyncStorage.getItem('@phantom_settings_backend_url');
        const savedEnv = await AsyncStorage.getItem('@phantom_settings_default_env_id');
        const savedPoll = await AsyncStorage.getItem('@phantom_settings_poll_interval');

        setBackendUrl(savedUrl || CONFIG.BACKEND_WS.replace('/ws/sensor-stream', ''));
        setDefaultEnvId(savedEnv || CONFIG.ENV_ID);
        setPollInterval(savedPoll || '2');
      } catch (err) {
        console.warn('Error loading settings:', err);
      }
    };
    loadSettings();
  }, []);

  const handleSave = async () => {
    try {
      await AsyncStorage.setItem('@phantom_settings_backend_url', backendUrl);
      await AsyncStorage.setItem('@phantom_settings_default_env_id', defaultEnvId);
      await AsyncStorage.setItem('@phantom_settings_poll_interval', pollInterval);
      
      // Update global configuration reference
      CONFIG.BACKEND_WS = `${backendUrl}/ws/sensor-stream`;
      CONFIG.ENV_ID = defaultEnvId;
      CONFIG.POLL_INTERVAL_MS = Number(pollInterval) * 1000;

      Alert.alert('Configuration Saved', 'Telemetry settings updated successfully.');
      router.back();
    } catch {
      Alert.alert('Save Failed', 'Failed to persist settings.');
    }
  };

  const handleClearData = () => {
    Alert.alert(
      'Confirm Data Purge',
      'This will erase all cached session records and reset your unique Device ID. Proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Erase All', 
          style: 'destructive',
          onPress: async () => {
            await storageService.clearAllData();
            const newId = await storageService.getDeviceId();
            setDeviceId(newId);
            setSessionCount(0);
            Alert.alert('Purge Complete', 'All local databases deleted.');
          }
        }
      ]
    );
  };

  const copyDeviceId = () => {
    Clipboard.setString(deviceId);
    Alert.alert('Copied', 'Device ID copied to clipboard.');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.title}>SETTINGS</Text>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>SERVER CONNECTION</Text>
        
        <View style={styles.inputGroup}>
          <Text style={styles.label}>BACKEND WEB ADDRESS</Text>
          <TextInput
            style={styles.input}
            value={backendUrl}
            onChangeText={setBackendUrl}
            placeholder="ws://192.168.x.x:8000"
            placeholderTextColor="#4b5563"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>DEFAULT ENVIRONMENT ID</Text>
          <TextInput
            style={styles.input}
            value={defaultEnvId}
            onChangeText={setDefaultEnvId}
            placeholder="nie-classroom-104"
            placeholderTextColor="#4b5563"
            autoCapitalize="none"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>TELEMETRY TIMING</Text>
        <Text style={styles.label}>POLLING FREQUENCY</Text>
        <View style={styles.timingRow}>
          {['1', '2', '5'].map((val) => (
            <TouchableOpacity
              key={val}
              style={[
                styles.timingOption,
                pollInterval === val && styles.timingOptionSelected
              ]}
              onPress={() => setPollInterval(val)}
            >
              <Text style={[
                styles.timingText,
                pollInterval === val && styles.timingTextSelected
              ]}>
                {val}s
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>DEVICE & DIAGNOSTICS</Text>
        
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>DEVICE UNIQUE ID</Text>
          <TouchableOpacity onPress={copyDeviceId} style={styles.copyBox}>
            <Text numberOfLines={1} style={styles.infoValUUID}>{deviceId}</Text>
            <Text style={styles.copyText}>COPY</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>CACHED LABELS / SESSIONS</Text>
          <Text style={styles.infoVal}>{sessionCount} sessions logged</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>APP ENGINE VERSION</Text>
          <Text style={styles.infoVal}>{CONFIG.APP_VERSION}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveBtnText}>APPLY CHANGES</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.clearBtn} onPress={handleClearData}>
          <Text style={styles.clearBtnText}>CLEAR ALL LOCAL STORAGE</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>CANCEL</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1B2A',
  },
  contentContainer: {
    padding: 24,
    paddingTop: 64,
    paddingBottom: 48,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#8b5cf6',
    letterSpacing: 2,
    marginBottom: 32,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  section: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '900',
    color: '#64748b',
    letterSpacing: 1.5,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    paddingBottom: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  input: {
    backgroundColor: '#1b263b',
    borderWidth: 1,
    borderColor: '#415a77',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  timingRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timingOption: {
    flex: 1,
    backgroundColor: '#1b263b',
    borderWidth: 1,
    borderColor: '#415a77',
    borderRadius: 4,
    paddingVertical: 10,
    alignItems: 'center',
  },
  timingOptionSelected: {
    backgroundColor: '#534AB7',
    borderColor: '#6366f1',
  },
  timingText: {
    color: '#94a3b8',
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  timingTextSelected: {
    color: '#ffffff',
  },
  infoRow: {
    marginBottom: 16,
  },
  infoLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  infoVal: {
    color: '#f8fafc',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  infoValUUID: {
    color: '#a78bfa',
    fontSize: 11,
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  copyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1b263b',
    padding: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#415a77',
  },
  copyText: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '900',
    marginLeft: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  actions: {
    gap: 12,
    marginTop: 16,
  },
  saveBtn: {
    backgroundColor: '#534AB7',
    borderRadius: 6,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  clearBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 6,
    paddingVertical: 14,
    alignItems: 'center',
  },
  clearBtnText: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  backBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  backBtnText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  }
});
