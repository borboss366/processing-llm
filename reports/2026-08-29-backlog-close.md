# Brief 13.2 — close the backlog

Date: 2026-08-29. Deviation up front: briefs 12.5 and 12.7 were never
delivered to the repo (download-only) — Tasks 1 and 3 were implemented
from the inline summaries in 13.2; Task 4.1's briefs-dir completeness
waits on the user supplying those two files.

## Task 1 — measured preset tags

`tools/preset-measure.mjs`: 8 frames over ~2 s per preset against live
audio (160×90 in-page sampling of the Butterchurn canvas — no PNG
round-trips), metrics → tags:

| metric | tag |
|---|---|
| mean luminance | brightness |
| RMS chroma | energy |
| edge density (gradient > threshold) | complexity |
| mean \|frame diff\| | motion |

(The exact 12.5 metric→tag mapping was unavailable; this pairing is the
natural one and is stamped `source: measured` for provenance.)
Normalised to 1–5 quantiles across the 100-preset catalogue; prose,
density, geometry, colors untouched. Rerunnable (`--redo` recomputes;
without it, measured presets are skipped); refuses while any browser is
connected to the controller (`/status`, new endpoint) unless `--force`.
The catalogue line labels numeric tags (`c3 e4 b2 m5`) so the prompt
stays legible.

**Histograms** (old vision-judged → new measured):

- brightness: `medium 64 / bright 31 / dim 5` → `20 per bin × 5`
- energy: `medium 33 / intense 33 / calm 25` → `20 × 5`
- motion: `flowing 27 / swirling 8 / static 8` (57 files untagged!) → `20 × 5`
- complexity: was already normalised `20 × 5` → re-derived from edges, `20 × 5`

No single-bin tags remain; motion coverage went from 43% to 100%.

**Replay A/B** (same session 2026-08-22, same seed 1, old vs new tags):
**14/14 replayed picks changed.** Excerpt:

```
w1  old: _Aderrasi - Wanderer in Curved Spac…  new: flexi - bouncing balls [double mind…
w2  old: An AdamFX n Martin Infusion 2 flexi…  new: Flexi - mindblob mix
w3  old: martin - extreme heat                 new: Flexi, martin + geiss - dedicated t…
```

Ops note: the description set is memoized — the server was restarted
after measurement, which also re-warms the prompt (one-time KV rebuild).

## Task 2 — fixed-rate PLL tick

Analysis (FFT read, flux, onsets, PLL, feature windows) now runs on an
**AudioWorklet cadence** — a silent processor posts every 6 render
quanta (≈17 ms ≈ 57 Hz) on the audio clock, immune to display rate,
visibility and headless GL; drift-corrected timer fallback when
worklets are unavailable. The production render loop's `audio.tick()`
became a light per-frame refresh (clock publish + visual phase);
`tick(t)` with an explicit timestamp keeps the full synchronous path so
the synthetic harnesses are byte-identical. GridClock and every
consumer untouched.

- Synthetic suite: PASS unchanged (4 scenarios, ±0.5 at 60/120 Hz).
- **Idle-page collapse (brief 12 finding) GONE**: a fully idle page at
  121 fps rAF previously pinned confidence ≤ 0.19 forever; now locks
  125 BPM with conf 0.54–0.70 sustained (~20 s acquisition).
- Real-track matrix (now forced to `clock=pll` — grids exist for every
  track and would otherwise be measured vacuously): 4/4 within ±2
  confident.
- **dnb-174 retested at fixed rate: still bistable** — confident
  medians 172.0 / 170.0 / 167.4 across three runs, raw medians visiting
  the ~153 attractor. Per the brief: a genuine prior issue, documented
  as the PLL-tier known-item, prior NOT tuned. The grid tier owns that
  track (173.4 exact).
- Dead rate-compensation paths: none qualified for deletion — the
  adaptive tick-interval measurement still serves the harness-driven
  variable-rate path, and the dt clamps are resume armor (13.1), not
  rate compensation.

## Task 3 — puppet page

`puppet.html` + `src/puppet.js`, widgets shared with the bench via new
`core/bench-widgets.js` (spark / phase wheel / ribbon / tier colour —
bench refactored onto it, no duplicated painters). Cast & state: shape
selector (built-ins from new `/shapes-list` + approved audience spool
via the submit service, gracefully absent), Enter/Exit (enable-based
exit — the registry has no lifecycle-exit API; noted), behavior force
row; the move rig relocated from the controller (which now links to the
page); auto-enumerated live param controls from the render-state module
mirror (ranges for numerics, text for strings, live value mirroring);
clock-tier badge + `visualBeatOffsetMs` slider mirroring the bench;
Snapshot → clipboard + `puppet-snapshot` session event, JSON includes
the clock tier.

Acceptance (`tools/puppet-check.mjs`, recorded to `reports/puppet.webm`
+ `puppet.png`): select biped-2 → Enter → groove → force tstep →
Manual + scrub 0.5 → tweak `bounce` → play → Snapshot. All round-trips
asserted (move forced, loop phase 0.5, snapshot on the WS stream with
tier). Caught en route: the server hadn't been restarted after
`/shapes-list` landed, so the selector was silently empty and the
snapshot carried the default shape — fixed by restart, re-run green
with `shape=biped-2`.

