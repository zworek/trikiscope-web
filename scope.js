import { ODR_PRESETS } from './triki.js';

export function initScope(triki) {

// ── Constants ─────────────────────────────────────────────────────────────────
const RING_CAP        = 30000;
const PACKET_LOG_MAX  = 6;
const GESTURE_HOLD_MS = 800;

const CHANNELS = [
  { key: 'accelX', label: 'Accel X', color: '#22c55e', unit: 'g',       range: 4   },
  { key: 'accelY', label: 'Accel Y', color: '#3b82f6', unit: 'g',       range: 4   },
  { key: 'accelZ', label: 'Accel Z', color: '#06b6d4', unit: 'g',       range: 4   },
  { key: 'gyroX',  label: 'Gyro X',  color: '#f59e0b', unit: 'dps',     range: 500 },
  { key: 'gyroY',  label: 'Gyro Y',  color: '#a855f7', unit: 'dps',     range: 500 },
  { key: 'gyroZ',  label: 'Gyro Z',  color: '#ef4444', unit: 'dps',     range: 500 },
  { key: 'button', label: 'Button',  color: '#ffffff', unit: 'digital',  range: 1   },
];

// ── State ─────────────────────────────────────────────────────────────────────
const rings = {};
const heads = {};
for (const ch of CHANNELS) {
  rings[ch.key] = new Float32Array(RING_CAP);
  heads[ch.key] = 0;
}

const channelEnabled = {};
for (const ch of CHANNELS) channelEnabled[ch.key] = true;

let timebaseSec     = 2;
let pausedHeads     = null;
let gestureTimeoutId = null;

let recording = false;
const csvRows = [];
let csvPitch = 0, csvRoll = 0, csvYaw = 0;

const packetLog = [];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const odrSelect      = document.getElementById('odr-select');

const box            = document.getElementById('box');
const calibOverlay   = document.getElementById('calib-overlay');
const valPitch       = document.getElementById('val-pitch');
const valRoll        = document.getElementById('val-roll');
const valYaw         = document.getElementById('val-yaw');
const btnLed         = document.getElementById('btn-led');
let   ledOn          = false;
const btnResetOrient = document.getElementById('btn-reset-orient');

const pillTap        = document.getElementById('pill-tap');
const pillFreefall   = document.getElementById('pill-freefall');
const pillShake      = document.getElementById('pill-shake');
const pillSpin       = document.getElementById('pill-spin');
const btnIndicator   = document.getElementById('btn-indicator-dot');

const sensorBars = {
  ax: { bar: document.getElementById('bar-ax'), num: document.getElementById('num-ax') },
  ay: { bar: document.getElementById('bar-ay'), num: document.getElementById('num-ay') },
  az: { bar: document.getElementById('bar-az'), num: document.getElementById('num-az') },
  gx: { bar: document.getElementById('bar-gx'), num: document.getElementById('num-gx') },
  gy: { bar: document.getElementById('bar-gy'), num: document.getElementById('num-gy') },
  gz: { bar: document.getElementById('bar-gz'), num: document.getElementById('num-gz') },
  am: { bar: document.getElementById('bar-am'), num: document.getElementById('num-am') },
  gm: { bar: document.getElementById('bar-gm'), num: document.getElementById('num-gm') },
};

const scopeCanvas   = document.getElementById('scope-canvas');
const scopeCtx      = scopeCanvas.getContext('2d');
const channelLegend = document.getElementById('channel-legend');
const timebaseSel   = document.getElementById('timebase-select');
const btnPause      = document.getElementById('btn-pause');
const btnClear      = document.getElementById('btn-clear');

const recordCount   = document.getElementById('record-count');
const btnRecord     = document.getElementById('btn-record');
const btnDownload   = document.getElementById('btn-download');

const packetLogEl   = document.getElementById('packet-log');

// ── Init: channel legend ──────────────────────────────────────────────────────
for (const ch of CHANNELS) {
  const btn = document.createElement('button');
  btn.className   = 'legend-btn active';
  btn.dataset.key = ch.key;
  btn.style.setProperty('--ch-color', ch.color);
  btn.textContent = `${ch.label} (${ch.unit})`;
  btn.addEventListener('click', () => {
    channelEnabled[ch.key] = !channelEnabled[ch.key];
    btn.classList.toggle('active', channelEnabled[ch.key]);
  });
  channelLegend.appendChild(btn);
}

// ── TrikiDevice events ────────────────────────────────────────────────────────
triki.addEventListener('statuschange', (e) => {
  const isConnected = e.detail.status === 'connected';
  btnLed.disabled         = !isConnected;
  btnResetOrient.disabled = !isConnected;
  if (!isConnected) {
    ledOn = false;
    btnLed.classList.remove('btn-warning');
    btnLed.classList.add('btn-outline-warning');
    btnLed.textContent = 'LED';
  }
});

triki.addEventListener('sensorupdate', (e) => {
  const s = e.detail;

  for (const ch of CHANNELS) {
    rings[ch.key][heads[ch.key]] = s[ch.key];
    heads[ch.key] = (heads[ch.key] + 1) % RING_CAP;
  }

  updateBar(sensorBars.ax, s.accelX,   4,   `${s.accelX.toFixed(3)} g`);
  updateBar(sensorBars.ay, s.accelY,   4,   `${s.accelY.toFixed(3)} g`);
  updateBar(sensorBars.az, s.accelZ,   4,   `${s.accelZ.toFixed(3)} g`);
  updateBar(sensorBars.gx, s.gyroX,    500, `${s.gyroX.toFixed(1)} dps`);
  updateBar(sensorBars.gy, s.gyroY,    500, `${s.gyroY.toFixed(1)} dps`);
  updateBar(sensorBars.gz, s.gyroZ,    500, `${s.gyroZ.toFixed(1)} dps`);
  updateBar(sensorBars.am, s.accelMag, 2,   `${s.accelMag.toFixed(3)} g`,   true);
  updateBar(sensorBars.gm, s.gyroMag,  500, `${s.gyroMag.toFixed(1)} dps`, true);

  btnIndicator.classList.toggle('pressed', s.button);

  if (recording) {
    csvRows.push([
      s.frameIndex, s.timestampMs.toFixed(2),
      s.gyroX.toFixed(5), s.gyroY.toFixed(5), s.gyroZ.toFixed(5),
      s.accelX.toFixed(5), s.accelY.toFixed(5), s.accelZ.toFixed(5),
      csvPitch.toFixed(3), csvRoll.toFixed(3), csvYaw.toFixed(3),
      s.button ? 1 : 0,
    ]);
    recordCount.textContent = `${csvRows.length} frames`;
  }
});

triki.addEventListener('orientationupdate', (e) => {
  csvPitch = e.detail.pitch;
  csvRoll  = e.detail.roll;
  csvYaw   = e.detail.yaw;

  calibOverlay.classList.toggle('visible', e.detail.calibrating);

  if (!e.detail.calibrating) {
    const { pitch, roll, yaw } = e.detail;
    box.style.transform = `rotateZ(${yaw.toFixed(2)}deg) rotateY(${pitch.toFixed(2)}deg) rotateX(${roll.toFixed(2)}deg)`;
    valPitch.textContent = `${pitch.toFixed(1)}°`;
    valRoll.textContent  = `${roll.toFixed(1)}°`;
    valYaw.textContent   = `${yaw.toFixed(1)}°`;
  }
});

triki.addEventListener('gesture', (e) => {
  updateGesturePills(e.detail.name);
  if (gestureTimeoutId) clearTimeout(gestureTimeoutId);
  gestureTimeoutId = setTimeout(() => updateGesturePills(null), GESTURE_HOLD_MS);
});

triki.addEventListener('packet', (e) => {
  const bytes = e.detail.bytes;
  const hex   = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
  packetLog.unshift({ hex, len: bytes.length });
  if (packetLog.length > PACKET_LOG_MAX) packetLog.pop();
  renderPacketLog();
});

// ── UI controls ───────────────────────────────────────────────────────────────
btnLed.addEventListener('click', () => {
  ledOn = !ledOn;
  triki.setLed(ledOn);
  btnLed.classList.toggle('btn-warning', ledOn);
  btnLed.classList.toggle('btn-outline-warning', !ledOn);
  btnLed.textContent = ledOn ? 'LED ON' : 'LED';
});

btnResetOrient.addEventListener('click', () => triki.resetOrientation());

timebaseSel.addEventListener('change', () => { timebaseSec = +timebaseSel.value; });

btnPause.addEventListener('click', () => {
  if (pausedHeads) {
    pausedHeads = null;
    btnPause.textContent = 'Pause';
    btnPause.classList.remove('active');
  } else {
    pausedHeads = { ...heads };
    btnPause.textContent = 'Resume';
    btnPause.classList.add('active');
  }
});

btnClear.addEventListener('click', () => {
  for (const ch of CHANNELS) {
    rings[ch.key].fill(0);
    heads[ch.key] = 0;
  }
  if (pausedHeads) {
    for (const ch of CHANNELS) pausedHeads[ch.key] = 0;
  }
});

btnRecord.addEventListener('click', () => {
  recording = !recording;
  btnRecord.classList.toggle('recording', recording);
  btnRecord.textContent = recording ? '■ Stop' : '● Record';
  btnDownload.disabled  = recording;
});

btnDownload.addEventListener('click', downloadCsv);

// ── Oscilloscope canvas ───────────────────────────────────────────────────────
const ACCEL_CHANNELS = CHANNELS.filter(c => c.unit === 'g');
const GYRO_CHANNELS  = CHANNELS.filter(c => c.unit === 'dps');
const BTN_CHANNEL    = CHANNELS.find(c => c.unit === 'digital');
const BTN_PANE_H     = 44;

function drawScope() {
  const W = scopeCanvas.width;
  const H = scopeCanvas.height;
  const ctx = scopeCtx;

  ctx.clearRect(0, 0, W, H);

  const analogH = Math.floor((H - BTN_PANE_H - 4) / 2);
  const gyroY   = analogH + 2;
  const btnY    = gyroY + analogH + 2;

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0,     W, analogH);
  ctx.fillRect(0, gyroY, W, analogH);
  ctx.fillRect(0, btnY,  W, BTN_PANE_H);

  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, analogH,          W, 2);
  ctx.fillRect(0, gyroY + analogH,  W, 2);

  ctx.font      = '10px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillText('Accelerometer', 6, 14);
  ctx.fillText('Gyroscope',     6, gyroY + 14);
  ctx.fillText('Button',        6, btnY + 14);

  const odrEst   = ODR_PRESETS[+odrSelect.value].hz;
  const nSamples = Math.min(Math.ceil(odrEst * timebaseSec), RING_CAP);
  const refHeads = pausedHeads ?? heads;

  drawPane(ctx, 0,     analogH, W, ACCEL_CHANNELS, nSamples, refHeads, 4);
  drawPane(ctx, gyroY, analogH, W, GYRO_CHANNELS,  nSamples, refHeads, 500);
  drawButtonPane(ctx, btnY, BTN_PANE_H, W, nSamples, refHeads);
}

