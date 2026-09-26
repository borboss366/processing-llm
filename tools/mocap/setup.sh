#!/usr/bin/env bash
# One-time setup for the mocap extraction pipeline (brief 16).
# Creates tools/mocap/.venv (gitignored) with pinned deps and downloads the
# pinned pose model. Idempotent — safe to rerun.
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
MODEL_URL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task"

if [ ! -d .venv ]; then
  "$PY" -m venv .venv
fi
./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet -r requirements.txt

mkdir -p models
if [ ! -f models/pose_landmarker_heavy.task ]; then
  curl -fsSL -o models/pose_landmarker_heavy.task "$MODEL_URL"
fi
shasum -a 256 models/pose_landmarker_heavy.task
./.venv/bin/python -c "import mediapipe, cv2, numpy; print('mediapipe', mediapipe.__version__, '· cv2', cv2.__version__, '· numpy', numpy.__version__)"

# 18.1 --check: which estimators are runnable
if [ "${1:-}" = "--check" ]; then
  ./.venv/bin/python - <<'PY'
ok = []
try:
    import mediapipe; ok.append(f"mediapipe {mediapipe.__version__}")
except Exception as e: print("mediapipe: NOT runnable:", e)
try:
    import onnxruntime
    from rtmlib import Wholebody
    from importlib.metadata import version
    ok.append(f"rtmpose (rtmlib {version('rtmlib')}, onnxruntime {onnxruntime.__version__})")
except Exception as e: print("rtmpose: NOT runnable:", e)
print("runnable estimators:", ", ".join(ok) if ok else "NONE")
PY
fi
echo "[mocap/setup] OK"
