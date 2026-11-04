#!/usr/bin/env bash
# Run benchmark cases through the CLI pipeline. Usage: bash scripts/run-cases.sh <label> <case-id>...
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RUNS_DIR="${RUNS_DIR:-$HOME/relish-runs/$(date +%F)}"
# Any existing dish works, process-source only checks that it exists
DISH_ID="${DISH_ID:-6add312c0799c9cb00fb650d}"
# Pause between cases so the OpenAI tokens-per-minute window resets
PAUSE_SECONDS="${PAUSE_SECONDS:-60}"
VLLM_VENV="${VLLM_VENV:-$HOME/.venvs/relish-vllm}"
VLLM_URLS="${VLLM_URLS:-${QWEN_VL_BASE_URL:-http://127.0.0.1:8001/v1}}"

if [[ $# -lt 2 ]]; then
  echo "Usage: bash scripts/run-cases.sh <label> <case-id>..." >&2
  exit 1
fi
LABEL=$1
shift

for CASE in "$@"; do
  URL=$(python3 -c 'import json,sys; print(next(c["url"] for c in json.load(open(sys.argv[1])) if c["id"] == sys.argv[2]))' "$REPO_DIR/benchmark/dataset.json" "$CASE" 2>/dev/null) || {
    echo "Unknown case $CASE" >&2
    continue
  }
  VIDEO_ID=$(sed -E 's#.*(v=|shorts/)##' <<<"$URL")
  if [[ -e $REPO_DIR/tmp/$VIDEO_ID ]]; then
    echo "Skipping $CASE: $REPO_DIR/tmp/$VIDEO_ID already exists" >&2
    continue
  fi

  # Next free run number
  N=1
  while [[ -e $RUNS_DIR/$LABEL/$CASE/$N ]]; do N=$((N + 1)); done
  OUT=$RUNS_DIR/$LABEL/$CASE/$N
  mkdir -p "$OUT"
  echo "=== $CASE run $N ($LABEL) $URL"

  STARTED_AT=$(date -Iseconds)
  nvidia-smi --query-gpu=timestamp,utilization.gpu,memory.used,power.draw,temperature.gpu \
    --format=csv,nounits -lms 500 >"$OUT/gpu.csv" 2>/dev/null &
  GPU_PID=$!
  START=$(date +%s.%N)
  (cd "$REPO_DIR" && NO_COLOR=1 deno task cli:start source-adapters youtube process-source "$DISH_ID" "$URL" --outfile "$OUT/recipes.json") 2>&1 |
    while IFS= read -r line; do printf '%s %s\n' "$(date +%H:%M:%S.%3N)" "$line"; done | tee "$OUT/run.log"
  END=$(date +%s.%N)
  kill "$GPU_PID" 2>/dev/null
  awk -v s="$START" -v e="$END" 'BEGIN { printf "elapsed_s=%.1f\n", e - s }' >"$OUT/time.txt"
  [[ -e $REPO_DIR/tmp/$VIDEO_ID ]] && mv "$REPO_DIR/tmp/$VIDEO_ID" "$OUT/artifacts"

  VIDEO_FILE=$(find "$OUT/artifacts" -maxdepth 1 -name 'video.*' 2>/dev/null | head -1)
  VLLM_MODELS=""
  for U in ${VLLM_URLS//,/ }; do
    VLLM_MODELS+="$(curl -s --max-time 5 "$U/models" || true)"$'\n'
  done

  M_LABEL=$LABEL M_CASE=$CASE M_RUN=$N M_URL=$URL M_VIDEO_ID=$VIDEO_ID M_DISH_ID=$DISH_ID \
    M_STARTED_AT=$STARTED_AT M_FINISHED_AT=$(date -Iseconds) \
    M_ELAPSED=$(awk -v s="$START" -v e="$END" 'BEGIN { printf "%.1f", e - s }') \
    M_COMMIT=$(git -C "$REPO_DIR" rev-parse HEAD) \
    M_BRANCH=$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD) \
    M_DIRTY=$(git -C "$REPO_DIR" status --porcelain --untracked-files=no) \
    M_DENO=$(deno --version | head -1) \
    M_YTDLP=$(yt-dlp --version) \
    M_FFMPEG=$(ffmpeg -version | head -1) \
    M_VLLM=$("$VLLM_VENV/bin/python" -c 'import importlib.metadata as m; print(m.version("vllm"))' 2>/dev/null) \
    M_VLLM_MODELS=$VLLM_MODELS \
    M_GPU=$(nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>/dev/null) \
    M_VIDEO=$([[ -n $VIDEO_FILE ]] && ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,avg_frame_rate:format=duration -of json "$VIDEO_FILE") \
    python3 - "$OUT/manifest.json" <<'EOF'
import json, os, sys

e = lambda k: os.environ.get(k) or None

def parse_json(value):
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None

manifest = {
    "label": e("M_LABEL"),
    "case": e("M_CASE"),
    "run": int(e("M_RUN")),
    "url": e("M_URL"),
    "videoId": e("M_VIDEO_ID"),
    "dishId": e("M_DISH_ID"),
    "startedAt": e("M_STARTED_AT"),
    "finishedAt": e("M_FINISHED_AT"),
    "elapsedSeconds": float(e("M_ELAPSED")),
    "git": {
        "commit": e("M_COMMIT"),
        "branch": e("M_BRANCH"),
        "dirtyFiles": (e("M_DIRTY") or "").splitlines(),
    },
    # Values set in the shell; .env values and defaults are in artifacts/run-metrics.json
    "envOverrides": {
        k: v
        for k, v in sorted(os.environ.items())
        if k.endswith("_BACKEND") or k.startswith(("QWEN_", "LOCAL_"))
    },
    "versions": {
        "deno": e("M_DENO"),
        "ytDlp": e("M_YTDLP"),
        "ffmpeg": e("M_FFMPEG"),
        "vllm": e("M_VLLM"),
    },
    "vllmModels": [
        m for line in (e("M_VLLM_MODELS") or "").splitlines() if (m := parse_json(line))
    ],
    "gpu": e("M_GPU"),
    "video": parse_json(e("M_VIDEO")),
}
with open(sys.argv[1], "w") as f:
    json.dump(manifest, f, indent=2)
EOF

  cat "$OUT/time.txt"
  [[ $CASE != "${!#}" ]] && sleep "$PAUSE_SECONDS"
done