function drawPane(ctx, yOffset, paneH, W, channels, nSamples, refHeads, rangeVal) {
  const midY = yOffset + paneH / 2;

  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  for (const frac of [0.25, 0.5, 0.75]) {
    const yTop = yOffset + paneH * frac;
    const yBot = yOffset + paneH * (1 - frac);
    ctx.beginPath(); ctx.moveTo(0, yTop); ctx.lineTo(W, yTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, yBot); ctx.lineTo(W, yBot); ctx.stroke();
  }

  ctx.font      = '9px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.textAlign = 'right';
  ctx.fillText(`+${rangeVal}`, W - 4, yOffset + 10);
  ctx.fillText(`-${rangeVal}`, W - 4, yOffset + paneH - 2);
  ctx.textAlign = 'left';

  if (nSamples < 2) return;

  for (const ch of channels) {
    if (!channelEnabled[ch.key]) continue;
    const ring = rings[ch.key];
    const head = refHeads[ch.key];

    ctx.beginPath();
    ctx.strokeStyle = ch.color;
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = 0.85;

    for (let i = 0; i < nSamples; i++) {
      const idx = ((head - nSamples + i) % RING_CAP + RING_CAP) % RING_CAP;
      const x = (i / (nSamples - 1)) * W;
      const y = midY - (ring[idx] / rangeVal) * (paneH / 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawButtonPane(ctx, yOffset, paneH, W, nSamples, refHeads) {
  if (!channelEnabled[BTN_CHANNEL.key] || nSamples < 2) return;

  const ring = rings[BTN_CHANNEL.key];
  const head = refHeads[BTN_CHANNEL.key];
  const yLo  = yOffset + paneH - 6;
  const yHi  = yOffset + 6;

  ctx.beginPath();
  ctx.strokeStyle = BTN_CHANNEL.color;
  ctx.lineWidth   = 1.5;
  ctx.globalAlpha = 0.85;

  let prevVal = null;
  for (let i = 0; i < nSamples; i++) {
    const idx = ((head - nSamples + i) % RING_CAP + RING_CAP) % RING_CAP;
    const val = ring[idx] >= 0.5 ? 1 : 0;
    const x   = (i / (nSamples - 1)) * W;
    const y   = val === 1 ? yHi : yLo;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      if (val !== prevVal) ctx.lineTo(x, prevVal === 1 ? yHi : yLo);
      ctx.lineTo(x, y);
    }
    prevVal = val;
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function updateBar(refs, value, range, label, unipolar = false) {
  if (!refs) return;
  const frac = Math.min(Math.abs(value) / range, 1);
  const pct  = frac * 50;
  refs.bar.style.width = `${pct}%`;
  refs.bar.style.left  = (unipolar || value >= 0) ? '50%' : `${50 - pct}%`;
  refs.num.textContent = label;
}

function updateGesturePills(name) {
  pillTap.classList.toggle('active-tap',           name === 'TAP / IMPACT');
  pillFreefall.classList.toggle('active-freefall', name === 'FREE-FALL');
  pillShake.classList.toggle('active-shake',       name === 'SHAKE');
  pillSpin.classList.toggle('active-spin',         name === 'SPIN');
}

function renderPacketLog() {
  packetLogEl.innerHTML = packetLog.map(p => {
    const hexTrunc = p.hex.length > 60 ? p.hex.slice(0, 60) + '…' : p.hex;
    return `<div class="packet-row"><span class="packet-hex">${hexTrunc}</span><span class="packet-meta">${p.len}B</span></div>`;
  }).join('');
}

function downloadCsv() {
  if (csvRows.length === 0) return;
  const header = 'frame_index,timestamp_ms,gyro_x_dps,gyro_y_dps,gyro_z_dps,accel_x_g,accel_y_g,accel_z_g,pitch,roll,yaw,button';
  const body   = csvRows.map(r => r.join(',')).join('\n');
  const blob   = new Blob([header + '\n' + body], { type: 'text/csv' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = url;
  a.download   = `triki_${Date.now()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── Canvas resize + render loop ───────────────────────────────────────────────
function resizeCanvas() {
  const w = scopeCanvas.parentElement.clientWidth - 32;
  scopeCanvas.width  = Math.max(w, 200);
  scopeCanvas.height = 300;
}

new ResizeObserver(resizeCanvas).observe(scopeCanvas.parentElement);
resizeCanvas();

(function renderLoop() { drawScope(); requestAnimationFrame(renderLoop); })();

} // end initScope
