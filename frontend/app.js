/**
 * PHANTOM PROTOCOL - Core Simulation & Multi-Modal Weak-Signal Fusion Engine
 * Implements online baseline tracking (EMA), sensor drift isolation, 
 * spatial correlation expansion, and HTML5 canvas visualizations.
 */

// --- GLOBAL APPLICATION STATE ---
const CONFIG = {
  tickRateMs: 100,
  maxHistorySize: 100,
  spatialCoefficientScale: 0.35, // How much adjacent anomalies amplify local risk
  
  // Real Backend configurations
  BACKEND_WS: "ws://localhost:8000/ws/dashboard",
  SENSOR_WS:  "ws://localhost:8000/ws/sensor-stream",
  API_BASE:   "http://localhost:8000/api",
  ENV_ID:     "classroom-nie-204",
  DEVICE_ID:  "35182c6e-cd27-445d-b1a6-534190a9570d", // static or random UUID matching standard mock uuid
  SESSION_ID: "4efef345-0931-49dc-9811-fe7bc7c40b29",
  USE_REAL_BACKEND: false,
};

// Fusion parameters (bind to sliders)
const params = {
  wNoise: 0.35,
  wWifi: 0.35,
  wDrift: 0.30,
  alpha: 0.020, // baseline adaptation speed
  theta: 1.80,  // composite hazard trigger threshold
};

// Node Definitions and Initial Sensor Configurations
const nodes = {
  a: {
    id: 'a',
    name: 'Subway Platform (Node A)',
    status: 'NOMINAL',
    sensors: {
      noise: { name: 'Ambient Noise Floor', unit: 'dB', base: 45, variance: 3, raw: 45, history: [], emaMean: 45, emaVar: 9, zScore: 0, driftOffset: 0 },
      wifi: { name: 'WiFi Multi-Path Var', unit: '% var', base: 1.2, variance: 0.2, raw: 1.2, history: [], emaMean: 1.2, emaVar: 0.04, zScore: 0, driftOffset: 0 },
      drift: { name: 'Micro-Acceleration Drift', unit: 'mG', base: 240, variance: 15, raw: 240, history: [], emaMean: 240, emaVar: 225, zScore: 0, driftOffset: 0 }
    },
    compositeHazard: 0,
    rawWeighted: 0,
    spatialFactor: 1.0,
    driftCompActive: false,
    driftStreak: 0 // track how long a sensor has drifted monotonically
  },
  b: {
    id: 'b',
    name: 'Market Square (Node B)',
    status: 'NOMINAL',
    sensors: {
      noise: { name: 'Ambient Noise Floor', unit: 'dB', base: 52, variance: 4, raw: 52, history: [], emaMean: 52, emaVar: 16, zScore: 0, driftOffset: 0 },
      wifi: { name: 'WiFi Multi-Path Var', unit: '% var', base: 1.8, variance: 0.3, raw: 1.8, history: [], emaMean: 1.8, emaVar: 0.09, zScore: 0, driftOffset: 0 },
      drift: { name: 'Micro-Acceleration Drift', unit: 'mG', base: 180, variance: 10, raw: 180, history: [], emaMean: 180, emaVar: 100, zScore: 0, driftOffset: 0 }
    },
    compositeHazard: 0,
    rawWeighted: 0,
    spatialFactor: 1.0,
    driftCompActive: false,
    driftStreak: 0
  },
  c: {
    id: 'c',
    name: 'Narrow Alley (Node C)',
    status: 'NOMINAL',
    sensors: {
      noise: { name: 'Ambient Noise Floor', unit: 'dB', base: 38, variance: 2, raw: 38, history: [], emaMean: 38, emaVar: 4, zScore: 0, driftOffset: 0 },
      wifi: { name: 'WiFi Multi-Path Var', unit: '% var', base: 0.6, variance: 0.1, raw: 0.6, history: [], emaMean: 0.6, emaVar: 0.01, zScore: 0, driftOffset: 0 },
      drift: { name: 'Micro-Acceleration Drift', unit: 'mG', base: 120, variance: 8, raw: 120, history: [], emaMean: 120, emaVar: 64, zScore: 0, driftOffset: 0 }
    },
    compositeHazard: 0,
    rawWeighted: 0,
    spatialFactor: 1.0,
    driftCompActive: false,
    driftStreak: 0
  },
  d: {
    id: 'd',
    name: 'Warehouse (Node D)',
    status: 'NOMINAL',
    sensors: {
      noise: { name: 'Ambient Noise Floor', unit: 'dB', base: 48, variance: 3, raw: 48, history: [], emaMean: 48, emaVar: 9, zScore: 0, driftOffset: 0 },
      wifi: { name: 'WiFi Multi-Path Var', unit: '% var', base: 0.8, variance: 0.15, raw: 0.8, history: [], emaMean: 0.8, emaVar: 0.0225, zScore: 0, driftOffset: 0 },
      drift: { name: 'Micro-Acceleration Drift', unit: 'mG', base: 310, variance: 20, raw: 310, history: [], emaMean: 310, emaVar: 400, zScore: 0, driftOffset: 0 }
    },
    compositeHazard: 0,
    rawWeighted: 0,
    spatialFactor: 1.0,
    driftCompActive: false,
    driftStreak: 0
  }
};

// Node connections for spatial correlation calculations
const connections = [
  { from: 'a', to: 'b', elementId: 'link-ab' },
  { from: 'b', to: 'c', elementId: 'link-bc' },
  { from: 'c', to: 'd', elementId: 'link-cd' },
  { from: 'd', to: 'a', elementId: 'link-da' }
];

let selectedNodeId = 'a';
let currentScenario = 'normal';
let tickCounter = 0;
let scenarioStartTick = 0;

// Mic Ingest Globals
let micStream = null;
let audioContext = null;
let analyserNode = null;
let micDbValue = 0.0;

// --- CANVAS CHART MANAGERS ---
const canvasCharts = {
  noise: { canvas: null, ctx: null },
  wifi: { canvas: null, ctx: null },
  drift: { canvas: null, ctx: null },
  riskHistory: { canvas: null, ctx: null }
};

// --- NEW RISK ENGINE HISTORIES & ALERTS ---
const riskAlertEvents = [];  // logs of crossings


// --- HELPER FUNCTIONS ---

// Generate Gaussian/normal random noise (Box-Muller transform)
function randomNormal(mean = 0, std = 1) {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * std;
}

