# Module ABI

The contract between a hot-loaded p5 module (`web/app/loaded-modules/<id>.js`)
and the engine (`src/core/registry.js` + `src/core/interfaces.js`). This file
is the single source of truth: the registry, the interface middleware, and the
module-generation prompt (`tools/modgen/gen.mjs`) all defer to it. If you
change behaviour in `registry.js`/`interfaces.js`, change this file in the
same commit.

## Module shape

A module is an ES module (no `import` statements) whose default export is:

```js
export default {
  id: 'my-module',          // required; kebab-case, must match the filename
  oscPrefix: 'mm',          // required; short string for OSC address routing
  interfaces: [...],        // optional; subset of the interface names below
  defaults: { ... },        // optional; tweakable params (numbers, '#rrggbb' hex-string colors)

  // per-interface config objects live at the top level, keyed by interface
  // name — e.g. `triggerable: { enterMs: 400 }` (see "Interfaces" below)

  setup(ctx) {},            // optional; one-time init — create ctx.state here
  draw(ctx) {},             // REQUIRED; called every frame
  onTrigger(ctx, args) {},  // optional; runs when the module is triggered,
                            //   BEFORE the lifecycle flips to 'entering'
  osc(ctx, address, value) {},  // optional; return {trigger:true, args?} to fire
                                //   the lifecycle (or spawn, if multi-instance)
  teardown(ctx) {},         // optional; cleanup before unload / hot-reload
};
```

Notes:

- `ctx.state` is NOT pre-created — assign it yourself in `setup()` (or in
  `onTrigger()` for multi-instance modules, whose spawned instances skip
  `setup()` entirely).
- OSC addresses are `/<oscPrefix>/<param>`. The conventional `osc()` body
  writes recognised params into `ctx.params`:
  `const k = address.split('/').pop(); if (k in ctx.params) ctx.params[k] = value;`
- Modules are hot-reloaded via dynamic `import()` with a cache-busting query;
  `teardown()` runs on the old instance first.
- `draw()` must use the `ctx.p` instance API (`ctx.p.fill(...)`), never bare
  p5 globals.

## ctx — what a module receives

Every hook gets the same per-instance `ctx`:

| field | contents |
|---|---|
| `ctx.p` | shared p5 instance — `fill, noStroke, circle, rect, ellipse, line, push, pop, translate, rotate, color, deltaTime, width, height, PI, TWO_PI, sin, cos, …` |
| `ctx.params` | merged `defaults` + overrides; mutated by OSC |
| `ctx.state` | your own mutable state (you create it) |
| `ctx.audio.state` | live audio features, see below |
| `ctx.id` | module id |
| `ctx.instanceId` | `'<id>#<n>'` — multi-instance spawns only |
| `ctx.interfaces` | `Set` of declared interface names |
| `ctx.lifecycle` | `{ state, alpha, phaseMs, progress, position, config }` — see Interfaces |
| `ctx.movable` | `{ position: {x,y}, velocity, angle, config }` — movable only |
| `ctx.width()` / `ctx.height()` | canvas size in px |

### ctx.audio.state

All values smoothed (~1 s EMA) and normalised 0..1 unless noted:

- `smoothedLevel`, `smoothedBass`, `smoothedMid`, `smoothedTreble`,
  `smoothedCentroid` — coarse aggregates
- `bands` — `{ sub, kick, low, lowMid, mid, upperMid, presence, air }`
  (8 log-spaced energy bands)
- `rolloff`, `flatness`, `crest`, `flux` — spectral shape
- `bpm` — autocorrelation tempo estimate (60–180 range), refresh-rate independent
- `beatPhase` — 0..1 continuous beat phase, 0 = beat boundary. Phase-locked
  to detected onsets; prefer this over `onBeat` for anything rhythmic
  (bounces, pulses, strobes) — it gives you *where in the beat you are*,
  not just a one-frame boolean
- `barPhase` — 0..1 over a 4-beat bar (for longer gestures). **Caveat: this
  is a consistent 4-beat clock anchored to whichever onset the PLL first
  acquired, NOT to the musical downbeat.** Never assume `barPhase === 0` is
  the "one" — downbeat tracking is a separate, future signal. Safe uses:
  gesture *lengths* (something that evolves over 4 beats); unsafe uses:
  accenting "beat 1 of the bar".
- `beatConfidence` — 0..1, how consistently onsets land on the locked phase;
  scale beat-driven motion by it so visuals stay calm when the beat is vague
