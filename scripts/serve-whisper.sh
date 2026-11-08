#!/usr/bin/env bash
# Local vLLM server for TRANSCRIPTION_BACKEND=local
set -euo pipefail

VENV_DIR="${LOCAL_ASR_VENV:-$HOME/.venvs/relish-vllm}"
MODEL="${LOCAL_ASR_MODEL:-openai/whisper-large-v3-turbo}"
HOST="${LOCAL_ASR_HOST:-127.0.0.1}"
PORT="${LOCAL_ASR_PORT:-8002}"
# Fixed KV cache size instead of a memory share, which vLLM miscomputes under WSL while Qwen is running
KV_CACHE_MEMORY="${LOCAL_ASR_KV_CACHE_MEMORY:-1G}"

if [[ ! -x "$VENV_DIR/bin/vllm" ]]; then
  echo "vLLM not found in $VENV_DIR" >&2
  exit 1
fi

# vLLM rejects audio longer than 600 s or larger than 25 MB by default
export VLLM_MAX_AUDIO_DECODE_DURATION_S="${VLLM_MAX_AUDIO_DECODE_DURATION_S:-3600}"
export VLLM_MAX_AUDIO_CLIP_FILESIZE_MB="${VLLM_MAX_AUDIO_CLIP_FILESIZE_MB:-200}"
# FlashInfer's sampler needs nvcc to JIT-compile its kernels
export VLLM_USE_FLASHINFER_SAMPLER="${VLLM_USE_FLASHINFER_SAMPLER:-0}"

exec "$VENV_DIR/bin/vllm" serve "$MODEL" \
  --host "$HOST" \
  --port "$PORT" \
  --kv-cache-memory-bytes "$KV_CACHE_MEMORY" \
  --seed 0 \
  "$@"
