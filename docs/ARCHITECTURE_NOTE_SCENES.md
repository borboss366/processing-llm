# Architecture note: organizing 5+ scenes

Status: FUTURE reference, written 2026-08-23. Not a brief. Do not implement
until the trigger conditions at the bottom are met. Context: target end
state is a set built from multiple scene types (milkdrop, creature, fluid,
attractors, physics toys, curated generative modules), music-driven,
switchable, customizable, with optional text/photo input.

## Core separation: engines / scenes / vocabulary

Three kinds of thing, currently blurred, that must become distinct:

- **Engine** — code owning a render/sim loop: butterchurn, fluid sim,
  creature, attractor, physics toy, the p5 module host.
- **Scene** — data: a named composition declaring which engines are active,
  on which layers, with what params, palette, behavior, and director hints.
  JSON files. Adding a look = authoring a file, not programming.
- **Director vocabulary** — the schema of what the LLM may output:
  `{scene, params, palette, hold}`. GENERATED from scene + param
  definitions. Never hand-written a second time.

The same scene/param definitions feed: director catalogue, controller UI,
session logging, replay validation.

## Target layout

    web/app/src/
      core/        audio.js, layers.js, params.js, scheduler.js, session.js
      engines/
        butterchurn/  fluid/  creature/  attractor/  physics/  p5host/
      scenes/      *.json     # compositions incl. per-scene director hints
      director/    schema.js, prompt.js   # built FROM scenes + params
    tools/         capture, replay, modgen, bootstrap

## The two abstractions to build deliberately

**Layer manager (`core/layers.js`).** Named layers, z-ordered, each owned
by one engine instance; per-layer opacity/filter/blend tweened by the
compositor. Scene switches = layer crossfades on a bar boundary.
"Background yields to creature" = a scene property, not bespoke plumbing.
The CSS gooey filter becomes a per-layer filter, not a special case.

**Param registry (`core/params.js`).** Every engine declares params once:
name, range, default, curve, one-line description. Derived from this single
source: controller UI sliders, `osc()` addresses, director JSON schema
(description doubles as LLM documentation), session logging, replay
validation. Params declared in five places = director emits values nothing
validates.

## Engine contract (thin)

    init(layer, services)   // services: audio state, palette, seed, logger
    setParams(patch)        // validated against the registry
    enter(fadeMs) / exit(fadeMs)
    tick(dt)
    capture()?              // optional, for tools

Services are injected, never imported — engines stay headless-testable.

Existing content formats survive INSIDE engines: the p5 module ABI is the
internal format of `p5host`; butterchurn keeps presets; creature keeps
shapes. Scene files reference content by id. Modules are content, not
peers of engines.

## Loading and state

- One Vite app; engines behind dynamic `import()`; scheduler preloads the
  next scene's engines during the current one.
- One store for "what is playing now" (scene id, params, layer states),
  mutated ONLY via the same message types the WS relay carries. Controller
  UI, director, and replay are then just different producers of identical
  messages — preserves record/replay for everything.

## Scene roadmap (agreed priorities)

1. Creature locomotion gate (current work) — finish first.
2. Scene schema + director vocabulary change (preset-picker → scene-picker).
3. Fluid (Stam stable fluids, WebGL; audio-driven splats; doubles as an
   alternative BACKGROUND layer to butterchurn). Biggest look-per-effort.
4. Attractors (Lorenz/Aizawa particle flows) — cheapest win.
5. Physics toys (matter.js/planck.js; collisions are events → couple to
   beats well).
6. Un-park modgen with a curation gate (generate offline → screenshot →
   keep/tag → director picks). Same workflow as preset curation.
- Text input: another prompt field in the director. Photo input: palette
  extraction first; later NCA growth targets ("grow this photo").
- Unreal hero scene: CUT. Second project in a bullet point (new engine,
  asset/rigging pipeline, capture path, OSC bridge, build system; nothing
  shared). The 80% version = current creature in a three.js scene with an
  orbiting camera + depth fog, as creature v2, only after the 2D creature
  is judged good.

## Triggers — do NOT refactor before these

- Extract the layer manager when the SECOND background engine (fluid)
  lands — the abstraction then has two real customers.
- Extract the param registry when the director first controls a
  non-butterchurn engine.
- Move creature from `loaded-modules/` to `engines/` at that same moment,
  not before.

Doing this today, with one background and one creature, is
frameworks-before-frames wearing an architecture diagram. The current
structure is not what blocks the locomotion gate.
