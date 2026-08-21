# NCA — neural cellular automata visual source (experiment)

Isolated playground for Mordvintsev-style NCAs as a VJ visual source.
Page: `nca.html` → driver `src/nca-demo.js`. Touches nothing else in the app
(no registry, no WS bridge) but reuses `core/audio.js`, so all parameters are
audio-shaped from the start.

## Engine

`hexells/` is vendored from <https://github.com/znah/hexells> @ `b36e1bd`
(Apache-2.0, see `hexells/LICENSE.txt`) — the WebGL demo behind the
"Self-Organising Textures" Distill line of work. Only local change: `twgl` /
`UPNG` resolve from npm instead of page-level globals.

- `ca.js` — the whole NCA: perception (sobel/laplacian on a hex grid) → two
  dense layers (weights in a PNG texture) → stochastic state update.
- `models.json` — 173 pretrained texture models in one weight atlas; the
  active model is a *per-cell* field (`paint(x, y, r, modelId)`), so different
  textures can grow in different regions and compete at the boundaries.

## Why this fits the VJ tool

The CA regrows anything you erase (`clearCircle`) — perturbation is free
audio-reactivity: erase splats on beat, watch it heal. Full-field `paint` +
`disturb()` = in-place morph between models, usable as a section transition.

## Promotion path (when it graduates from playground)

The param object in `nca-demo.js` mirrors a registry module's `defaults`.
To wire in: own canvas layered with `#bg`/`#fg-container` (own WebGL context,
like Butterchurn), stepped from `renderLoop()`, params via the usual
`/nca/<param>` OSC addresses.