// Log message to the terminal-like UI
function appendSystemLog(message, type = 'dim') {
  const logContainer = document.getElementById('system-logs');
  if (!logContainer) return;

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  
  const line = document.createElement('div');
  line.className = `log-line`;
  
  if (type === 'cyan') line.classList.add('text-cyan');
  else if (type === 'green') line.classList.add('text-green');
  else if (type === 'amber') line.classList.add('text-amber');
  else if (type === 'red') line.classList.add('text-red');
  else if (type === 'purple') line.classList.add('text-purple');
  else line.classList.add('text-dim');

  line.innerHTML = `<span class="text-dim">[${timeStr}]</span> ${message}`;
  logContainer.appendChild(line);
  
  // Keep logs under 100 entries to prevent memory growth
  while (logContainer.children.length > 100) {
    logContainer.removeChild(logContainer.firstChild);
  }
  
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Format the z-score text cleanly
function formatZScore(z) {
  const sign = z >= 0 ? '+' : '';
  return `${sign}${z.toFixed(2)}σ`;
}

// Initialize Charts
function initCharts() {
  const chartTypes = ['noise', 'wifi', 'drift', 'riskHistory'];
  chartTypes.forEach(type => {
    const elementId = type === 'riskHistory' ? 'chart-risk-history' : `chart-${type}`;
    const canvas = document.getElementById(elementId);
    if (canvas) {
      canvasCharts[type].canvas = canvas;
      canvasCharts[type].ctx = canvas.getContext('2d');
      // Resize canvas to match display size
      resizeCanvas(canvas);
    }
  });
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
}

// Redraw charts on window resize
window.addEventListener('resize', () => {
  Object.values(canvasCharts).forEach(chart => {
    if (chart.canvas) {
      resizeCanvas(chart.canvas);
    }
  });
});

// --- CORE SIMULATION TICK ---
function runSimulationTick() {
  tickCounter++;
  
  if (CONFIG.USE_REAL_BACKEND) {
    Object.values(nodes).forEach(node => {
      const timeCycle = Math.sin(tickCounter * 0.02) * 2;
      
      let rawNoise = randomNormal(node.sensors.noise.base + timeCycle, node.sensors.noise.variance);
      let rawWifi = Math.max(0.1, randomNormal(node.sensors.wifi.base, node.sensors.wifi.variance));
      let rawDrift = randomNormal(node.sensors.drift.base + timeCycle * 2, node.sensors.drift.variance);

      if (node.id === 'a' && micStream && analyserNode) {
        const micGain = Math.max(0, micDbValue + 100);
        rawNoise = 38 + (micGain * 0.5);
      }

      if (currentScenario === 'drift') {
        if (node.id === 'd') {
          node.sensors.drift.driftOffset += 0.45;
          rawDrift += node.sensors.drift.driftOffset;
        }
      } else if (currentScenario === 'panic') {
        if (node.id === 'a' || node.id === 'b') {
          const elapsed = tickCounter - scenarioStartTick;
          const ramp = Math.min(1.0, elapsed / 150);
          rawNoise += randomNormal(12 * ramp, 2.5);
          rawWifi += randomNormal(1.6 * ramp, 0.4);
        }
      } else if (currentScenario === 'disaster') {
        if (node.id === 'a') {
          const elapsed = tickCounter - scenarioStartTick;
          const noiseAnomaly = 3.0 + elapsed * 0.1;
          const wifiAnomaly = 0.2 + elapsed * 0.01;
          const driftAnomaly = 1.0 + elapsed * 0.3;
          
          rawNoise += noiseAnomaly;
          rawWifi += wifiAnomaly;
          node.sensors.drift.driftOffset = driftAnomaly;
          rawDrift += node.sensors.drift.driftOffset;
        }
      }

      node.sensors.noise.raw = rawNoise;
      node.sensors.wifi.raw = rawWifi;
      node.sensors.drift.raw = rawDrift;

      if (node.id === selectedNodeId && tickCounter % 20 === 0) {
        if (sensorWs && sensorWs.readyState === WebSocket.OPEN) {
          sensorWs.send(JSON.stringify({
            device_id: CONFIG.DEVICE_ID,
            env_id: CONFIG.ENV_ID,
            session_id: CONFIG.SESSION_ID,
            timestamp: new Date().toISOString(),
            readings: {
              mic_db: rawNoise,
              accel_x: 0.0,
              accel_y: 0.0,
              accel_z: rawDrift,
              pressure_hpa: 1013.2,
              wifi_rssi: rawWifi,
              wifi_ap_count: 5,
              ble_count: 2
            }
          }));
        }
      }
    });
    return;
  }

  // 1. Simulate Raw Signals per Node
  Object.values(nodes).forEach(node => {
    // Noise floor: base + slow diurnal sine wave fluctuation + Gaussian noise
    const timeCycle = Math.sin(tickCounter * 0.02) * 2;
    
    let rawNoise = randomNormal(node.sensors.noise.base + timeCycle, node.sensors.noise.variance);
    let rawWifi = Math.max(0.1, randomNormal(node.sensors.wifi.base, node.sensors.wifi.variance));
    let rawDrift = randomNormal(node.sensors.drift.base + timeCycle * 2, node.sensors.drift.variance);

    // Apply Live Mic Input if active (Only maps to Node A)
    if (node.id === 'a' && micStream && analyserNode) {
      // Scale micDbValue to dB range of our noise sensor (e.g. 35dB ambient up to 85dB spikes)
      const micGain = Math.max(0, micDbValue + 100); // converting -100dB..0dB to 0..100
      rawNoise = 38 + (micGain * 0.5); // base noise of 38dB + mic fluctuation
    }

    // Apply Scenario Manipulations
    if (currentScenario === 'drift') {
      // Simulate persistent sensor calibration drift on Node D (Gas Sensor)
      if (node.id === 'd') {
        // Increment driftOffset slowly and monotonically
        node.sensors.drift.driftOffset += 0.45;
        rawDrift += node.sensors.drift.driftOffset;
      }
    } else if (currentScenario === 'panic') {
      // Crowd Panic on Subway (A) and Market (B)
      if (node.id === 'a' || node.id === 'b') {
        const elapsed = tickCounter - scenarioStartTick;
        const ramp = Math.min(1.0, elapsed / 150); // 15 seconds ramp
        rawNoise += randomNormal(12 * ramp, 2.5);
        rawWifi += randomNormal(1.6 * ramp, 0.4);
      }
    } else if (currentScenario === 'disaster') {
      // Multi-Modal Weak-Signal Disaster Event:
      // Subtle variations across multiple channels simultaneously.
      // Slowly and persistently built up over time to allow baseline z-scores and risk to climb.
      if (node.id === 'a') {
        const elapsed = tickCounter - scenarioStartTick;
        const noiseAnomaly = 3.0 + elapsed * 0.1; // starts at 3.0, increases by 1.0 per second
        const wifiAnomaly = 0.2 + elapsed * 0.01; // starts at 0.2, increases by 0.1 per second
        const driftAnomaly = 1.0 + elapsed * 0.3; // starts at 1.0, increases by 3.0 per second
        
        rawNoise += noiseAnomaly;
        rawWifi += wifiAnomaly;
        node.sensors.drift.driftOffset = driftAnomaly;
        rawDrift += node.sensors.drift.driftOffset;
      }
    }

    // Set final raw values
    node.sensors.noise.raw = rawNoise;
    node.sensors.wifi.raw = rawWifi;
    node.sensors.drift.raw = rawDrift;

    // 2. Update Baselines & Z-Scores
    Object.values(node.sensors).forEach(sensor => {
      const x = sensor.raw;
      
      // Update running Mean (EMA)
      const prevMean = sensor.emaMean;
      sensor.emaMean = (1 - params.alpha) * prevMean + params.alpha * x;
      
      // Update running Variance (EMA)
      const dev = x - prevMean;
      sensor.emaVar = (1 - params.alpha) * sensor.emaVar + params.alpha * (dev * dev);
      
      // Get Standard Deviation (minimum std dev floor of 0.05 to avoid division by zero)
      sensor.emaStd = Math.sqrt(Math.max(0.0025, sensor.emaVar));

      // Calculate Online Z-Score
      // Note: Use previous mean/std for current test to avoid self-influence on anomaly
      sensor.zScore = Math.abs(x - prevMean) / (sensor.emaStd || 1.0);

      // Save History
      sensor.history.push({
        val: x,
        mean: sensor.emaMean,
        std: sensor.emaStd
      });
      if (sensor.history.length > CONFIG.maxHistorySize) {
        sensor.history.shift();
      }
    });

    // 3. Sensor Drift Compensation Algorithm (Novel Component)
    // Check if ONLY the gas sensor (drift) is behaving abnormally while other channels are quiet
    const driftZ = node.sensors.drift.zScore;
    const noiseZ = node.sensors.noise.zScore;
    const wifiZ = node.sensors.wifi.zScore;

    // Check for monotonic rising streak in the drift channel
    const hist = node.sensors.drift.history;
    if (hist.length > 5) {
      const last5 = hist.slice(-5);
      let monotonic = true;
      for (let i = 1; i < last5.length; i++) {
        if (last5[i].val < last5[i-1].val - 0.2) {
          monotonic = false;
          break;
        }
      }
      
      if (monotonic && driftZ > 1.2) {
        node.driftStreak++;
      } else {
        node.driftStreak = Math.max(0, node.driftStreak - 1);
      }
    }

    // If drift streak is high AND other signals are nominal, flag as calibration drift
    if (node.driftStreak > 25 && noiseZ < 1.0 && wifiZ < 1.0) {
      if (!node.driftCompActive) {
        node.driftCompActive = true;
        appendSystemLog(`[${node.name}] Channel anomaly detected in Isolation. Activating baseline drift calibration.`, 'purple');
      }
    } else {
      // Deactivate if streak cools down or other sensors start deviating (indicating dynamic event)
      if (node.driftCompActive && (node.driftStreak === 0 || noiseZ > 1.5 || wifiZ > 1.5)) {
        node.driftCompActive = false;
        appendSystemLog(`[${node.name}] Isolation lock released. Resuming multi-modal verification.`, 'cyan');
      }
    }
  });

  // 4. Compute Spatial Correlations & Composite Hazard Scores
  // First pass: Compute raw weighted hazard score per node
  Object.values(nodes).forEach(node => {
    let sumZ2 = 0;
    
    // Check weights
    const zNoise = node.sensors.noise.zScore;
    const zWifi = node.sensors.wifi.zScore;
    const zDrift = node.sensors.drift.zScore;

    if (node.driftCompActive) {
      // SENSOR DRIFT ISOLATED:
      // Suppress the drifting sensor contribution to prevent false alarm.
      // Redistribute weights to active channels.
      const wSum = params.wNoise + params.wWifi;
      const normWNoise = params.wNoise / wSum;
      const normWWifi = params.wWifi / wSum;
      
      sumZ2 = (normWNoise * zNoise * zNoise) + (normWWifi * zWifi * zWifi);
      node.status = 'DRIFT';
    } else {
      // NORMAL FUSION:
      sumZ2 = (params.wNoise * zNoise * zNoise) + 
              (params.wWifi * zWifi * zWifi) + 
              (params.wDrift * zDrift * zDrift);
    }
    
    node.rawWeighted = Math.sqrt(sumZ2);
  });

  // Second pass: Calculate spatial correlation boost based on adjacent nodes
  Object.values(nodes).forEach(node => {
    let adjacentRiskSum = 0;
    let spatialLinksCount = 0;

    // Find adjacent nodes in the topology
    connections.forEach(conn => {
      if (conn.from === node.id) {
        const neighbor = nodes[conn.to];
        if (neighbor.rawWeighted > 1.0) {
          adjacentRiskSum += (neighbor.rawWeighted - 1.0);
          spatialLinksCount++;
          document.getElementById(conn.elementId).classList.add('correlated');
        } else {
          document.getElementById(conn.elementId).classList.remove('correlated');
        }
      }
      if (conn.to === node.id) {
        const neighbor = nodes[conn.from];
        if (neighbor.rawWeighted > 1.0) {
          adjacentRiskSum += (neighbor.rawWeighted - 1.0);
          document.getElementById(conn.elementId).classList.add('correlated');
        }
      }
    });

    node.spatialFactor = 1.0 + (adjacentRiskSum * CONFIG.spatialCoefficientScale);
    node.compositeHazard = node.rawWeighted * node.spatialFactor;

    // Set Final Status Color based on composite threshold
    if (node.status !== 'DRIFT') {
      if (node.compositeHazard >= params.theta) {
        node.status = 'HAZARD';
      } else if (node.compositeHazard >= 1.0) {
        node.status = 'WARNING';
      } else {
        node.status = 'NOMINAL';
      }
    }
  });

  // 5. Update Web UI Renderings
  updateUI();
  drawCharts();

  // 6. Run 2-second sampler
  if (tickCounter % 20 === 0) {
    sampleRiskScore();
  }
}

// --- UI UPDATE & LOGIC ---

function updateUI() {
  // Update Header Clock
  const now = new Date();
  document.getElementById('header-clock').innerText = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  // Update SVG Nodes in Map
  Object.values(nodes).forEach(node => {
    const nodeEl = document.getElementById(`map-node-${node.id}`);
    const statusEl = document.getElementById(`node-${node.id}-status`);
    const glowRing = nodeEl.querySelector('.node-glow-ring');
    const core = nodeEl.querySelector('.node-core');

    // Remove all classes
    glowRing.className.baseVal = 'node-glow-ring';
    core.className.baseVal = 'node-core';
    statusEl.className.baseVal = 'node-mini-status';
    nodeEl.classList.remove('active');

    // Apply active node outline in map
    if (node.id === selectedNodeId) {
      nodeEl.classList.add('active');
    }

    if (node.status === 'HAZARD') {
      glowRing.classList.add('red');
      core.classList.add('red');
      statusEl.classList.add('text-red');
      statusEl.innerText = 'HAZARD';
    } else if (node.status === 'WARNING') {
      glowRing.classList.add('amber');
      core.classList.add('amber');
      statusEl.classList.add('text-amber');
      statusEl.innerText = 'WARNING';
    } else if (node.status === 'DRIFT') {
      glowRing.classList.add('purple');
      core.classList.add('purple');
      statusEl.classList.add('text-purple');
      statusEl.innerText = 'DRIFT COMP';
    } else {
      glowRing.classList.add('cyan');
      core.classList.add('cyan');
      statusEl.classList.add('text-cyan');
      statusEl.innerText = 'NOMINAL';
    }
  });

  // Update Node Telemetry detail fields for Selected Node
  const selectedNode = nodes[selectedNodeId];
  document.getElementById('selected-node-title').innerText = selectedNode.name.toUpperCase();

  // Noise Live Readings
  document.getElementById('raw-noise-val').innerText = `${selectedNode.sensors.noise.raw.toFixed(1)} dB`;
  document.getElementById('z-noise-val').innerText = formatZScore(selectedNode.sensors.noise.zScore);

  // Wifi Live Readings
  document.getElementById('raw-wifi-val').innerText = `${selectedNode.sensors.wifi.raw.toFixed(2)} %`;
  document.getElementById('z-wifi-val').innerText = formatZScore(selectedNode.sensors.wifi.zScore);

  // Drift Sensor Live Readings
  document.getElementById('raw-drift-val').innerText = `${selectedNode.sensors.drift.raw.toFixed(0)} ppm`;
  document.getElementById('z-drift-val').innerText = formatZScore(selectedNode.sensors.drift.zScore);

  // Color-code the Z-Scores in the telemetry card
  colorizeZScoreEl('z-noise-val', selectedNode.sensors.noise.zScore);
  colorizeZScoreEl('z-wifi-val', selectedNode.sensors.wifi.zScore);
  colorizeZScoreEl('z-drift-val', selectedNode.sensors.drift.zScore);

  // Update Composite Engine Panel
  const compositeScore = selectedNode.compositeHazard;
  document.getElementById('composite-score-text').innerText = compositeScore.toFixed(2);
  document.getElementById('raw-weighted-score').innerText = selectedNode.rawWeighted.toFixed(2);
  document.getElementById('spatial-factor').innerText = `${selectedNode.spatialFactor.toFixed(2)}x`;
  document.getElementById('final-hazard-score').innerText = compositeScore.toFixed(2);

  // Circular progress dial rotation
  const progressCircle = document.getElementById('gauge-progress');
  // stroke-dasharray = 471 (representing circumfrence 2 * PI * r = 2 * 3.1415 * 75 = 471)
  const maxDialScore = 3.0;
  const progressRatio = Math.min(compositeScore / maxDialScore, 1.0);
  const offset = 471 - (471 * progressRatio);
  progressCircle.style.strokeDashoffset = offset;

  // Gauge state colors and alarm banner
  const stateTextEl = document.getElementById('composite-state-text');
  const bannerEl = document.getElementById('alarm-banner');
  const bannerTitle = document.getElementById('alarm-banner-title');
  const bannerDesc = document.getElementById('alarm-banner-desc');
  const systemStatusDot = document.getElementById('system-status-dot');
  const systemStatusText = document.getElementById('system-status-text');

  // Reset banner states
  bannerEl.className = 'status-alert-banner';
  stateTextEl.className = 'gauge-state-lbl';
  systemStatusDot.className = 'status-dot';
  systemStatusText.className = 'status-value';

  if (selectedNode.status === 'HAZARD') {
    stateTextEl.innerText = 'HAZARD ALERT';
    stateTextEl.classList.add('red-text');
    bannerEl.classList.add('status-red');
    bannerTitle.innerText = '⚠️ PRE-DISASTER TRIGGER';
    bannerDesc.innerText = `Composite anomaly index crossed warning threshold (H=${compositeScore.toFixed(2)}). Multiple weak signals corroborated. Dispatch safety protocols.`;
    
    systemStatusDot.classList.add('red');
    systemStatusText.innerText = 'HAZARD STATE TRIGGERED';
    systemStatusText.classList.add('red-text');
    
    // Intermittent warning beep log
    if (tickCounter % 30 === 0) {
      appendSystemLog(`[CRITICAL ALERT] Composite hazard threshold breached at ${selectedNode.name}. H = ${compositeScore.toFixed(2)}!`, 'red');
    }
  } else if (selectedNode.status === 'WARNING') {
    stateTextEl.innerText = 'WARNING';
    stateTextEl.classList.add('amber-text');
    bannerEl.classList.add('status-amber');
    bannerTitle.innerText = '⚡ ELEVATED DEVIATION';
    bannerDesc.innerText = `Elevated statistical variance detected. Normalcy baseline drifting. Monitoring spatial linkages for alignment.`;
    
    systemStatusDot.classList.add('amber');
    systemStatusText.innerText = 'ELEVATED ACTIVITY';
    systemStatusText.classList.add('amber-text');

    if (tickCounter % 50 === 0) {
      appendSystemLog(`[WARNING] Elevated deviation registered at ${selectedNode.name}. H = ${compositeScore.toFixed(2)}.`, 'amber');
    }
  } else if (selectedNode.status === 'DRIFT') {
    stateTextEl.innerText = 'DRIFT ISOLATION';
    stateTextEl.classList.add('purple-text');
    bannerEl.classList.add('status-purple');
    bannerTitle.innerText = '🔧 AUTO-CALIBRATING';
    bannerDesc.innerText = `Sensor calibration drift detected. Core engine has isolated the Gas Sensor channel to prevent a false positive.`;
    
    systemStatusDot.classList.add('purple');
    systemStatusText.innerText = 'SENSOR CALIBRATING';
    systemStatusText.classList.add('purple-text');

    if (tickCounter % 50 === 0) {
      appendSystemLog(`[DRIFT] Isolating channel anomalies at ${selectedNode.name} to avoid false alert.`, 'purple');
    }
  } else {
    stateTextEl.innerText = 'SAFE';
    stateTextEl.classList.add('green-text');
    bannerEl.classList.add('status-green');
    bannerTitle.innerText = 'MONITORING WEAK CHANNELS';
    bannerDesc.innerText = `All indicators are within statistical baseline variance. No anomaly registered.`;
    
    systemStatusDot.classList.add('green');
    systemStatusText.innerText = 'NOMINAL / MONITORING';
    systemStatusText.classList.add('green-text');
  }

  // Update map details (avg drift, spatial co-eff)
  let totalDriftStreak = 0;
  Object.values(nodes).forEach(n => { totalDriftStreak += n.driftStreak; });
  const avgDriftVal = (totalDriftStreak / 4 / 20).toFixed(2);
  document.getElementById('avg-drift-comp').innerText = `${avgDriftVal}σ`;
  document.getElementById('spatial-coeff').innerText = `${selectedNode.spatialFactor.toFixed(2)}x`;

  // Update LSTM Predictor UI (Simulation mode mock)
  if (!CONFIG.USE_REAL_BACKEND) {
    const riskVal = Math.min(1.0, selectedNode.compositeHazard / 3.0);
    let mockProb = riskVal;
    if (mockProb > 0.05) {
      mockProb = Math.min(0.99, mockProb * 1.1 + Math.sin(tickCounter / 5) * 0.02);
    }
    const probText = (mockProb * 100).toFixed(1) + '%';
    document.getElementById('lstm-prob-text').innerText = probText;
    document.getElementById('lstm-prob-bar').style.width = probText;

    let mockLevel = 'NONE';
    const badge = document.getElementById('lstm-alert-level');
    if (mockProb >= 0.75) {
      mockLevel = 'CRITICAL';
      badge.style.background = '#7f1d1d';
      badge.style.color = '#f87171';
    } else if (mockProb >= 0.5) {
      mockLevel = 'WARNING';
      badge.style.background = '#78350f';
      badge.style.color = '#fbbf24';
    } else if (mockProb >= 0.3) {
      mockLevel = 'WATCH';
      badge.style.background = '#1e3a8a';
      badge.style.color = '#60a5fa';
    } else {
      mockLevel = 'NONE';
      badge.style.background = '#374151';
      badge.style.color = '#9ca3af';
    }
    badge.innerText = mockLevel;

    const leadTimeEl = document.getElementById('lstm-lead-time');
    if (mockProb >= 0.5) {
      const mockMin = Math.max(1.0, 30.0 * (1.0 - mockProb) + Math.sin(tickCounter / 10) * 2);
      leadTimeEl.innerText = `~${mockMin.toFixed(1)} min`;
      leadTimeEl.style.color = mockLevel === 'CRITICAL' ? '#f87171' : '#fbbf24';
    } else {
      leadTimeEl.innerText = '-- min';
      leadTimeEl.style.color = '#38bdf8';
    }
  }
}

function colorizeZScoreEl(id, val) {
  const el = document.getElementById(id);
  el.className = 'monospace bold';
  if (val >= 2.0) el.classList.add('text-red');
  else if (val >= 1.0) el.classList.add('text-amber');
  else el.classList.add('text-cyan');
}

// Draw history on Canvas (Custom render Sparklines with standard deviation bands)
function drawCharts() {
  const selectedNode = nodes[selectedNodeId];
  
  const chartTypes = ['noise', 'wifi', 'drift'];
  chartTypes.forEach(type => {
    const chart = canvasCharts[type];
    if (!chart.ctx) return;
    
    const ctx = chart.ctx;
    const canvas = chart.canvas;
    const sensor = selectedNode.sensors[type];
    const history = sensor.history;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (history.length < 2) return;

    // Canvas sizes
    const width = canvas.width;
    const height = canvas.height;
    const padding = 15;
    
    // Find min and max for scaling
    let minVal = Infinity;
    let maxVal = -Infinity;
    
    // Read bounds from history to construct plot windows
    history.forEach(pt => {
      const topBand = pt.mean + 3 * pt.std;
      const btmBand = pt.mean - 3 * pt.std;
      minVal = Math.min(minVal, pt.val, btmBand);
      maxVal = Math.max(maxVal, pt.val, topBand);
    });
    
    // Padding range to avoid strict edges
    const range = maxVal - minVal || 1;
    minVal -= range * 0.05;
    maxVal += range * 0.05;
    const graphHeight = height - 2 * padding;
    
    // X scale increment
    const xInc = (width - 2 * padding) / (CONFIG.maxHistorySize - 1);
    const startX = width - padding - (history.length - 1) * xInc;

    // Coordinate mapping functions
    function getX(index) {
      return startX + index * xInc;
    }
    
    function getY(value) {
      return height - padding - ((value - minVal) / (maxVal - minVal)) * graphHeight;
    }

    // 1. Draw SD Bands (+-2 sigma shadow area representing normality zone)
    ctx.fillStyle = 'rgba(0, 240, 255, 0.03)';
    ctx.beginPath();
    // Top path (left to right)
    ctx.moveTo(getX(0), getY(history[0].mean + 2 * history[0].std));
    for (let i = 1; i < history.length; i++) {
      ctx.lineTo(getX(i), getY(history[i].mean + 2 * history[i].std));
    }
    // Bottom path (right to left)
    for (let i = history.length - 1; i >= 0; i--) {
      ctx.lineTo(getX(i), getY(history[i].mean - 2 * history[i].std));
    }
    ctx.closePath();
    ctx.fill();

    // 2. Draw Baseline Mean line (EMA Mean)
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.45)'; // grey-slate line
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]); // dashed line for baseline
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(history[0].mean));
    for (let i = 1; i < history.length; i++) {
      ctx.lineTo(getX(i), getY(history[i].mean));
    }
    ctx.stroke();
    ctx.setLineDash([]); // Reset line dash

    // 3. Draw Raw Signal line
    let signalColor = 'var(--neon-cyan)';
    if (selectedNode.status === 'HAZARD') signalColor = 'var(--neon-red)';
    else if (selectedNode.status === 'WARNING') signalColor = 'var(--neon-amber)';
    else if (selectedNode.status === 'DRIFT' && type === 'drift') signalColor = 'var(--neon-purple)';

    ctx.strokeStyle = signalColor;
    ctx.lineWidth = 2.0;
    ctx.shadowBlur = 4;
    ctx.shadowColor = signalColor;
    
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(history[0].val));
    for (let i = 1; i < history.length; i++) {
      ctx.lineTo(getX(i), getY(history[i].val));
    }
    ctx.stroke();
    
    // Clear shadow properties
    ctx.shadowBlur = 0;
  });

  // Draw Risk History Chart
  drawRiskHistoryChart();
}