- `lastConfidentBpm` — the BPM last seen while `beatConfidence ≥ 0.4`

**Reference `beatPhase` users**: `loaded-modules/creature.js` (full usage —
continuous gait phase driving a skeleton, confidence-gated with free-run
fallback) and `loaded-modules/stick-dancer.js` (minimal bounce).

## Creature shape files

The creature's authoring interface (and the format a future LLM shape
designer will emit): a pair in `web/app/shapes/` —

- **`<name>.png`** — 128×128 or 256×256 silhouette, white = inside
  (opaque + white channel; anything else is outside). Tissue is
  rejection-sampled against it.
- **`<name>.json`** — the sidecar:

```json
{
  "name": "biped-1",
  "archetype": "biped",              // gait table: biped | trot | pulse
  "palette": { "hueBody": 190, "hueLimbs": 150, "hueAccent": 315 },
  "pinRadius": 0.07,                 // joint pin capture radius
  "ground": 0.905,                   // ground line, image fraction
  "eyes": [ { "x": -0.035, "y": -0.01, "r": 0.013 } ],   // head-relative
  "joints": [
    { "name": "pelvis", "x": 0.50, "y": 0.53, "parent": null, "role": "root" },
    { "name": "kneeL",  "x": 0.435,"y": 0.70, "parent": "pelvis", "role": "knee", "limb": 0 },
    { "name": "footL",  "x": 0.415,"y": 0.875,"parent": "kneeL", "role": "limb",
      "limb": 0, "paw": true, "ground": true, "phase": 0 }
  ],
  "parts": [
    { "label": "head",  "x": 0.50, "y": 0.15, "r": 0.13 },
    { "label": "limb0", "x": 0.43, "y": 0.75, "r": 0.155 }
  ]
}
```

All coordinates are image fractions (0..1, y down). Rules:

- `joints`: parents by name, and a parent must be listed before its
  children. `role` ∈ root | rootMid | head | knee | limb. `limb` ties a
  knee to its tip. `paw: true` pins a 9-node rigid cluster; `ground: true`
  marks a walking foot (stance/swing cycle); `phase` is the gait offset
  (0 / 0.5 for left/right alternation — also used for arm counter-swing).
- `parts`: labelled circles. `limb*` regions are sampled as RING CHAINS
  along the region's principal axis (continuous ropes); everything else is
  grid-sampled as body/head flesh. Regions should cover their limb snugly —
  body sampling excludes them.
- `palette` sets the part hues; the module's `hue*` params override it
  when changed from their defaults.

**Recommended fallback** — while `beatConfidence < 0.4` the PLL is acquiring
and `beatPhase` may jump; don't freeze, free-run your own phase at
`lastConfidentBpm`:

```js
const a = ctx.audio.state;
if (a.beatConfidence >= 0.4 && a.bpm > 0) {
  ctx.state.phase = a.beatPhase;                    // locked: follow the PLL
} else if (a.lastConfidentBpm > 0) {               // vague: keep dancing at
  ctx.state.phase =                                 // the last known tempo
    (ctx.state.phase + (ctx.p.deltaTime / 1000) * (a.lastConfidentBpm / 60)) % 1;
}
```
- `beatsPerSec` — beat rate over the last 3 s
- `onBeat` — boolean, true on detected bass onsets (legacy; prefer `beatPhase`)

## Creature move tables

Dance moves are data, not code (and the target format for a future mocap
extractor): one JSON per move in `web/app/moves/` —

```json
{
  "name": "tstep",
  "beatsPerLoop": 2,        // loop length in beats (move-local clock)
  "overlay": 0.3,           // 0..1 scale on the procedural layers underneath
  "keys": [
    {
      "phase": 0,           // 0..1 position within the loop
      "joints": {           // offsets from the NEUTRAL pose, by joint name
        "chest":  { "rot": -0.07 },              // radians, joins the FK chain
        "footL":  { "dx": -0.05, "dy": -0.015 }  // shape units (0..1, y down)
      },
      "contacts": ["footR"],// ground tips planted during the segment
                            // STARTING at this key (stance lock)
      "ease": "snap"        // smooth | snap | linear, for the same segment
    }
  ]
}
```

Rules:

- Playback interpolates piecewise between consecutive keys over the
  move-local phase (`beatsPerLoop` beats per loop), wrapping last → first.
  `smooth` smoothsteps the whole segment; `snap` completes in the first
  quarter and holds (still smoothstepped — an instant jump would flag the
  joint-speed spike metric); `linear` is linear.
