export function initGames(triki) {

// ── DOM refs ──────────────────────────────────────────────────────────────────
const gamePicker      = document.getElementById('game-picker');
const gunslingerPanel = document.getElementById('gunslinger-panel');
const catchEggPanel   = document.getElementById('catch-egg-panel');
const connectOverlay  = document.getElementById('connect-overlay');
const gameArea        = document.getElementById('game-area');

// ── Initial locked state (statuschange only fires on transitions) ─────────────
connectOverlay.classList.toggle('d-none', triki.connected);
gameArea.classList.toggle('game-area-locked', !triki.connected);

// ── Navigation (within games view) ───────────────────────────────────────────
let activeGame = null;

function showPicker() {
  activeGame = null;
  gamePicker.classList.remove('d-none');
  gunslingerPanel.classList.add('d-none');
  catchEggPanel.classList.add('d-none');
  gunslinger.reset();
  catchEgg.reset();
}

function showGame(name) {
  activeGame = name;
  gamePicker.classList.add('d-none');
  gunslingerPanel.classList.toggle('d-none', name !== 'gunslinger');
  catchEggPanel.classList.toggle('d-none', name !== 'catchegg');
  if (name !== 'gunslinger') gunslinger.reset();
  if (name !== 'catchegg')   catchEgg.reset();
}

document.getElementById('pick-gunslinger').addEventListener('click', () => showGame('gunslinger'));
document.getElementById('pick-catchegg').addEventListener('click', () => showGame('catchegg'));
document.getElementById('gs-back').addEventListener('click', showPicker);
document.getElementById('ce-back').addEventListener('click', showPicker);

// ── Gunslinger ────────────────────────────────────────────────────────────────
class Gunslinger {
  constructor(el) {
    this._el      = el;
    this._state   = 'idle';
    this._timer   = null;
    this._tSignal = 0;
    this._lastMs  = 0;
    this._render();
  }

  reset() {
    clearTimeout(this._timer);
    if (this._state !== 'idle') {
      triki.setLed(false);
      this._state = 'idle';
      this._render();
    }
  }

  start() {
    clearTimeout(this._timer);
    this._state = 'waiting';
    this._render();
    this._timer = setTimeout(() => this._signal(), 1000 + Math.random() * 4000);
  }

  _signal() {
    this._state   = 'ready';
    this._tSignal = performance.now();
    triki.setLed(true);
    this._render();
  }

  onButtonClick() {
    if (this._state === 'idle' || this._state === 'result' || this._state === 'false_start') {
      this.start();
    } else if (this._state === 'waiting') {
      clearTimeout(this._timer);
      this._state = 'false_start';
      this._render();
    } else if (this._state === 'ready') {
      const ms = Math.round(performance.now() - this._tSignal);
      triki.setLed(false);
      this._lastMs = ms;
      this._saveScore(ms);
      this._state = 'result';
      this._render();
    }
  }

  _rating(ms) {
    if (ms < 150) return { label: 'Lightning!', stars: 5, emoji: '⚡' };
    if (ms < 250) return { label: 'Fast!',      stars: 4, emoji: '🔥' };
    if (ms < 350) return { label: 'Good',        stars: 3, emoji: '👍' };
    if (ms < 500) return { label: 'Slow…',      stars: 2, emoji: '🐢' };
    return               { label: 'Too slow',   stars: 1, emoji: '😴' };
  }

  _saveScore(ms) {
    const scores = JSON.parse(localStorage.getItem('triki_gunslinger_scores') ?? '[]');
    scores.push(ms);
    scores.sort((a, b) => a - b);
    localStorage.setItem('triki_gunslinger_scores', JSON.stringify(scores.slice(0, 5)));
  }

  _scoresHtml() {
    const scores = JSON.parse(localStorage.getItem('triki_gunslinger_scores') ?? '[]');
    if (!scores.length) return '';
    const rows = scores.map((ms, i) => {
      const { emoji } = this._rating(ms);
      return `<tr><td class="text-secondary pe-3">#${i + 1}</td><td class="font-monospace pe-3">${ms} ms</td><td>${emoji}</td></tr>`;
    }).join('');
    return `<div class="text-secondary small mb-1">Top scores</div>
<table class="table table-sm table-borderless mb-0 small"><tbody>${rows}</tbody></table>`;
  }

  _render() {
    switch (this._state) {
      case 'idle':
        this._el.innerHTML = `
          <p class="text-secondary small">Press Play. Wait for the LED signal — then click the button as fast as you can. Watch out for a false start!</p>
          <button id="gs-play" class="btn btn-warning w-100">🔫 Play</button>
          <div class="mt-3">${this._scoresHtml()}</div>`;
        document.getElementById('gs-play').addEventListener('click', () => this.start());
        break;

      case 'waiting':
        this._el.innerHTML = `
          <div class="text-center py-5">
            <div class="display-1">🤠</div>
            <p class="text-secondary mt-3">Wait for the signal…</p>
          </div>`;
        break;

      case 'ready':
        this._el.innerHTML = `
          <div class="text-center py-5">
            <div class="display-1">🔫</div>
            <h2 class="text-warning fw-bold mt-3">DRAW!</h2>
          </div>`;
        break;

      case 'result': {
        const r = this._rating(this._lastMs);
        const stars = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
        this._el.innerHTML = `
          <div class="text-center py-3">
            <div class="display-2 fw-bold font-monospace text-success">${this._lastMs} ms</div>
            <div class="fs-3 mt-1">${r.emoji} ${r.label}</div>
            <div class="fs-5 text-warning">${stars}</div>
            <p class="text-secondary small mt-2">Press Play again or click the button to retry.</p>
            <button id="gs-again" class="btn btn-outline-warning mt-1 w-100">Play again</button>
          </div>
          <hr class="my-2">
          ${this._scoresHtml()}`;
        document.getElementById('gs-again').addEventListener('click', () => this.start());
        break;
      }

      case 'false_start':
        this._el.innerHTML = `
          <div class="text-center py-5">
            <div class="display-1">🤚</div>
            <h3 class="text-danger mt-3">Too early!</h3>
            <p class="text-secondary small mt-2">Press Try again or click the button.</p>
            <button id="gs-retry" class="btn btn-outline-danger mt-1 w-100">Try again</button>
          </div>`;
        document.getElementById('gs-retry').addEventListener('click', () => this.start());
        break;
    }
  }
}

// ── Catch-an-Egg ──────────────────────────────────────────────────────────────
function calcScore(freefallMs, impact) {
  const m = impact < 2.5 ? 1.0 : impact < 4.6 ? 0.7 : 0.0;
  return Math.round(freefallMs * m);
}

function impactLabel(impact) {
  if (impact < 2.5) return { text: 'Perfect',        emoji: '🟢', cls: 'text-success' };
  if (impact < 4.6) return { text: 'OK',             emoji: '🟡', cls: 'text-warning' };
  return                   { text: 'Egg splattered!', emoji: '💥', cls: 'text-danger'  };
}

function ledBlink(times, durationMs) {
  const half = durationMs / (times * 2);
  for (let i = 0; i < times * 2; i++) {
    setTimeout(() => triki.setLed(i % 2 === 0), i * half);
  }
}

class CatchAnEgg {
  constructor(el) {
    this._el             = el;
    this._state          = 'idle';
    this._freefallRun    = 0;
    this._tFallStart     = 0;
    this._tLandStart     = 0;
    this._freefallMs     = 0;
    this._peakG          = 0;
    this._landingSamples = [];
    this._liveEl         = null;
    this._render();
  }

  reset() {
    if (this._state !== 'idle') {
      if (this._state === 'in_freefall') triki.setLed(false);
      this._state       = 'idle';
      this._freefallRun = 0;
      this._render();
    }
  }

  onButtonClick() {
    if (this._state === 'idle' || this._state === 'result') {
      this._state       = 'armed';
      this._freefallRun = 0;
      this._render();
    }
  }

  onSensor(s) {
    const now = s.timestampMs;

    if (this._state === 'armed') {
      if (this._liveEl) this._liveEl.textContent = `${s.accelMag.toFixed(2)} g`;
      if (s.accelMag < 0.35) {
        this._freefallRun++;
        if (this._freefallRun >= 3) {
          this._state      = 'in_freefall';
          this._tFallStart = now;
          this._freefallMs = 0;
          triki.setLed(true);
          this._render();
        }
      } else {
        this._freefallRun = 0;
      }

    } else if (this._state === 'in_freefall') {
      this._freefallMs = now - this._tFallStart;
      if (this._liveEl) this._liveEl.textContent = `${this._freefallMs} ms`;
      if (s.accelMag >= 0.35) {
        triki.setLed(false);
        if (this._freefallMs < 100) {
          // micro throw — bail out immediately, no landing window
          this._state       = 'armed';
          this._freefallRun = 0;
          this._render();
        } else {
          this._state          = 'landing';
          this._tLandStart     = now;
          this._landingSamples = [s.accelMag];
        }
      }

    } else if (this._state === 'landing') {
      this._landingSamples.push(s.accelMag);
      if (now - this._tLandStart > 300) this._finish();
    }
  }

  _finish() {
    // Max of a 10-sample rolling average (~48 ms at 208 Hz).
    // A brief spike (1-2 samples at high g) barely moves the smoothed window,
    // but a sustained hard impact stays high. A gentle 200 ms deceleration
    // at ~2-3 g produces a LOW rolling max vs. a slap that hits 10+ g.
    const W = 10;
    const s = this._landingSamples;
    let maxRolling = 0;
    if (s.length >= W) {
      for (let i = W - 1; i < s.length; i++) {
        let sum = 0;
        for (let j = 0; j < W; j++) sum += s[i - j];
        maxRolling = Math.max(maxRolling, sum / W);
      }
    } else {
      maxRolling = s.reduce((a, b) => a + b, 0) / (s.length || 1);
    }
    this._peakG = maxRolling;

    const sc = calcScore(this._freefallMs, this._peakG);
    this._saveScore(sc);
    this._state = 'result';
    this._render();

    if (sc === 0) {
      ledBlink(3, 500);
    }
  }

  _saveScore(sc) {
    const scores = JSON.parse(localStorage.getItem('triki_catchegg_scores') ?? '[]');
    scores.push(sc);
    scores.sort((a, b) => b - a);
    localStorage.setItem('triki_catchegg_scores', JSON.stringify(scores.slice(0, 5)));
  }

  _scoresHtml() {
    const scores = JSON.parse(localStorage.getItem('triki_catchegg_scores') ?? '[]');
    if (!scores.length) return '';
    const rows = scores.map((sc, i) =>
      `<tr><td class="text-secondary pe-3">#${i + 1}</td><td class="font-monospace">${sc} pts</td></tr>`
    ).join('');
    return `<div class="text-secondary small mb-1">Top scores</div>
<table class="table table-sm table-borderless mb-0 small"><tbody>${rows}</tbody></table>`;
  }

  _render() {
    this._liveEl = null;

    switch (this._state) {
      case 'idle':
        this._el.innerHTML = `
          <p class="text-secondary small">Toss the capsule as high as you can and catch it as gently as possible. Longer flight + softer landing = higher score.</p>
          <button id="ce-start" class="btn btn-info w-100">🥚 Start</button>
          <div class="mt-3">${this._scoresHtml()}</div>`;
        document.getElementById('ce-start').addEventListener('click', () => {
          this._state       = 'armed';
          this._freefallRun = 0;
          this._render();
        });
        break;

      case 'armed':
        this._el.innerHTML = `
          <div class="text-center py-4">
            <div class="display-3">🥚</div>
            <p class="text-secondary mt-3">Throw it!</p>
            <div class="font-monospace fs-5 text-info" id="ce-live">— g</div>
          </div>
          <button id="ce-cancel" class="btn btn-outline-secondary w-100">Cancel</button>`;
        this._liveEl = document.getElementById('ce-live');
        document.getElementById('ce-cancel').addEventListener('click', () => {
          this._state = 'idle';
          this._render();
        });
        break;

      case 'in_freefall':
        this._el.innerHTML = `
          <div class="text-center py-4">
            <div class="display-1 ce-egg-float">🥚</div>
            <div class="font-monospace display-5 text-info mt-3" id="ce-live">0 ms</div>
          </div>`;
        this._liveEl = document.getElementById('ce-live');
        break;

      case 'result': {
        const sc  = calcScore(this._freefallMs, this._peakG);
        const imp = impactLabel(this._peakG);
        this._el.innerHTML = `
          <div class="text-center py-3">
            <div class="display-3">🥚</div>
            <div class="mt-2">
              <span class="text-secondary small">Flight</span>
              <span class="font-monospace fs-4 ms-2">${this._freefallMs} ms</span>
            </div>
            <div class="mt-1">
              <span class="text-secondary small">Impact</span>
              <span class="font-monospace ms-2">${this._peakG.toFixed(1)} g</span>
              <span class="${imp.cls} ms-2">${imp.emoji} ${imp.text}</span>
            </div>
            <div class="display-5 fw-bold mt-2">${sc} pts</div>
            <p class="text-secondary small mt-2">Press Try again or click the button.</p>
            <button id="ce-again" class="btn btn-outline-info mt-1 w-100">Try again</button>
          </div>
          <hr class="my-2">
          ${this._scoresHtml()}`;
        document.getElementById('ce-again').addEventListener('click', () => {
          this._state       = 'armed';
          this._freefallRun = 0;
          this._render();
        });
        break;
      }
    }
  }
}

// ── Game instances ────────────────────────────────────────────────────────────
const gunslinger = new Gunslinger(document.getElementById('gunslinger-body'));
const catchEgg   = new CatchAnEgg(document.getElementById('catch-egg-body'));

// ── BLE wiring (games-specific) ───────────────────────────────────────────────
triki.addEventListener('statuschange', (e) => {
  const connected = e.detail.status === 'connected';
  connectOverlay.classList.toggle('d-none', connected);
  gameArea.classList.toggle('game-area-locked', !connected);
  if (!connected) {
    gunslinger.reset();
    catchEgg.reset();
  }
});

triki.addEventListener('click', () => {
  if (activeGame === 'gunslinger') gunslinger.onButtonClick();
  else if (activeGame === 'catchegg') catchEgg.onButtonClick();
});

triki.addEventListener('sensorupdate', (e) => {
  if (activeGame === 'catchegg') catchEgg.onSensor(e.detail);
});

return {
  reset() {
    activeGame = null;
    gunslinger.reset();
    catchEgg.reset();
  }
};

} // end initGames