// Reset baseline to current readings
function resetBaselines() {
  // Clear risk alert events array
  riskAlertEvents.length = 0;

  Object.values(nodes).forEach(node => {
    // Reset calibration values
    node.driftStreak = 0;
    node.driftCompActive = false;
    node.sensors.drift.driftOffset = 0;
    
    // Reset new risk histories
    node.riskHistory = [];
    node.prevRisk = 0.0;
    
    Object.values(node.sensors).forEach(sensor => {
      const startVal = (sensor.raw !== undefined && !isNaN(sensor.raw)) ? sensor.raw : sensor.base;
      sensor.emaMean = startVal;
      sensor.emaVar = sensor.variance * sensor.variance;
      sensor.emaStd = sensor.variance;
      sensor.zScore = 0;
      sensor.history = [];
    });
  });

  // Clear Risk Event Log DOM panel as well
  const logContainer = document.getElementById('risk-event-logs');
  if (logContainer) {
    logContainer.innerHTML = '<div class="log-line text-dim">No critical threshold crossings recorded.</div>';
  }

  appendSystemLog('Adaptive baselines reset. System re-calibrating...', 'cyan');
}

// --- SCENARIO EVENT TRIGGERS ---

function triggerScenario(scenarioName) {
  currentScenario = scenarioName;
  scenarioStartTick = tickCounter;
  
  // Update active buttons in UI
  document.querySelectorAll('.btn-preset').forEach(btn => {
    if (btn.getAttribute('data-scenario') === scenarioName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const descEl = document.getElementById('scenario-description');
  
  // Reset drift offsets when changing scenario
  Object.values(nodes).forEach(node => {
    node.sensors.drift.driftOffset = 0;
  });

  switch (scenarioName) {
    case 'normal':
      descEl.innerText = 'System is running in normal state. Micro-behaviors, noise levels, and sensor drift are within normal diurnal fluctuations.';
      appendSystemLog('Loading Preset: Normal Ambient environment', 'green');
      break;
    case 'drift':
      descEl.innerText = 'Simulates a slow calibration loss on the Warehouse Gas sensor (Node D). Observe how the system identifies it as localized drift and isolates it to avoid a false alarm.';
      appendSystemLog('Loading Preset: Single Sensor Calibration Drift (Node D)', 'purple');
      break;
    case 'panic':
      descEl.innerText = 'Simulates high crowd density and rushing in Subway (A) and Market Square (B). Noise floor spikes and WiFi signal variance rises due to crowd blocking Wi-Fi paths.';
      appendSystemLog('Loading Preset: Crowd Behavior Anomaly (Node A & B)', 'amber');
      break;
    case 'disaster':
      descEl.innerText = 'Triggers multiple subtle anomalies simultaneously on Subway Platform (Node A). No single channel exceeds typical 3σ alerts, but the composite weak-signal index fires, predicting danger early.';
      appendSystemLog('Loading Preset: Composite Hazard (Correlated Weak Signals at Node A)', 'red');
      break;
  }
}

// --- MICROPHONE INGEST ENGINE ---

async function toggleMicrophone(enabled) {
  const meterWrapper = document.getElementById('mic-meter-wrapper');
  
  if (enabled) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      const source = audioContext.createMediaStreamSource(micStream);
      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 256;
      source.connect(analyserNode);
      
      meterWrapper.classList.remove('hidden');
      appendSystemLog('Microphone access granted. Ambient noise ingested into Subway Platform Node.', 'cyan');
      
      // Periodically sample volume
      calculateMicVolume();
    } catch (err) {
      console.error('Microphone access denied or error:', err);
      appendSystemLog('Microphone access failed. Ensure permissions are allowed.', 'red');
      document.getElementById('mic-toggle').checked = false;
      meterWrapper.classList.add('hidden');
    }
  } else {
    // Disable mic
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
      micStream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    analyserNode = null;
    micDbValue = 0.0;
    meterWrapper.classList.add('hidden');
    appendSystemLog('Microphone ingestion disabled.', 'dim');
  }
}

function calculateMicVolume() {
  if (!analyserNode) return;
  
  const bufferLength = analyserNode.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyserNode.getByteTimeDomainData(dataArray);
  
  // Calculate RMS (Root Mean Square) volume
  let sum = 0;
  for (let i = 0; i < bufferLength; i++) {
    const val = (dataArray[i] - 128) / 128; // normalize
    sum += val * val;
  }
  const rms = Math.sqrt(sum / bufferLength);
  
  // Convert to relative Decibels
  // Standard conversion is 20 * log10(rms). RMS of silent room is ~0.005 -> ~-46dB
  let db = 20 * Math.log10(rms || 0.0001);
  
  // Cap values
  db = Math.max(-100, Math.min(0, db));
  micDbValue = db;

  // Scale level fill width (map -70dB..-10dB to 0%..100%)
  const percentage = Math.max(0, Math.min(100, ((db + 70) / 60) * 100));
  document.getElementById('mic-db-fill').style.width = `${percentage}%`;
  // Relative simulated sound level display
  const simulatedDb = 35 + (percentage * 0.5);
  document.getElementById('mic-db-val').innerText = `${simulatedDb.toFixed(1)} dB`;
  
  if (micStream) {
    requestAnimationFrame(calculateMicVolume);
  }
}

// --- UI CONTROLS BINDINGS ---

function bindEventHandlers() {
  // Scenario Selection buttons
  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const scenario = btn.getAttribute('data-scenario');
      triggerScenario(scenario);
    });
  });

  // Node selector tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      selectedNodeId = btn.getAttribute('data-node');
      
      // Trigger instant redraw
      updateUI();
      drawCharts();
    });
  });

  // SVG Nodes interactive click
  Object.keys(nodes).forEach(nodeId => {
    const mapNodeEl = document.getElementById(`map-node-${nodeId}`);
    if (mapNodeEl) {
      mapNodeEl.addEventListener('click', () => {
        // Find corresponding tab button and trigger click
        const tabBtn = document.querySelector(`.tab-btn[data-node="${nodeId}"]`);
        if (tabBtn) tabBtn.click();
      });
    }
  });

  // Toggle Live Microphone Ingest
  document.getElementById('mic-toggle').addEventListener('change', (e) => {
    toggleMicrophone(e.target.checked);
  });

  // Weights Tuning Range Sliders
  const setupSlider = (id, paramKey, labelId) => {
    const slider = document.getElementById(id);
    const label = document.getElementById(labelId);
    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      params[paramKey] = val;
      label.innerText = val.toFixed(paramKey === 'alpha' ? 3 : 2);
    });
  };

  setupSlider('slider-w-noise', 'wNoise', 'val-w-noise');
  setupSlider('slider-w-wifi', 'wWifi', 'val-w-wifi');
  setupSlider('slider-w-drift', 'wDrift', 'val-w-drift');
  setupSlider('slider-alpha', 'alpha', 'val-alpha');
  setupSlider('slider-theta', 'theta', 'val-theta');

  // Reset Button
  document.getElementById('btn-reset-baseline').addEventListener('click', resetBaselines);

  // Export Button
  document.getElementById('btn-export-session').addEventListener('click', exportSessionJSON);

  // Mode Toggle Button
  const toggleBtn = document.getElementById('btn-mode-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      CONFIG.USE_REAL_BACKEND = !CONFIG.USE_REAL_BACKEND;
      if (CONFIG.USE_REAL_BACKEND) {
        connectLiveBackend();
      } else {
        disconnectLiveBackend();
      }
    });
  }
}