## Task 4 — housekeeping

- `docs/briefs/`: 13.2 committed alongside this report; **12.5 and
  12.7 remain user-owed** (download-only deliveries).
- STATUS fully rewritten: verified table (numbers + tools), Open =
  user gates/inputs/content briefs only, Next = brief 14.
- Architecture trigger stated in STATUS: the layer-manager refactor
  fires with the FIELD SCENE (brief 16), not before.
- `verify --full` end to end: **14 PASS, 1 explained SKIP**
  (`low-tempo: awaiting user tracks ~93 + ~81 BPM`). One harness bug
  fixed en route: `replay --latest` picked the newest session by mtime,
  which was the 08-25 move-judging session with zero director events —
  it now selects the newest session that actually contains them.

## Task 5 — memory A/B in tag space (optional, done — it was cheap)

Same session, same seed, measured-tag vectors (c,e,b,m) per pick:

| variant | mean step | max step | smoothness (mean \|Δstep\|) |
|---|---|---|---|
| no-memory | 3.79 | 5.39 | 1.20 |
| memory | 3.44 | 5.83 | 1.72 |

Memory takes slightly smaller steps through tag space but less evenly;
neither dominates. Consistent with the brief-4 tie — no prompt changes
made, `no-memory` stays the default.


## Update 2026-08-30 — low-tempo tracks landed

The user supplied both tracks; the SKIP row is now a live check
(`tools/low-tempo-check.mjs`, verify --full):

- **Dr. Dre – Still D.R.E. (truth 93)**: gridded at 93.5 (ibi-spread
  0.47%); PLL locks 93.49 confident (Δ 0.49) — strict ±2 gate. Note the
  sparse hip-hop kick keeps confidence below 0.4 for ~70% of the run —
  lock is right, just intermittently confident.
- **Queen – We Will Rock You (truth 81)**: the unconstrained gridder
  octave-doubled to 162.2 (the ~125 prior), regridded exact at 81.3 with
  `--bpm 81`. The LIVE PLL confidently locks 161.1 (conf 0.55) — the
  stomp-stomp-clap presents ~162 events/min and the 120-centred prior
  takes the upper octave. Same family as dnb-174: documented, prior NOT
  tuned; gated mod-octave (±3 of 81 or 162) so any drift to a third
  attractor still fails the check. The grid tier owns the track.


## Update 2026-08-30 — briefs 12.5 + 12.7 landed; reconciliation

The user supplied the two download-only brief files. Cross-check of the
13.2 implementations against the actual specs:

**12.5 (fixed-rate tick + measured tags) — matches.** The worklet-driven
analysis tick is the brief's Task 1 as built; its idle acceptance
("confidence ≥ 0.5 under rAF throttling") was met at 0.54–0.70. One
named deviation: Task 1.4 lists "measured tick EMA in lag conversion"
as dead code to delete — it is retained deliberately, because the
explicit-timestamp `tick(t)` path still serves the test harnesses at
arbitrary simulated rates and needs the measured interval. The
metric→tag pairing is unspecified in 12.5 as well, so the pairing
documented in the Task 1 section above stands as the definition.

**12.7 (puppet page) — three gaps found, all closed today:**

- *Exit through the normal fades*: Exit was `enable=false` (instant
  hide). Now a real exit path: `POST /browser-modules/exit` → WS
  `module-exit` → `registry.exitModule()` forces the lifecycle into
  `exiting`, so the creature fades out over its 900 ms exitMs and
  settles idle. Enter re-triggers through the entering fade as before.
- *Palette swatch pickers*: hue params previously got the generic
  range inference (huePrimary 190 → max 570 — wrong). `^hue` params now
  render as 0–360 sliders with a live HSL swatch chip; the creature's
  `huePrimary/hueSecondary/hueAccent` are exactly the brief's three
  palette params.
- *Live truth completeness*: the joint-speed sparkline + spike count
  were on the bench but not the puppet; added via the shared
  `bench-widgets.js` spark.

Also reconciled: the brief's `GET /module-params/<id>` allows a "WS
equivalent" — the render-state modules mirror (defaults + live params
from `registry.list()`) is that equivalent; no new endpoint was added.
The acceptance's "two param slider changes" is now literal:
`puppet-check.mjs` changes bounce → 2.4 and huePrimary → 40 and asserts
both from the RENDER window's render-state broadcast (not the puppet's
own mirror), plus the exit fade (`exiting` observed, settles `idle`).
Rerun on the live stack: `VERIFY:PASS puppet-check` (reports/puppet.webm
+ puppet.png refreshed). README gains the "Puppet (creature workshop)"
section; the move-authoring walkthrough now points at puppet.html. The
architecture diagram is unchanged: observer/hand-control pages sit below
its component altitude (bench.html was never in it either); the puppet's
flows ride the existing osc/browser-modules paths.
