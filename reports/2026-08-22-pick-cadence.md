# Pick cadence fix — acceptance report (Brief 3, Task 1)

Same techno mix, same seek (60 s), 12.3-minute Auto-Director session through
the full live stack, before vs after the cadence controls
(session `2026-08-22T19-29-28-829Z`, analysed with the cadence script;
baseline is session `2026-08-22T18-23-29-150Z`).

| metric | before | after | target |
|---|---|---|---|
| picks per minute | 3.17 (38 picks) | **1.14** (14 picks) | ≤ 1.5 |
| unique presets | 21/38 (revisits within minutes) | **14/14** | — |
| director hold answers | n/a | 0 | — |
| off-list picks | 0 | 0 | 0 |
| commits near a bar boundary (phase <0.1 or >0.9) | n/a (instant apply) | **13/14** | — |
| pick latency (median) | 6.4 s (double-fire queueing) | 6.2 s | — |

Bar-phase histogram at commit (10 bins over 0–1):
`[13, 0, 0, 0, 0, 0, 1, 0, 0, 0]` — the single mid-bar commit is the one
low-confidence fallback (beatConfidence < 0.4 at arrival → 4 s timer, by
design). Median arrival→commit wait 1.4 s ≈ half a bar at 125 BPM; max 4.1 s.

Pick spacing is almost exactly min-hold-driven (~52 s apart): on a
continuously-evolving mix the profile distance crosses the threshold nearly
every time the 45 s clock expires. For a 1–3-minute held look the operator
raises the min-hold input (controller UI, next to Auto-Director); the
mechanism doesn't need to change.

## What changed

- **Min hold**: no director call within `minHoldMs` (UI input, default 45 s)
  of the last committed decision.
- **Hysteresis**: distance must exceed the threshold for 2 consecutive 4 s
  windows; a single spiky window (fill, FX hit) can't trigger. Detector
  documented at the constants in `controller.js`, pointer in `director.ts`.
- **Director may hold**: `"preset":"hold"` is a valid answer, logged as a
  decision. Not exercised in this session — every call (fired only after
  sustained change + expired hold) was deemed worth a change by the model;
  the parse path is unit-verified. Deviation from the brief: a hold updates
  the anchor and restarts the min-hold clock (otherwise a
  changed-but-held section re-fires a 6 s LLM call every min-hold forever).
- **Bar-quantized commit**: picks are applied by the *render* window at its
  next `barPhase` wrap (controller doesn't know the phase), or after ≤4 s
  when confidence < 0.4; the render acks `preset-committed` with the exact
  commit phase. 12 s safety timeout if the BPM stalls.
- **Recency** raised 8 → 12 picks.
- Also fixed on the way: a leftover `MIN_CHANGE_INTERVAL_MS` reference that
  silently killed the first re-record (ReferenceError in the click handler).

## Beat behaviour this session

Confidence mean 0.51; 9 dips below 0.4, longest 46 s at ~389 s file-time
(deeper breakdown section than the baseline run caught); BPM held ~124–125
throughout and re-acquired after every dip.