// --- LIVE BACKEND WEBSOCKET HANDLERS ---
let dashboardWs = null;
let sensorWs = null;
let reconnectTimer = null;

function connectLiveBackend() {
  if (!CONFIG.USE_REAL_BACKEND) return;
  
  if (dashboardWs) dashboardWs.close();
  if (sensorWs) sensorWs.close();
  
  const liveBadge = document.getElementById('live-badge');
  const toggleBtn = document.getElementById('btn-mode-toggle');
  
  toggleBtn.innerText = "LIVE MODE";
  toggleBtn.style.borderColor = "var(--neon-green)";
  toggleBtn.style.color = "var(--neon-green)";
  toggleBtn.style.textShadow = "0 0 4px var(--neon-green-dim)";
  
  liveBadge.style.display = "inline-block";
  liveBadge.innerText = "CONNECTING...";
  liveBadge.style.borderColor = "var(--neon-amber)";
  liveBadge.style.color = "var(--neon-amber)";
  
  dashboardWs = new WebSocket(`${CONFIG.BACKEND_WS}/${CONFIG.ENV_ID}`);
  
  dashboardWs.onopen = () => {
    liveBadge.innerText = "LIVE";
    liveBadge.style.borderColor = "var(--neon-green)";
    liveBadge.style.color = "var(--neon-green)";
    appendSystemLog("Connected to live backend dashboard feed.", "green");
  };
  
  let prevAlertState = false;
  
  dashboardWs.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "backfill") {
        const selectedNode = nodes[selectedNodeId];
        selectedNode.riskHistory = data.scores;
        drawRiskHistoryChart();
      } else if (data.type === "drift_update") {
        const selectedNode = nodes[selectedNodeId];
        
        const compScore = data.composite_score;
        selectedNode.compositeHazard = compScore * 3.0;
        selectedNode.rawWeighted = compScore * 3.0;
        
        selectedNode.sensors.noise.zScore = data.drift_per_signal.mic || 0.0;
        selectedNode.sensors.wifi.zScore = data.drift_per_signal.wifi || 0.0;
        selectedNode.sensors.drift.zScore = data.drift_per_signal.accel || 0.0;
        
        const isAlert = data.alert_triggered;
        if (isAlert) {
          selectedNode.status = 'HAZARD';
          if (!prevAlertState) {
            triggerRiskAlertFromLive(selectedNode, compScore, data.channels_above, data.lead_time_estimate_min);
          }
        } else if (compScore > 0.33) {
          selectedNode.status = 'WARNING';
        } else {
          selectedNode.status = 'NOMINAL';
        }
        prevAlertState = isAlert;
        
        if (!selectedNode.riskHistory) selectedNode.riskHistory = [];
        selectedNode.riskHistory.push(compScore);
        if (selectedNode.riskHistory.length > 150) selectedNode.riskHistory.shift();
        
        const noiseSensor = selectedNode.sensors.noise;
        noiseSensor.raw = noiseSensor.emaMean + (data.drift_per_signal.mic * noiseSensor.emaStd);
        noiseSensor.history.push({ val: noiseSensor.raw, mean: noiseSensor.emaMean, std: noiseSensor.emaStd });
        if (noiseSensor.history.length > CONFIG.maxHistorySize) noiseSensor.history.shift();
        
        const wifiSensor = selectedNode.sensors.wifi;
        wifiSensor.raw = wifiSensor.emaMean + (data.drift_per_signal.wifi * wifiSensor.emaStd);
        wifiSensor.history.push({ val: wifiSensor.raw, mean: wifiSensor.emaMean, std: wifiSensor.emaStd });
        if (wifiSensor.history.length > CONFIG.maxHistorySize) wifiSensor.history.shift();
        
        const driftSensor = selectedNode.sensors.drift;
        driftSensor.raw = driftSensor.emaMean + (data.drift_per_signal.accel * driftSensor.emaStd);
        driftSensor.history.push({ val: driftSensor.raw, mean: driftSensor.emaMean, std: driftSensor.emaStd });
        if (driftSensor.history.length > CONFIG.maxHistorySize) driftSensor.history.shift();
        
        updateUI();
        drawCharts();
        
        // Parse backend LSTM predictions
        if (data.lstm) {
          const prob = data.lstm.p_event;
          const probText = (prob * 100).toFixed(1) + '%';
          document.getElementById('lstm-prob-text').innerText = probText;
          document.getElementById('lstm-prob-bar').style.width = probText;

          const alertLvl = data.lstm.alert_level.toUpperCase();
          const badge = document.getElementById('lstm-alert-level');
          badge.innerText = alertLvl;

          if (alertLvl === 'NONE') {
            badge.style.background = '#374151';
            badge.style.color = '#9ca3af';
          } else if (alertLvl === 'WATCH') {
            badge.style.background = '#1e3a8a';
            badge.style.color = '#60a5fa';
          } else if (alertLvl === 'WARNING') {
            badge.style.background = '#78350f';
            badge.style.color = '#fbbf24';
          } else if (alertLvl === 'CRITICAL') {
            badge.style.background = '#7f1d1d';
            badge.style.color = '#f87171';
          }

          const minToEvent = data.lstm.minutes_to_event;
          const leadTimeEl = document.getElementById('lstm-lead-time');
          if (prob >= 0.5) {
            leadTimeEl.innerText = `~${minToEvent.toFixed(1)} min`;
            leadTimeEl.style.color = alertLvl === 'CRITICAL' ? '#f87171' : '#fbbf24';
          } else {
            leadTimeEl.innerText = '-- min';
            leadTimeEl.style.color = '#38bdf8';
          }
        }
        
        const forecastEl = document.getElementById('trend-forecast');
        if (forecastEl) {
          if (data.lead_time_estimate_min !== null) {
            forecastEl.innerText = `Estimated time to critical: ~${Math.round(data.lead_time_estimate_min)} min`;
            forecastEl.className = "meta-val text-red";
          } else {
            forecastEl.innerText = "Stable";
            forecastEl.className = "meta-val text-green";
          }
        }
      }
    } catch (err) {
      console.error("Error processing live dashboard message:", err);
    }
  };
  
  dashboardWs.onclose = () => {
    handleLiveDisconnect();
  };
  
  dashboardWs.onerror = () => {
    handleLiveDisconnect();
  };
  
  sensorWs = new WebSocket(`${CONFIG.SENSOR_WS}/${CONFIG.ENV_ID}?device_id=${CONFIG.DEVICE_ID}`);
  
  sensorWs.onopen = () => {
    appendSystemLog("Connected to live backend sensor ingestion stream.", "green");
  };
}

