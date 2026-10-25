#!/usr/bin/env bash
# Local vLLM server for VIDEO_ANALYSIS_BACKEND=qwen3vl
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VENV_DIR="${QWEN_VL_VENV:-$HOME/.venvs/relish-vllm}"
MODEL="${QWEN_VL_MODEL:-Qwen/Qwen3-VL-8B-Instruct}"
HOST="${QWEN_VL_HOST:-127.0.0.1}"
PORT="${QWEN_VL_PORT:-8001}"
MAX_MODEL_LEN="${QWEN_VL_MAX_MODEL_LEN:-32768}"
GPU_MEMORY_UTILIZATION="${QWEN_VL_GPU_MEMORY_UTILIZATION:-0.85}"
MEDIA_DIR="${QWEN_VL_MEDIA_DIR:-$REPO_DIR/tmp}"

if [[ ! -x "$VENV_DIR/bin/vllm" ]]; then
  echo "vLLM not found in $VENV_DIR" >&2
  exit 1
fi

mkdir -p "$MEDIA_DIR"
MEDIA_DIR="$(cd "$MEDIA_DIR" && pwd -P)"

# FlashInfer's sampler needs nvcc to JIT-compile its kernels
export VLLM_USE_FLASHINFER_SAMPLER="${VLLM_USE_FLASHINFER_SAMPLER:-0}"

exec "$VENV_DIR/bin/vllm" serve "$MODEL" \
  --host "$HOST" \
  --port "$PORT" \
  --max-model-len "$MAX_MODEL_LEN" \
  --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION" \
  --limit-mm-per-prompt '{"image": 0, "video": 1}' \
  --allowed-local-media-path "$MEDIA_DIR" \
  --media-io-kwargs '{"video": {"backend": "torchcodec"}}' \
  --trust-request-mm-kwargs \
  --seed 0 \
  "$@"
