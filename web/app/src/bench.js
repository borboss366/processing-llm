/**
 * Bench (brief 12.6) — READ-ONLY observer surface for manual testing.
 *
 * Consumes the render window's `bench-state` WS feed (~15 Hz of
 * already-computed audio.state + creature values) plus the relayed session
 * events. Writes nothing, controls nothing. Centerpiece: the click track —
 * WebAudio blips scheduled from bpm + beatPhase with ~120 ms lookahead
 * (its own clock, not rAF), downbeats pitched higher; the operator judges
 * beat tracking by ear. Everything else is strips: BPM sparkline,
 * confidence, onset-vs-grid scatter with spacebar tap-along, band/flux/z
 * audio strip, FSM/move ribbon with the move-local phase wheel, and a
 * scrolling decision log.
 */

import { createWs } from './core/ws.js';
import { spark, phaseWheel, ribbonStrip, tierColor } from './core/bench-widgets.js';

const $ = (id) => document.getElementById(id);
const now = () => Date.now();

// ─── model ────────────────────────────────────────────────────────────────
let B = null;                    // latest bench-state
const bpmHist = [];              // [wallMs, bpm]
const onsetPts = [];             // [wallMs, err] (deduped from the ring)
const tapPts = [];               // [wallMs, err]
const speedHist = [];            // [wallMs, v, flagged]
const ribbon = [];               // [wallMs, state, move]
const zHist = [];                // [wallMs, z]
const fluxHist = [];             // [wallMs, flux, onset]
let zm = 0, zv = 1e-4;           // energy z-score EMA (director-style approximation)
let lastOnsetT = 0;
let keyPhases = [];              // spokes for the phase wheel
let keyMove = null;
let lastSpikes = 0;

const trim = (arr, ms) => { const cut = now() - ms; while (arr.length && arr[0][0] < cut) arr.shift(); };

// ─── click track ──────────────────────────────────────────────────────────
let actx = null, clickOn = false, lastClickWall = 0;
const toggleBtn = $('click-toggle');
toggleBtn.addEventListener('click', () => {
  if (!actx) actx = new AudioContext();
  actx.resume();
  clickOn = !clickOn;
  toggleBtn.textContent = `Click track: ${clickOn ? 'ON' : 'OFF'}`;
  toggleBtn.classList.toggle('on', clickOn);
});

function blip(at, down) {
  const osc = actx.createOscillator();
  const g = actx.createGain();
  const vol = Number($('click-vol').value);
  osc.frequency.value = down ? 1420 : 880;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.6 * vol, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.07);
  osc.connect(g).connect(actx.destination);
  osc.start(at); osc.stop(at + 0.09);
}

// wall-clock time of the k-th beat after the latest message; k may be
// fractional-free integer beats counted from the message's beatPhase
const beatWall = (k) => B.t + (k - B.beatPhase) * (60_000 / B.bpm);

setInterval(() => {
  if (!clickOn || !actx || !B || B.bpm <= 0) return;
  const beatMs = 60_000 / B.bpm;
  const phaseNow = B.beatPhase + (now() - B.t) / beatMs;
  for (let k = Math.ceil(phaseNow - 1e-6); ; k++) {
    const wall = beatWall(k);
    if (wall < now() + 5) continue;
    if (wall > now() + 130) break;
    if (wall <= lastClickWall + beatMs * 0.4) continue;   // already scheduled
    lastClickWall = wall;
    const beatIdx = Math.round(B.barPhase * 4 - B.beatPhase + k);
    blip(actx.currentTime + (wall - now()) / 1000, ((beatIdx % 4) + 4) % 4 === 0);
    (window.__benchClicks ??= []).push(wall);             // harness seam
    if (window.__benchClicks.length > 256) window.__benchClicks.shift();
  }
}, 25);

// ─── tap-along ────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || !B || B.bpm <= 0) return;
  e.preventDefault();
  const beatMs = 60_000 / B.bpm;
  const ph = (B.beatPhase + (now() - B.t) / beatMs) % 1;
  tapPts.push([now(), ph <= 0.5 ? ph : ph - 1]);
  trim(tapPts, 30_000);
  const errs = tapPts.map((p) => p[1]).sort((a, b) => a - b);
  $('tapMed').textContent = errs.length ? `${(errs[(errs.length / 2) | 0] * 1000 * (60_000 / B.bpm) / 1000).toFixed(0)} ms` : '—';
});