function handleLiveDisconnect() {
  if (!CONFIG.USE_REAL_BACKEND) return;
  
  const liveBadge = document.getElementById('live-badge');
  if (liveBadge.innerText === "RECONNECTING...") return;
  
  liveBadge.innerText = "RECONNECTING...";
  liveBadge.style.borderColor = "var(--neon-amber)";
  liveBadge.style.color = "var(--neon-amber)";
  
  appendSystemLog("Live connection lost. Reconnecting in 3s...", "amber");
  
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectLiveBackend();
  }, 3000);
}

function disconnectLiveBackend() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  
  if (dashboardWs) {
    dashboardWs.close();
    dashboardWs = null;
  }
  if (sensorWs) {
    sensorWs.close();
    sensorWs = null;
  }
  
  const liveBadge = document.getElementById('live-badge');
  liveBadge.style.display = "none";
  
  const toggleBtn = document.getElementById('btn-mode-toggle');
  toggleBtn.innerText = "SIMULATION MODE";
  toggleBtn.style.borderColor = "var(--neon-cyan)";
  toggleBtn.style.color = "var(--neon-cyan)";
  toggleBtn.style.textShadow = "0 0 4px var(--neon-cyan-dim)";
  
  appendSystemLog("Switched back to local Simulation Mode.", "cyan");
  resetBaselines();
}

