#!/usr/bin/env bash
# Rebuild EVERY captured stage table from its clip, same constants for all
# (17.6 generality guard: an extractor/stitch change re-runs the whole set).
# Flags come from docs/MOTION_SOURCES.md through `npm run capture` where the
# clip has a line there; the rest are the clip's explicit windows.
#
#   bash tools/mocap/rebuild-captured.sh > rebuild.log 2>&1
#
# Known: running_man_4 is extracted from the running_man_3 video with the
# same window (no running_man_4 video in corpus/) — a duplicate, kept as is.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "=== runningman"
npm run -s capture -- corpus/runningman.mp4 --name runningman --bpl 2 --no-open
node tools/mocap/stitch.mjs corpus/runningman.move.json --name runningman-captured-x \
  --exag-map web/app/shapes/biped-profile.json --out web/app/moves/runningman-captured-x.json

echo "=== tstep (two real halves, stitched)"
node tools/mocap/extract.mjs corpus/shuffle-h264.mp4 --loop-window 2.3-4.767 --bpl 2 \
  --name tstep-cap-L --out corpus/tstep-L --explorer-json
node tools/mocap/extract.mjs corpus/shuffle-h264.mp4 --loop-window 4.767-6.967 --bpl 2 \
  --name tstep-cap-R --out corpus/tstep-R --explorer-json
node tools/mocap/stitch.mjs corpus/tstep-L.move.json corpus/tstep-R.move.json --name tstep-captured
node tools/mocap/stitch.mjs corpus/tstep-L.move.json corpus/tstep-R.move.json --name tstep-captured-x \
  --exag-map web/app/shapes/biped-1.json

echo "=== kick"
npm run -s capture -- corpus/kicks_combined-h264.mp4 --name basic_kick_1 --no-open

echo "=== running_man_3"
npm run -s capture -- corpus/running_man_3-h264.mp4 --name running_man_3 --no-open

echo "=== running_man_4 (duplicate of running_man_3, see header)"
npm run -s capture -- corpus/running_man_3-h264.mp4 --name running_man_4 \
  --window 2.335-6.873 --cycles 4 --bpl 2 --no-open

echo "=== bodyroll"
node tools/mocap/extract.mjs corpus/bodyroll.mp4 --loop-window 8.5-14.5 --cycles 4 --bpl 2 \
  --emit-views profile,front --name bodyroll-captured --out corpus/bodyroll --explorer-json
node tools/mocap/stitch.mjs corpus/bodyroll.move.json --name bodyroll-captured \
  --out web/app/moves/bodyroll-captured.json

echo "=== DONE"