// ─── WS feed + decision log ───────────────────────────────────────────────
const logEl = $('log');
function logLine(text) {
  const d = new Date();
  const line = document.createElement('div');
  line.innerHTML = `<span class="t">${d.toTimeString().slice(0, 8)}</span> ${text}`;
  logEl.appendChild(line);
  while (logEl.childNodes.length > 200) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

const wsOut = createWs({
  url: `ws://${location.host}/ws`,
  onMessage(msg) {
    if (msg.type === 'bench-state') {
      B = msg;
      bpmHist.push([msg.t, msg.bpm]); trim(bpmHist, 60_000);
      for (const [t, err] of msg.onsets ?? []) {
        if (t > lastOnsetT) { lastOnsetT = t; onsetPts.push([t, err]); }
      }
      trim(onsetPts, 30_000);
      // director-style energy z (EMA mean/variance of level)
      const a = 0.01;
      zm = zm * (1 - a) + msg.level * a;
      const dv = msg.level - zm;
      zv = zv * (1 - a) + dv * dv * a;
      zHist.push([msg.t, dv / Math.sqrt(zv + 1e-6)]); trim(zHist, 60_000);
      fluxHist.push([msg.t, msg.flux, onsetPts.length && now() - onsetPts.at(-1)[0] < 120]); trim(fluxHist, 20_000);
      const c = msg.creature;
      if (c) {
        speedHist.push([msg.t, c.jointSpeed, c.spikesFlagged > lastSpikes]); trim(speedHist, 60_000);
        if (c.spikesFlagged > lastSpikes) logLine(`⚠ joint-speed spike flagged (total ${c.spikesFlagged})`);
        lastSpikes = c.spikesFlagged;
        const last = ribbon.at(-1);
        if (!last || last[1] !== c.st || last[2] !== c.move) ribbon.push([msg.t, c.st, c.move]);
        trim(ribbon, 61_000);
        window.__benchRibbon = ribbon;   // harness seam
        if (c.move && c.move !== keyMove) {
          keyMove = c.move;
          fetch(`/moves/${c.move}.json`).then((r) => r.json())
            .then((j) => { keyPhases = (j.keys ?? []).map((k) => k.phase); })
            .catch(() => { keyPhases = []; });
        }
      }
    } else if (msg.type === 'module-error' || msg.type === 'module-recovered') {
      logLine(`${msg.type === 'module-error' ? '💥' : '♻'} <span class="kv">${msg.type}</span> ${msg.id}: ${msg.message}`);
    } else if (msg.type === 'resume-after-gap' || msg.type === 'creature-resume') {
      logLine(`resume after gap (${msg.ms ?? msg.gapMs} ms)`);
    } else if (msg.type === 'audio-health') {
      logLine(`audio-health: <span class="kv">${msg.kind}</span> ${msg.detail ?? ''}`);
    } else if (msg.type === 'clock-tier') {
      logLine(`beat clock → <span class="kv">${msg.tier.toUpperCase()}</span> (${msg.file ?? ''})`);
    } else if (msg.type === 'creature-state') {
      logLine(`creature state → <span class="kv">${msg.state}</span> (z ${msg.z})`);
    } else if (msg.type === 'creature-move') {
      logLine(`move → <span class="kv">${msg.move ?? '(none)'}</span> in ${msg.state}`);
    } else if (msg.type === 'preset-committed') {
      logLine(`preset commit: ${msg.name} (waited ${msg.waitedMs} ms${msg.lowConfidenceFallback ? ', low-conf fallback' : ''})`);
    } else if (msg.type === 'apply-pick') {
      logLine(`director pick: ${msg.name}`);
    } else if (msg.type === 'moves-changed') {
      logLine(`move table hot-pushed: ${msg.name} v${msg.v}`);
    } else if (msg.type === 'moves-error') {
      logLine(`move table JSON error (${msg.name}): ${msg.error}`);
    }
  },
});

// ─── visual beat offset (brief 13 Task 6): the ONE control on the bench —
// display-latency calibration, persisted render-side, click stays raw ─────
{
  const slider = $('vis-off'), val = $('vis-off-val');
  let synced = false;
  slider.addEventListener('input', () => {
    val.textContent = slider.value;
    wsOut.send({ type: 'set-visual-offset', ms: Number(slider.value) });
  });
  setInterval(() => {
    if (!synced && B && typeof B.visualOffsetMs === 'number') {
      slider.value = String(B.visualOffsetMs);
      val.textContent = String(B.visualOffsetMs);
      synced = true;
    }
  }, 500);
}

// ─── drawing ──────────────────────────────────────────────────────────────
const STATE_COLORS = { idle: '#39415e', walk: '#2c7a4b', groove: '#7a2c6b', hop: '#7a6b2c' };
const MOVE_COLORS = { groove: '#ff5d7e', 'tstep-placeholder': '#4dd9e8', 'armwave-placeholder': '#ffd24d' };


function draw() {
  requestAnimationFrame(draw);
  if (!B) return;

  $('bpm').textContent = B.bpm > 0 ? String(Math.round(B.bpm)) : '—';
  const tierEl = $('tier');
  tierEl.textContent = (B.tier ?? 'pll').toUpperCase();
  tierEl.style.color = tierColor(B.tier);
  spark($('bpmSpark'), bpmHist, { min: 60, max: 190 });

  { // confidence gauge
    const cv = $('conf'), g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#1b1b2e'; g.fillRect(0, 30, cv.width, 12);
    g.fillStyle = B.beatConfidence >= 0.4 ? '#17b26a' : '#b2611a';
    g.fillRect(0, 30, cv.width * Math.min(1, B.beatConfidence), 12);
    g.fillStyle = '#667'; g.font = '11px ui-monospace';
    g.fillText(`conf ${B.beatConfidence.toFixed(2)}`, 0, 22);
  }

  { // bar dots 1-2-3-4
    const beat = Math.floor((B.barPhase * 4 + (now() - B.t) / (60_000 / Math.max(1, B.bpm))) % 4);
    [...$('barDots').children].forEach((d, i) => d.classList.toggle('on', i === beat && B.bpm > 0));
  }

  { // onset-vs-grid strip + taps
    const cv = $('onsetStrip'), g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.strokeStyle = '#2c3350'; g.beginPath();
    g.moveTo(0, cv.height / 2); g.lineTo(cv.width, cv.height / 2); g.stroke();
    const t1 = now(), t0 = t1 - 30_000;
    const plot = (pts, color, r) => {
      g.fillStyle = color;
      for (const [t, err] of pts) {
        const x = ((t - t0) / 30_000) * cv.width;
        const y = cv.height / 2 - (err / 0.5) * (cv.height / 2 - 4);
        g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      }
    };
    plot(onsetPts, '#8fa7ff', 2.5);
    plot(tapPts, '#ffd24d', 3.5);
  }

  { // audio: bands
    const cv = $('bandBars'), g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    const names = Object.keys(B.bands ?? {});
    const w = cv.width / Math.max(1, names.length);
    names.forEach((nm, i) => {
      const v = B.bands[nm];
      g.fillStyle = '#4dd9e8';
      g.fillRect(i * w + 2, cv.height * (1 - v), w - 4, cv.height * v);
    });
  }
  { // rms + centroid columns
    const rc = $('rms'), rg = rc.getContext('2d');
    rg.clearRect(0, 0, rc.width, rc.height);
    rg.fillStyle = '#5ee89a'; rg.fillRect(4, rc.height * (1 - B.level), rc.width - 8, rc.height * B.level);
    const cc = $('centroid'), cg = cc.getContext('2d');
    cg.clearRect(0, 0, cc.width, cc.height);
    cg.fillStyle = '#e84dd9'; cg.fillRect(4, cc.height * (1 - Math.min(1, B.centroid)), cc.width - 8, 6);
  }
  spark($('fluxSpark'), fluxHist.map((f) => [f[0], f[1]]), { min: 0, max: Math.max(1, ...fluxHist.map((f) => f[1])), color: '#ff8b4d', windowMs: 20_000 });
  spark($('zSpark'), zHist, { min: -2.5, max: 3.5, color: '#8fa7ff', marks: [-0.5, 0.5, 1.5] });

  const c = B.creature;
  if (c) {
    $('cState').textContent = c.st;
    $('cMove').textContent = c.move ?? '(procedural)';
    $('cBlend').textContent = c.blend ? 'ON' : '—';
    $('cSpikes').textContent = String(c.spikesFlagged);

        phaseWheel($('phaseWheel'), c.loopPhase, keyPhases);

        ribbonStrip($('ribbon'), ribbon, { stateColors: STATE_COLORS, moveColors: MOVE_COLORS });

    spark($('speedSpark'), speedHist.map((s) => [s[0], s[1]]), { min: 0, max: Math.max(1, ...speedHist.map((s) => s[1])), color: '#5ee89a' });
    { // spike flags over the speed sparkline
      const cv = $('speedSpark'), g = cv.getContext('2d');
      const t1 = now(), t0 = t1 - 60_000;
      g.fillStyle = '#ff3d5e';
      for (const [t, , flag] of speedHist) {
        if (flag) g.fillRect(((t - t0) / 60_000) * cv.width - 1, 0, 3, 8);
      }
    }
  }
}
requestAnimationFrame(draw);