function triggerRiskAlertFromLive(node, risk, channels, leadTimeMin) {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const leadTimeStr = leadTimeMin !== null ? `~${Math.round(leadTimeMin)} min` : 'Stable';
  
  const logContainer = document.getElementById('risk-event-logs');
  if (logContainer) {
    if (riskAlertEvents.length === 0) {
      logContainer.innerHTML = '';
    }
    
    riskAlertEvents.push({
      timestamp: timeStr,
      node_id: node.id,
      node_name: node.name,
      score: risk.toFixed(2),
      channels: channels,
      lead_time_est: leadTimeStr
    });
    
    const line = document.createElement('div');
    line.className = 'log-line text-red';
    line.innerHTML = `<span class="text-dim">[${timeStr}]</span> ⚠ ALERT — score: ${risk.toFixed(2)} | channels: ${channels.join(', ')} | lead_time_est: ${leadTimeStr}`;
    logContainer.appendChild(line);
    logContainer.scrollTop = logContainer.scrollHeight;
  }
}

// --- NEW RISK ENGINE FUNCTIONS ---

function sampleRiskScore() {
  Object.values(nodes).forEach(node => {
    if (node.riskHistory === undefined) {
      node.riskHistory = [];
      node.prevRisk = 0.0;
    }
    
    // Map composite score from [0, 3] to [0, 1] risk score capped at 1.0
    const hazard = (node.compositeHazard !== undefined && !isNaN(node.compositeHazard)) ? node.compositeHazard : 0.0;
    const risk = Math.min(1.0, hazard / 3.0);
    node.riskHistory.push(risk);
    
    if (node.riskHistory.length > 150) {
      node.riskHistory.shift();
    }
    
    // Check crossing 0.5 upward
    const prev = (node.prevRisk !== undefined && !isNaN(node.prevRisk)) ? node.prevRisk : 0.0;
    if (prev <= 0.5 && risk > 0.5) {
      triggerRiskAlert(node, risk);
    }
    node.prevRisk = risk;
  });
  
  // Update header forecast
  updateForecast();
}

