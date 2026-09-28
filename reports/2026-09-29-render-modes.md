# Judgment render modes + onion skin (puppet + judgment view)

**Modes** (`renderMode` param; hotkey `m` cycles, `M` reverse):
goo · goo-bones (skin at 60 % alpha, skeleton drawn through it) ·
bones (skeleton only) · silhouette (flat thresholded density, no
shading — a `uFlat` branch in the shade shader) · wire (the existing
diagnostic). `goo+bones` accepted as an alias. Stage default stays
`goo` — the live path is unchanged unless a key is pressed.

**Onion skin** (`onion` param = ghost frames, 0 off; hotkey `o`
toggles 0↔12): a ring of past joint poses drawn as fading skeleton
ghosts (oldest faintest, every 2nd frame), composable with EVERY mode
— ghost skeletons were chosen over full-frame afterimages because they
stay legible over the goo and cost ~6 line-strips per frame.

**Hotkeys** live in BOTH places: the render window itself (mutates the
live params via the `__creatureParams` seam) and the puppet page
(mirrors over `/osc`, with a toast in the snapshot status line).

**Judgment default:** `capture-variants.mjs` now records in
`goo-bones` by default (`--render-mode` overrides, `--onion N`
optional) and restores `goo` after — the export honors the chosen
mode because the screencast captures the canvas as rendered. The
puppet snapshot already includes `renderMode`/`onion` (params dump).

**Verified** (headless, runningman-captured live): all 5 modes + onion
captured (`2026-09-29-render-modes.png`), hotkey cycle exercised via
synthetic keydown (goo-bones → bones; onion 12 → 0), perf 2.28 ms
frame avg, 0 spikes.

**Deviation note:** "per panel where applicable" — the engine renders
in ONE canvas (the render window); no current surface shows multiple
live-engine panels, so the mode is engine-global. The explorer/QA
panels have their own per-panel representations already (landmarks /
overlay / rig) and are untouched.
