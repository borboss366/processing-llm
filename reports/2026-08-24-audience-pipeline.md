# Brief 11 — audience pipeline (draw-a-dancer)

Date: 2026-08-24. New process: `services/submit/` (`npm run submit`,
port 3210). Architecture rule held: the phone-facing service is the only
thing a phone ever talks to; the render/controller side reads only
`/submit-api/api/approved/*` (vite-proxied) plus the queue/moderate
endpoints; every stage file is a server-re-encoded 256×256 mask +
template sidecar that passed validation AND operator approval.

## Task 1 — submission service

`services/submit/server.ts` (TypeScript, zod-validated boundary):

- `POST /api/submit` { png dataURL, palette hexes, token }: 128 KB
  payload cap (413), 20/min/IP sliding-window rate limit (429), token
  must match the event (403).
- Sanitization: PNG decoded and re-encoded to a 256×256 white-on-black
  mask (box-average + 50% threshold) — metadata gone, nothing but a
  silhouette survives. Palette clamped to `#rrggbb` and converted to
  hues (the render palette system is hue-based — a deviation worth
  knowing: the picked colours' saturation/lightness are not preserved).
  Nothing else from the payload is retained.
- Validation with human-readable reasons: ink coverage 8–60%
  ("draw bigger" / "too much ink"), largest connected component ≥95% of
  ink (same invariant as the creature build), every template joint
  inside ink with its pin disc ≥60% covered.
- Spool on disk: `spool/<event>/{pending,approved,rejected}/<id>.png+.json`
  (gitignored). `GET /api/queue` 2 s poll, `POST /api/moderate`
  loopback-only, `GET /api/approved/:id.*` — the only render-facing
  files. Boot prints the event token + phone URL; `GET /api/qr.png` is a
  server-generated QR of `BASE_URL/e/<token>` (no phone-side QR lib).

## Task 2 — phone page

`/e/<token>`, single self-contained HTML (~11 KB, far under the 150 KB
cap), viewport locked, `touch-action: none` on the canvas. Ghost
underlay drawn from `/api/template` = the render side's actual
`web/app/shapes/biped-front.json` (single source of truth — every
submission reuses its fixed skeleton). Brush/eraser/undo(20)/clear, two
brush sizes, three-role swatch picker with preview blob, submit →
success screen or the server's rejection reason with the drawing
preserved.

## Task 3 — approve queue + stage list

Controller gains an **Audience** panel: 2 s queue poll, pending
thumbnail grid with ✓/✗ (auto-scrolls on new arrivals), stage list of
approved shapes with Perform + "next up" toggle. Perform loads the
creature, sets `shape audience:<id>` and triggers — the module hot-swap
(new `swapEnv` fade, 0.9 s out/in) replaces the body without reload.
`audience-shape` events (approve/reject/perform/panic/qr-shown) go to
the session stream. **Deviation**: the brief said the "existing
safe-scene/blackout" must clear audience shapes — no such thing existed
in the repo (mapping default is null, no panic code anywhere), so the
panel ships the minimal one the brief assumes: Panic = background off +
creature back to `biped-1` + idle, logged.

## Task 4 — QR on stage

`loaded-modules/qr-overlay.js`: triggerable card (white plate, QR,
"draw yourself into the show"), corner/size params, auto-hides after
`qrShowSec` (self-fade inside the 15 s lifecycle hold). Pad-mappable
like any triggerable; the controller panel has a Show-QR button.
README documents the two tunnel one-liners (cloudflared / tailscale
funnel) + `BASE_URL` for the QR; no tunnel automation.

## Task 5 — E2E + soak

`tools/audience-e2e.mjs` (in `verify --full`): spawns an ISOLATED
service (own port/token/tmp spool), drives the real phone page headless
with canvas ops. All verdicts asserted green:

| case | result |
|---|---|
| good drawing (capsules over template bones) | accepted → pending |
| disconnected (separate island >5% ink) | "disconnected pieces" |
| tiny (5% coverage) | "draw bigger" |
| torso-only (hands/feet uncovered) | "ghost figure" |
| 140 KB payload | 413 |
| wrong token | 403 |
| hammering | 429 within the minute |
| moderation | approve → served from approved/, reject → rejected/ |

`tools/audience-soak.mjs`: submits a synthetic drawing, approves,
**performs it** — the audience creature builds (597 nodes,
~2.0 ms/frame) and dances over Butterchurn (`reports/audience-stage.png`)
— then fires 50 scripted submissions over 10 min while the set plays,
sampling the module's frame cost throughout.

Soak result: **50/50 accepted, 0 lost, 0 rate-limited** (5/min stays
under the 20/min cap); creature frame cost flat throughout — mean
**1.59 ms/frame during the soak vs 1.95 ms baseline** (all ten samples
1.58–1.59 ms; the submission service is a separate process, so the only
possible coupling is CPU contention, and none showed). Frame budget
unaffected: PASS.

UI evidence: `reports/audience-panel.png` (54 pending thumbnails with
✓/✗ moderation + stage list), `reports/audience-qr.png` (QR card over
Butterchurn). One module-contract bug caught by the visual check:
`ctx.state` is not pre-created for modules (MODULE_ABI documents this);
qr-overlay's first version destructured it and threw every frame —
fixed with `ctx.state ??= {}`.

## Gate (STOP)

The scripted half of the gate is done (stage still above). The
remaining half needs the user: draw on a real phone (`npm run submit`,
scan the printed URL/QR), approve it in the controller's Audience
panel, Perform, and judge the 30 s on the real GPU. The report wants a
photo-of-phone → stage still pair — user-supplied.

Out of scope kept out: multi-creature, text display, photo input,
per-submission skeletons, auto-moderation, tunnel automation, move
timing (user notes still pending).