function triggerRiskAlert(node, risk) {
  const trend = calculateTrend(node.riskHistory);
  const leadTimeStr = trend.slope > 0 ? `~${trend.leadTime} min` : 'N/A';
  
  // Identify active channels (zScore > 1.2 is considered deviating)
  const activeChannels = [];
  if (node.sensors.noise.zScore > 1.2) activeChannels.push('mic');
  if (node.sensors.wifi.zScore > 1.2) activeChannels.push('wifi');
  if (node.sensors.drift.zScore > 1.2) activeChannels.push('accel');
  
  // Fallback to highest contributor if none
  if (activeChannels.length === 0) {
    let maxZ = -1;
    let maxChan = 'mic';
    if (node.sensors.noise.zScore > maxZ) { maxZ = node.sensors.noise.zScore; maxChan = 'mic'; }
    if (node.sensors.wifi.zScore > maxZ) { maxZ = node.sensors.wifi.zScore; maxChan = 'wifi'; }
    if (node.sensors.drift.zScore > maxZ) { maxZ = node.sensors.drift.zScore; maxChan = 'accel'; }
    activeChannels.push(maxChan);
  }
  
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  
  const event = {
    timestamp: timeStr,
    node_id: node.id,
    node_name: node.name,
    score: risk.toFixed(2),
    channels: activeChannels,
    lead_time_est: leadTimeStr === 'N/A' ? 'Stable' : `~${trend.leadTime} min`
  };
  
  riskAlertEvents.push(event);
  
  // Log to UI
  const logContainer = document.getElementById('risk-event-logs');
  if (logContainer) {
    // Clear placeholder
    if (riskAlertEvents.length === 1) {
      logContainer.innerHTML = '';
    }
    
    const line = document.createElement('div');
    line.className = 'log-line text-red';
    line.innerHTML = `<span class="text-dim">[${timeStr}]</span> ⚠ ALERT — score: ${risk.toFixed(2)} | channels: ${activeChannels.join(', ')} | lead_time_est: ${leadTimeStr === 'N/A' ? 'Stable' : `~${trend.leadTime} min`}`;
    logContainer.appendChild(line);
    logContainer.scrollTop = logContainer.scrollHeight;
  }
  
  appendSystemLog(`[RISK ALERT] ${node.name} crossed 0.5! Score: ${risk.toFixed(2)} | Lead time: ${leadTimeStr === 'N/A' ? 'Stable' : `~${trend.leadTime} min`}`, 'red');
}

