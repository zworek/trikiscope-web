import { TrikiDevice, ODR_PRESETS } from './triki.js';
import { initScope } from './scope.js';
import { initGames } from './games.js';

const triki = new TrikiDevice();

// ── Shared BLE DOM refs ───────────────────────────────────────────────────────
const statusDot     = document.getElementById('status-dot');
const statusLabel   = document.getElementById('status-label');
const ppsBadge      = document.getElementById('pps-badge');
const deviceInfoRow = document.getElementById('device-info-row');
const infoName      = document.getElementById('info-name');
const infoFw        = document.getElementById('info-fw');
const infoSn        = document.getElementById('info-sn');
const infoBat       = document.getElementById('info-bat');
const odrSelect     = document.getElementById('odr-select');
const btnConnect    = document.getElementById('btn-connect');

// ── Navigation ────────────────────────────────────────────────────────────────
const navScope  = document.getElementById('nav-scope');
const navGames  = document.getElementById('nav-games');
const viewScope = document.getElementById('view-scope');
const viewGames = document.getElementById('view-games');

function showView(name) {
  if (name !== 'games') games.reset();
  viewScope.classList.toggle('d-none', name !== 'scope');
  viewGames.classList.toggle('d-none', name !== 'games');
  navScope.className = `btn btn-sm ${name === 'scope'  ? 'btn-secondary' : 'btn-outline-secondary'}`;
  navGames.className = `btn btn-sm ${name === 'games'  ? 'btn-secondary' : 'btn-outline-secondary'}`;
}

navScope.addEventListener('click', () => showView('scope'));
navGames.addEventListener('click', () => showView('games'));

// ── ODR dropdown ──────────────────────────────────────────────────────────────
for (const [i, p] of ODR_PRESETS.entries()) {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = p.label;
  if (i === 2) opt.selected = true;
  odrSelect.appendChild(opt);
}

// ── Shared BLE UI ─────────────────────────────────────────────────────────────
triki.addEventListener('statuschange', (e) => {
  const s = e.detail.status;
  statusDot.className = `status-dot ${s}`;
  statusLabel.textContent = {
    idle:         'Not connected',
    connecting:   'Connecting…',
    connected:    triki.deviceInfo?.name ?? 'Triki',
    disconnected: 'Disconnected',
    error:        'Connection error',
  }[s] ?? s;

  const connected = s === 'connected';
  btnConnect.textContent = connected ? 'Disconnect' : 'Connect';
  btnConnect.className   = `btn btn-sm ${connected ? 'btn-danger' : 'btn-success'}`;
  odrSelect.disabled     = connected;

  if (connected) {
    const info = triki.deviceInfo;
    infoName.textContent = info.name ?? '—';
    infoFw.textContent   = info.firmwareRevision ?? '—';
    infoSn.textContent   = info.serialNumber ?? '—';
    infoBat.textContent  = info.batteryLevel != null ? `${info.batteryLevel}%` : '—';
    deviceInfoRow.classList.remove('d-none');
    deviceInfoRow.classList.add('d-flex');
  } else {
    deviceInfoRow.classList.remove('d-flex');
    deviceInfoRow.classList.add('d-none');
    ppsBadge.classList.add('d-none');
    ppsBadge.textContent = '';
  }
});

triki.addEventListener('sensorupdate', () => {
  if (triki.connected) {
    ppsBadge.textContent = `${triki.packetsPerSecond} pps`;
    ppsBadge.classList.remove('d-none');
  }
});

btnConnect.addEventListener('click', async () => {
  if (triki.connected) {
    await triki.disconnect();
  } else {
    try { await triki.connect(+odrSelect.value); } catch { /* user cancelled */ }
  }
});

// ── Sub-modules ───────────────────────────────────────────────────────────────
initScope(triki);
const games = initGames(triki);
