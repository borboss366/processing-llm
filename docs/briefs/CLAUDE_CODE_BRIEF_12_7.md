# processing-llm — brief 12.7: puppet page (creature workshop)

The main controller is the operator surface and has accumulated panels;
creature testing needs its own page. Build `puppet.html`: everything
about one dancing figure on one screen, nothing else. CLAUDE.md rules.

## Task 1 — the page

Served like controller/bench, talking over the same WS relay + params
route. Dark, one screen, legible from a metre.

1. **Cast & state**: shape selector (shapes/ + approved audience spool),
   Enter / Exit (through the normal fades), behavior force
   (auto | idle | walk | groove | hop), and the MOVE RIG: move selector,
   Manual toggle, scrub slider, Play-from-here — relocated from the
   main controller (Task 2 removes it there).
2. **Knobs**: the creature module's params rendered as controls,
   AUTO-ENUMERATED from the module (add a `GET /module-params/<id>`
   or WS equivalent exposing name/type/range/value for its osc params —
   do not hand-build the list). Sliders write through the existing param
   path; current values live-reflected. Palette: three swatch pickers
   writing the palette params.
3. **Live truth**: factor the bench's creature widgets (state/move
   readout, phase wheel with key-phase spokes, state ribbon,
   joint-speed sparkline + spike flags) into a shared module
   (`src/bench-widgets.js`) consumed by BOTH bench.html and puppet.html.
   No duplicated widget code.
4. **Snapshot**: a button copying { shape, behavior, move, params,
   palette } as JSON to clipboard and appending it to the session
   stream (`puppet-snapshot`) so found-settings are recoverable.

## Task 2 — controller cleanup

Remove the Move section from the main controller (link to puppet.html
in its place). The operator page keeps: director, presets, pads,
audience queue, panic. Nothing else moves in this brief.

## Task 3 — acceptance

Headless capture: puppet page driving — shape swap, behavior force,
move force + manual scrub sweep, two param slider changes visibly
affecting the figure, snapshot event appearing in the session stream.
webm + stills; verify green; README section "puppet".

Out of scope: FK/pose-propagation work (next brief, pending the user's
scrub test), param-registry extraction (architecture trigger still
unmet — the auto-enumeration endpoint is module-local, not the
registry), bench audio strips (stay on bench.html).