function calculateTrend(history) {
  // Filter out any NaN values from history to be extremely safe
  const cleanHistory = history.filter(v => typeof v === 'number' && !isNaN(v));
  const N = Math.min(30, cleanHistory.length);
  if (N < 5) {
    return { slope: 0, leadTime: 'Stable' };
  }
  
  const y = cleanHistory.slice(-N);
  
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  
  for (let i = 0; i < N; i++) {
    const xVal = i;
    const yVal = y[i];
    sumX += xVal;
    sumY += yVal;
    sumXY += xVal * yVal;
    sumX2 += xVal * xVal;
  }
  
  const slope = (N * sumXY - sumX * sumY) / (N * sumX2 - sumX * sumX);
  const currentVal = y[N - 1];
  
  if (slope > 0 && currentVal > 0.3) {
    // steps = (0.8 - currentVal) / slope
    // time_seconds = steps * 2 (since sample is every 2 seconds)
    // time_minutes = time_seconds / 60 = steps * 2 / 60 = steps / 30
    const steps = (0.8 - currentVal) / slope;
    const leadTimeMinutes = Math.max(1, Math.round(steps / 30));
    return { slope, leadTime: leadTimeMinutes };
  }
  
  return { slope, leadTime: 'Stable' };
}

function updateForecast() {
  const selectedNode = nodes[selectedNodeId];
  const forecastEl = document.getElementById('trend-forecast');
  if (!forecastEl) return;
  
  if (!selectedNode.riskHistory || selectedNode.riskHistory.length < 5) {
    forecastEl.innerText = "Stable";
    forecastEl.className = "meta-val text-green";
    return;
  }
  
  const trend = calculateTrend(selectedNode.riskHistory);
  
  if (trend.slope > 0 && selectedNode.riskHistory[selectedNode.riskHistory.length - 1] > 0.3) {
    forecastEl.innerText = `Estimated time to critical: ~${trend.leadTime} min`;
    forecastEl.className = "meta-val text-red";
  } else {
    forecastEl.innerText = "Stable";
    forecastEl.className = "meta-val text-green";
  }
}

function drawRiskHistoryChart() {
  const chart = canvasCharts.riskHistory;
  if (!chart || !chart.ctx) return;
  
  const ctx = chart.ctx;
  const canvas = chart.canvas;
  const selectedNode = nodes[selectedNodeId];
  const history = selectedNode.riskHistory || [];
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  const width = canvas.width;
  const height = canvas.height;
  
  const paddingLeft = 45;
  const paddingRight = 15;
  const paddingTop = 15;
  const paddingBottom = 25;
  
  const graphWidth = width - paddingLeft - paddingRight;
  const graphHeight = height - paddingTop - paddingBottom;
  
  // 1. Draw Grid Lines & Y-axis Ticks
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#64748b';
  ctx.font = `${Math.round(10 * window.devicePixelRatio)}px JetBrains Mono`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  
  for (let yVal = 0.0; yVal <= 1.0; yVal += 0.2) {
    const yPixel = height - paddingBottom - (yVal * graphHeight);
    
    // Draw horizontal grid line
    ctx.beginPath();
    ctx.moveTo(paddingLeft, yPixel);
    ctx.lineTo(width - paddingRight, yPixel);
    ctx.stroke();
    
    // Draw label
    ctx.fillText(yVal.toFixed(1), paddingLeft - 8, yPixel);
  }
  
  // X-Axis labels
  ctx.textAlign = 'left';
  ctx.fillText('5 min ago', paddingLeft, height - 10);
  ctx.textAlign = 'right';
  ctx.fillText('now', width - paddingRight, height - 10);
  
  // 2. Draw Threshold Lines (score=0.5 dashed red, score=0.8 dashed red)
  ctx.strokeStyle = 'rgba(255, 0, 85, 0.5)'; // neon red dim
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  
  // Alert Threshold (0.5)
  const yAlert = height - paddingBottom - (0.5 * graphHeight);
  ctx.beginPath();
  ctx.moveTo(paddingLeft, yAlert);
  ctx.lineTo(width - paddingRight, yAlert);
  ctx.stroke();
  
  // Critical Threshold (0.8)
  const yCrit = height - paddingBottom - (0.8 * graphHeight);
  ctx.beginPath();
  ctx.moveTo(paddingLeft, yCrit);
  ctx.lineTo(width - paddingRight, yCrit);
  ctx.stroke();
  
  ctx.setLineDash([]); // reset line dash
  
  // Text labels for thresholds
  ctx.fillStyle = 'rgba(255, 0, 85, 0.7)';
  ctx.font = `${Math.round(9 * window.devicePixelRatio)}px Outfit`;
  ctx.textAlign = 'left';
  ctx.fillText('ALERT THRESHOLD (0.5)', paddingLeft + 5, yAlert - 6);
  ctx.fillText('CRITICAL THRESHOLD (0.8)', paddingLeft + 5, yCrit - 6);
  
  // 3. Plot Risk Line
  if (history.length < 2) return;
  
  const maxPoints = 150;
  const xInc = graphWidth / (maxPoints - 1);
  const startX = width - paddingRight - (history.length - 1) * xInc;
  
  function getX(idx) {
    return startX + idx * xInc;
  }
  function getY(val) {
    return height - paddingBottom - (val * graphHeight);
  }
  
  // Draw line segments with dynamic colors:
  // Green below 0.5, Amber between 0.5 and 0.8, Red above 0.8
  ctx.lineWidth = 2.5;
  for (let i = 1; i < history.length; i++) {
    const v1 = history[i-1];
    const v2 = history[i];
    
    let color = 'var(--neon-green)';
    if (v2 > 0.8) {
      color = 'var(--neon-red)';
    } else if (v2 > 0.5) {
      color = 'var(--neon-amber)';
    }
    
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(getX(i-1), getY(v1));
    ctx.lineTo(getX(i), getY(v2));
    ctx.stroke();
  }
}

function exportSessionJSON() {
  if (CONFIG.USE_REAL_BACKEND) {
    appendSystemLog("Requesting telemetry session export from backend...", "cyan");
    fetch(`${CONFIG.API_BASE}/alerts/export/${CONFIG.ENV_ID}`)
      .then(res => {
        if (!res.ok) throw new Error("Backend export request failed");
        return res.json();
      })
      .then(data => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `phantom_live_session_${Date.now()}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        appendSystemLog("Live session telemetry dataset exported from backend successfully.", "green");
      })
      .catch(err => {
        console.error(err);
        appendSystemLog("Failed to export live session from backend. Falling back to local data.", "red");
        exportLocalSessionJSON();
      });
  } else {
    exportLocalSessionJSON();
  }
}

function exportLocalSessionJSON() {
  const selectedNode = nodes[selectedNodeId];
  
  const exportData = {
    session_timestamp: new Date().toISOString(),
    parameters: {
      w_noise: params.wNoise,
      w_wifi: params.wWifi,
      w_drift: params.wDrift,
      baseline_adaptation_alpha: params.alpha,
      alarm_threshold_theta: params.theta
    },
    active_node: {
      id: selectedNode.id,
      name: selectedNode.name
    },
    risk_score_history: selectedNode.riskHistory || [],
    sensor_history: {
      noise: selectedNode.sensors.noise.history.map(h => h.val),
      wifi: selectedNode.sensors.wifi.history.map(h => h.val),
      drift: selectedNode.sensors.drift.history.map(h => h.val)
    },
    all_alert_events: riskAlertEvents
  };
  
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `phantom_session_${Date.now()}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  
  appendSystemLog('Session telemetry dataset exported successfully.', 'cyan');
}

// --- INIT APP ---
function initApp() {
  initCharts();
  bindEventHandlers();
  resetBaselines();

  // Run periodic updates
  setInterval(runSimulationTick, CONFIG.tickRateMs);
  
  appendSystemLog('Control room online. Multi-modal signal analysis executing.', 'cyan');
}

// Boot up once DOM load finishes
document.addEventListener('DOMContentLoaded', initApp);
