# processing-llm — brief 11: audience pipeline (draw-a-dancer)

Goal: a person at the party scans a QR, draws a silhouette on their
phone, picks three colours, submits — and after the operator taps
Approve, their creature walks on stage and dances. This is the project's
differentiator; build it as boringly as possible.

Architecture rule (non-negotiable): a SEPARATE small service owns
everything phone-facing. Nothing from a phone ever touches the live
render path except as a validated file that passed the approve queue.
The controller/render side only ever reads approved shape files.

## Task 1 — Submission service (`services/submit/`)

Own process, own port, one deployable that also serves the phone page.
- `POST /api/submit`: accepts { png (dataURL), palette {primary,
  secondary, accent}, event token }. Hard limits: ≤ 128 KB payload,
  ≤ 20 submissions/min/IP (429 beyond), token must match the running
  event (start script prints a fresh token; the QR encodes it).
- Server-side sanitization: decode + re-encode the PNG to a 256×256
  grayscale mask (threshold 50%) — strips metadata, kills anything that
  isn't a silhouette. Palette values clamped to hex colours. NOTHING
  else from the payload is retained. No names, no free text in v1.
- Validation before accepting (reject with a human-readable reason the
  phone page shows):
  1. Ink coverage 8–60% of the canvas (else "draw bigger" / "too much").
  2. Connectivity: largest connected component ≥ 95% of ink (else "your
     drawing has disconnected pieces — connect them or they won't
     move"). Same invariant as the build-time check, computed on the
     mask directly.
  3. Joint coverage: every joint of the TEMPLATE skeleton (see Task 2)
     falls inside ink, with its pin disc ≥ 60% covered (else "keep your
     drawing over the ghost figure — the marked joints are outside").
- Accepted submissions land in `spool/<event>/<id>.png` + `.json`
  (template sidecar + palette + received-at). Spool is disk, no DB.
- `GET /api/queue` (long-poll or 2 s poll) for the controller: pending /
  approved / rejected ids + thumbnails. `POST /api/moderate`
  { id, verdict } from the controller only (localhost or shared secret).

## Task 2 — Phone drawing page

Served at `/e/<token>`. Mobile-first, works over cellular, no login.
- Canvas with the biped-front TEMPLATE as a ghost underlay: faint
  A-pose figure + joint dots. The audience draws the FLESH; the
  skeleton is fixed. This is the core simplification: every submission
  reuses `biped-front.json` joints — only the PNG and palette vary.
- Tools: one brush (chunky, pressure-independent), eraser, undo, clear,
  brush size (2 sizes are enough). Draw with finger; no pinch-zoom
  fights (lock viewport).
- Three-swatch palette picker (primary/secondary/accent) with a default
  set; live preview chip showing their colours on a sample blob.
- Submit → server validation → success screen ("waiting for the VJ") or
  the validation reason with the drawing preserved for fixing.
- Keep the page under ~150 KB total; no framework needed.

## Task 3 — Approve queue in the controller UI

- New panel: thumbnail grid of pending submissions (poll Task 1's
  queue), Approve / Reject per item, auto-scroll to newest.
- Approved → the service moves the pair to `approved/`; the controller
  gains a "stage list": approved shapes in order, each with a "Perform"
  button and a "next up" toggle.
- Perform: the render window's creature module hot-swaps to the shape
  via the existing exiting → entering fade (no reload). One creature at
  a time in v1. Log `audience-shape` events to the session stream.
- Panic: the existing safe-scene/blackout must also clear the current
  audience shape.

## Task 4 — QR on stage

A minimal fg overlay (p5 module or compositor overlay): the event QR +
"draw yourself into the show" line, pad-triggerable, auto-hides after
`qrShowSec`. QR encodes `BASE_URL/e/<token>`; BASE_URL is config —
document in the README the two operator options (cloudflared tunnel /
tailscale funnel) with the one-liner for each. Do not build tunnel
automation.

## Task 5 — E2E + gate

- Headless E2E: script draws a plausible blob-with-limbs on the phone
  page (canvas ops), submits, asserts validation verdicts for: good
  drawing, disconnected drawing, tiny drawing, joints-uncovered drawing,
  oversize payload, bad token, rate-limit trip.
- Soak: 50 scripted submissions while a 10-min set runs; live path
  frame budget unaffected (measure).
- Gate capture: a real drawing made by the user on an actual phone,
  approved in the UI, performing for 30 s over Butterchurn. STOP for
  judgment. Report includes a photo-of-phone → stage still pair.

Out of scope: multiple simultaneous creatures, names/text display, face
or photo inputs, per-submission skeletons, auto-moderation models,
tunnel automation, move timing (user notes still pending).
