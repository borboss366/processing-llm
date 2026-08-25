# processing-llm — browser VJ tool

Two-window browser VJ rig: Butterchurn background + hot-loaded p5 foreground
modules, steered live by audio features and a local LLM "director"
(qwen3:8b via Ollama) that picks presets and colour filters as the music
changes.

## Running a set

Prerequisites:

- Node 22+, `npm install` in both the repo root and `web/app/`.
- [Ollama](https://ollama.com) running locally with the director model pulled:
  `ollama pull qwen3:8b` (override host via `OLLAMA_HOST=host:port`).
- An audio input that carries the music. For DJ output on the same machine use
  a loopback device (macOS: [BlackHole](https://existential.audio/blackhole/),
  route system/DJ audio → BlackHole, pick it as mic); with an external mixer
  any line-in works. The render window asks for mic permission on first click.

Start:

```sh
npm run server            # controller server on :3000 (REST + WS bridge)
cd web/app && npm run dev # Vite on :5173
```

Then open two windows:

- **http://localhost:5173/** — render window. Full-screen output; click once
  to grant audio, put it on the projector/second screen. No controls.
- **http://localhost:5173/controller.html** — controller. Pad grid
  (keyboard/MIDI) for triggering modules, module list, pad-mapping editor,
  preset prev/next, and the Auto-Director panel (start it, set max
  complexity; it calls the LLM when the audio character shifts).

Both windows talk through the server's WS bridge, so they can run on
different machines if the server is reachable.

Authoring a new module (offline, not part of the live path):

```sh
npm run modgen -- --id comet-trail "a comet with a fading particle trail that pulses on bass"
```

writes `web/app/loaded-modules/<id>.js` (contract: `web/app/MODULE_ABI.md`)
and hot-loads it into a running server.

### Bench (observer surface)

**http://localhost:5173/bench.html** — read-only instruments over the
live render state, for judging by ear and eye. Nothing on it controls
anything. From top:

- **Beat instrument** — the centerpiece is the *click track* (toggle +
  volume): WebAudio blips scheduled at predicted beats, downbeats pitched
  higher; if the clicks sit on the music, the PLL is locked. BPM readout
  with a 60 s sparkline, confidence gauge (green ≥ 0.4), bar dots
  1-2-3-4, and the onset-vs-grid strip: every detected onset plotted at
  its signed phase error (±0.5 beat) over the last 30 s — a tight cluster
  on the zero line means locked, a cluster at ±0.5 means the lock is
  off-beat or octave-wrong. Hold focus and tap SPACE on beats: your taps
  land on the same strip in yellow with a running median offset.
- **Audio strip** — 8 band bars, RMS, flux sparkline, centroid, and the
  energy z-score with the FSM's −0.5 / 0.5 / 1.5 thresholds drawn.
- **Creature strip** — FSM state, active move, move-local phase wheel
  (spokes at the table's key phases), a 60 s state/move ribbon, blend
  flag, and the joint-target-speed sparkline with red spike flags (same
  metric the harnesses gate on).
- **Decision log** — scrolling tail of session events: state and move
  changes, director picks and commits, move-table hot-pushes and errors.

### Authoring a move (workbench)

1. Load + trigger the creature; open the controller's **Move Workbench**.
2. Pick the move in the selector (forces it regardless of FSM state).
3. Hit **Manual** — the move clock freezes, procedural sway/bounce hold.
4. Drag the scrub slider to the key phase you care about.
5. Edit `web/app/moves/<name>.json` in your editor and save.
6. The table hot-applies in place (blend-smoothed); parse errors show in
   the director log and the creature keeps the last good table.
7. Re-scrub to check each key pose; repeat edit/save as needed.
8. **Play from here** — live clock resumes at the scrubbed phase, no snap.
9. Watch a few loops against music; go back to Manual any time.
10. Done: clear the forced move (selector → "(auto by state)").

### Audience pipeline (draw-a-dancer)

A third process owns everything phone-facing — nothing from a phone ever
reaches the render path except a server-re-encoded mask that passed the
approve queue:

```sh
npm run submit            # submission service on :3210, prints event URL + token
```

The boot log prints `http://<lan-ip>:3210/e/<token>` — the phone drawing
page. The controller's **Audience** panel shows pending submissions to
approve/reject; approved ones get a Perform button (the creature hot-swaps
to the drawn shape) and "Show QR on stage" triggers the `qr-overlay`
module. Phones on the same Wi-Fi can use the LAN URL directly. For
audience on cellular, expose port 3210 with either:

```sh
cloudflared tunnel --url http://localhost:3210          # ad-hoc Cloudflare tunnel
tailscale funnel 3210                                   # Tailscale funnel
```

then restart the service with `BASE_URL=https://<public-host> npm run
submit` so the printed URL and the QR encode the public address. (No
tunnel automation — start it yourself, copy the hostname.)

## Architecture

```mermaid
flowchart LR
  subgraph RENDER["Render window — localhost:5173/"]
    AUDIO["core/audio.js<br/>features + beat PLL<br/>(beatPhase, confidence)"]
    BC["Butterchurn canvas<br/>(background)"]
    SHADE["creature shade layer<br/>(WebGL2 metaball)"]
    REG["p5 + core/registry.js<br/>loaded-modules/*"]
    COMP["core/compositor.js<br/>bloom + post + framing<br/>(single WebGL2 output)"]
    COMMIT["bar-quantized<br/>pick commit"]
    AUDIO -- "audio.state" --> REG
    AUDIO -- "audio.state" --> SHADE
    AUDIO -- "beat/level" --> COMP
    BC --> COMP
    SHADE --> COMP
    REG --> COMP
    COMMIT --> BC
  end

  subgraph CTRL["Controller window — /controller.html"]
    DET["change detector<br/>(profile distance, hysteresis,<br/>min-hold)"]
    PADS["pad grid + mapping"]
  end

  subgraph SERVER["Node server :3000 — src/"]
    WSR["WS relay /ws"]
    REST["REST: browser-modules,<br/>osc, mappings, music, loaded"]
    DIRR["/director route"]
    SESSR["/session/append"]
  end

  DCORE["src/director/director.ts<br/>stable prefix + tail,<br/>prefilter, parse"]
  OLLAMA["Ollama<br/>qwen3:8b"]
  SESS[("sessions/*.jsonl")]
  SHAPES[("web/app/shapes/<br/>*.png + *.json")]
  MOVES[("web/app/moves/<br/>*.json move tables")]

  subgraph SUBMIT["Submission service :3210 — services/submit/"]
    PHONE["phone page /e/&lt;token&gt;<br/>(draw + palette)"]
    VALID["validate + re-encode<br/>256×256 mask"]
    SPOOLD[("spool/&lt;event&gt;/<br/>pending | approved")]
    PHONE --> VALID --> SPOOLD
  end
  PHONES(["audience phones<br/>(QR → cellular/LAN)"]) --> PHONE
  SPOOLD -- "queue / moderate" --> CTRL
  SPOOLD -- "approved only:<br/>audience:&lt;id&gt; shapes + QR" --> REG
  PRESETS[("web/app/<br/>preset-descriptions/*.md")]

  AUDIO -- "render-state (WS, 10 Hz)" --> WSR --> DET
  DET -- "POST /director" --> DIRR --> DCORE --> OLLAMA
  DIRR -- "pick / hold" --> DET
  DET -- "apply-pick (WS)" --> WSR
  WSR -- "commit at bar wrap" --> COMMIT
  DET -- "decisions, holds, commits" --> SESSR --> SESS
  PADS --> REST
  SHAPES -- "fetch + sample" --> REG
  MOVES -- "fetch + interpolate" --> REG
  PRESETS -- "catalogue (memoized)" --> DCORE

  subgraph TOOLS["tools/ — offline (never in the live path)"]
    VERIFY["verify.mjs<br/>fast/full check runner"]
    REPLAY["replay.mjs<br/>seeded director A/B"]
    BEAT["beat-test*.mjs<br/>PLL harnesses"]
    CAP["capture-creature.mjs"]
    MODGEN["modgen/gen.mjs"]
  end

  SESS --> REPLAY --> DCORE
  BEAT -. "headless Chrome" .-> RENDER
  CAP -. "headless Chrome" .-> RENDER
  MODGEN -- "writes" --> REG
  MODGEN --> OLLAMA
```

The live path (render + controller + server) stays boring; everything slow
or failure-prone lives in `tools/`. This diagram is kept current by rule —
see `CLAUDE.md`.

## Layout

- `src/` — Node controller server (`npm run server`,
  `src/controller/server.ts`): serves `/loaded/*` modules, module
  load/unload/trigger/enable REST, pad-mapping persistence, WS relay between
  windows, and the `/director` LLM route.
- `web/app/src/core/` — the live browser engine: `audio.js` (feature
  extraction: bands, spectral shape, BPM), `butterchurn.js` (background),
  `registry.js` + `interfaces.js` (module runtime + lifecycle middleware —
  ABI in `web/app/MODULE_ABI.md`), `pads.js`, `mapping.js`, `ws.js`.
- `web/app/loaded-modules/` — hot-loadable p5 foreground modules.
- `web/app/preset-descriptions/` — one .md per Butterchurn preset (tagged
  frontmatter + prose); this is the catalogue the director chooses from.
  Generated/refreshed by `web/app/scripts/visual-bootstrap.mjs` +
  `bootstrap-preset-descriptions.mjs` (offline, puppeteer +
  `preset-snap.html` + a vision model).
- `src/director/` — director core shared by the live route and offline
  replay: pure prompt construction (`buildDirectorPrompt`, with a `memory`
  variant that shows the model its last N picks), catalogue prefilter,
  response parsing, Ollama call.
- `tools/` — offline authoring/evaluation CLIs: `modgen/gen.mjs`,
  `replay.mjs`, `beat-test.mjs` / `beat-test-real.mjs` (beat-tracker
  harnesses), `capture-creature.mjs`, `wav-tempo.mjs`, `check-modules.mjs`,
  and `verify.mjs` — the umbrella runner (`node tools/verify.mjs` for the
  fast tier, `--full` for everything; needs server+vite+Ollama up for the
  full tier).
- `sessions/` (gitignored) — one .jsonl per Auto-Director run: every director
  decision (feature window, request, raw LLM response, pick, latency), hold
  tick, and operator action.

## Evaluating the director

Run a set with Auto-Director on — everything is recorded automatically. Then
re-run the recorded feature windows through any prompt variant with no audio:

```sh
node tools/replay.mjs sessions/<file>.jsonl --prompt-variant memory     # live default
node tools/replay.mjs sessions/<file>.jsonl --prompt-variant no-memory  # pre-memory prompt
# knobs: --history-n N  --catalogue-window N  --model <ollama model>
#        --seed N (pins candidate sampling + generation: fair A/B comparisons)
```

prints a table of original pick vs. new pick per window. Replay accumulates
its own recency/memory, so the table shows what the whole set would have
looked like under that variant. Requires Ollama running.

## Experimental

- `web/app/nca.html` + `web/app/src/nca/` — neural-cellular-automata visual
  source (vendored Hexells). Isolated from the live engine; see
  `web/app/src/nca/README.md` for status and the promotion path.
- `web/app/preset-snap.html` — headless Butterchurn driver used only by the
  preset-description bootstrap scripts, never during a set.
