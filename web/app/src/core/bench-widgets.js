/**
 * Shared bench widgets (brief 13.2): tiny canvas painters used by the bench
 * and the puppet page. No state — every function paints one frame from data.
 */

export function spark(cv, pts, { min, max, color = '#8fa7ff', windowMs = 60_000, marks = null, now = Date.now() } = {}) {
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const t0 = now - windowMs;
  if (marks) {
    g.strokeStyle = '#26263d';
    for (const m of marks) {
      const y = cv.height - ((m - min) / (max - min)) * cv.height;
      g.beginPath(); g.moveTo(0, y); g.lineTo(cv.width, y); g.stroke();
    }
  }
  g.strokeStyle = color; g.beginPath();
  let started = false;
  for (const [t, v] of pts) {
    const x = ((t - t0) / windowMs) * cv.width;
    const y = cv.height - Math.max(0, Math.min(1, (v - min) / (max - min))) * cv.height;
    started ? g.lineTo(x, y) : g.moveTo(x, y);
    started = true;
  }
  g.stroke();
}

/** move-local phase wheel: circle, key-phase spokes, phase dot */
export function phaseWheel(cv, loopPhase, keyPhases = []) {
  const g = cv.getContext('2d');
  const R = cv.width / 2 - 4, cx = cv.width / 2, cy = cv.height / 2;
  g.clearRect(0, 0, cv.width, cv.height);
  g.strokeStyle = '#2c3350'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
  g.strokeStyle = '#556';
  for (const ph of keyPhases) {
    const a = ph * Math.PI * 2 - Math.PI / 2;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.6, cy + Math.sin(a) * R * 0.6);
    g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke();
  }
  const a = loopPhase * Math.PI * 2 - Math.PI / 2;
  g.fillStyle = '#ffd24d';
  g.beginPath(); g.arc(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8, 4, 0, 7); g.fill();
}

/** state/move ribbon over a time window */
export function ribbonStrip(cv, ribbon, { windowMs = 60_000, stateColors = {}, moveColors = {}, now = Date.now() } = {}) {
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const t0 = now - windowMs;
  for (let i = 0; i < ribbon.length; i++) {
    const [t, st, mv] = ribbon[i];
    const tEnd = i + 1 < ribbon.length ? ribbon[i + 1][0] : now;
    const x0 = Math.max(0, ((t - t0) / windowMs) * cv.width);
    const x1 = ((tEnd - t0) / windowMs) * cv.width;
    g.fillStyle = stateColors[st] ?? '#39415e';
    g.fillRect(x0, 0, x1 - x0, cv.height * 0.55);
    g.fillStyle = moveColors[mv] ?? '#23233a';
    g.fillRect(x0, cv.height * 0.6, x1 - x0, cv.height * 0.4);
  }
}

/** tier badge colouring */
export function tierColor(tier) { return tier === 'grid' ? '#17b26a' : '#8fa7ff'; }