- The table layers UNDER the procedural bounce/lean/Perlin/simmer: those
  stay on, scaled by the move's `overlay`.
- Prefer `rot` keys on chained joints (knees, elbows, hands, chest): they
  join the FK chain, so bone lengths hold by construction. `dx`/`dy` on a
  chained joint stretches its bone — keep those small (≤ a few % of the
  bone) or put them on roots (`pelvis`) and ground tips (kicks).
- `contacts` lists ground-tip joint names planted from this key until the
  next: they stay locked to their neutral ground position (knees follow
  geometrically) while the body moves over them. Unlisted feet are free.
- The FSM's dance states rotate through a weighted per-state repertoire
  (gait-table default, sidecar `repertoire` override); the `move` param
  forces a specific table by name.
- **Beat-impact convention**: phase 0 is the IMPACT — the bounce's lowest
  (squash) point, a kick's hit. All shipped tables follow it; keep it when
  authoring, or the visual-offset calibration means nothing.

## Interfaces

Declare in `interfaces: [...]`; configure with a same-named top-level object.
Omitted config fields fall back to the defaults shown.

### `triggerable`

Idle until triggered (pad, OSC, REST); then runs
`idle → entering → active → exiting → idle`. `ctx.lifecycle.state` holds the
phase, `ctx.lifecycle.progress` is 0..1 within the phase.

```js
triggerable: { enterMs: 500, holdMs: 1500, exitMs: 600, autoRetrigger: false }
```

`autoRetrigger: true` lets a trigger restart the cycle mid-flight.
Non-triggerable modules are permanently `active`.

### `fadeable`

Derives `ctx.lifecycle.alpha` (0..`maxAlpha`) from the lifecycle phase —
multiply your fills by it.

```js
fadeable: { easing: 'cubic-out', maxAlpha: 1 }
// easings: linear | cubic-in | cubic-out | cubic-in-out | quint-out
```

### `sliding`

Interpolates `ctx.lifecycle.position` (`{x,y}` in 0..1 canvas fractions)
from → to on enter, back on exit.

```js
sliding: { from: {x:0,y:0}, to: {x:0,y:0}, easing: 'cubic-out', exitEasing: 'cubic-in' }
```

### `movable`

Continuous steady-state motion; position at `ctx.movable.position`
(`{x,y}` in 0..1 fractions — multiply by `p.width`/`p.height` to draw).
Runs regardless of lifecycle state. Can be combined with `sliding` (separate
position objects, no clobbering). Triggering resets position to `start`.

```js
movable: {
  behavior: 'linear',        // 'linear' | 'bounce' | 'wander' | 'orbit'
  start:    { x: 0.5, y: 0.5 },
  speed:    0.3,             // canvas-widths per second (orbit: revolutions/s)
  velocity: { x: 1, y: 0 },  // initial direction, normalised then scaled by speed
  damping:  1.0,             // bounce elasticity (<1 loses energy)
  wrap:     false,           // linear: wrap edges instead of leaving
  jitter:   0.6,             // wander: direction wobble, radians/s
  center:   { x: 0.5, y: 0.5 },  // orbit
  radius:   0.2,                 // orbit, canvas-widths
}
```

### `multi-instance`

The loaded module is a spawn template: it never draws itself and skips
`setup()`. Each trigger spawns a transient with a fresh `ctx` (cloned params,
own lifecycle), runs `onTrigger(ctx, args)`, and auto-culls when the
lifecycle returns to idle. Usually combined with `triggerable` + `fadeable`.

```js
'multi-instance': { max: 16 }   // oldest transient evicted beyond the cap
```

## Worked example

```js
export default {
  id: 'bouncing-ball', oscPrefix: 'ball',
  interfaces: ['movable'],
  movable: { behavior: 'bounce', start: {x:0.5, y:0.5}, speed: 0.55,
             velocity: {x:0.7, y:0.45}, damping: 1.0 },
  defaults: { size: 60, color: '#ff3d7f' },
  draw(ctx) {
    const { p, params, movable, audio } = ctx;
    const pulse = 1 + audio.state.smoothedBass * 0.6;
    p.noStroke(); p.fill(params.color);
    p.circle(movable.position.x * p.width, movable.position.y * p.height,
             params.size * pulse);
  },
  osc(ctx, address, value) {
    const k = address.split('/').pop();
    if (k in ctx.params) ctx.params[k] = value;
    return null;
  },
};
```
