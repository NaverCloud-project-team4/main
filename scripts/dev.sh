#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .venv/bin/python ]]; then
  printf '먼저 README의 의존성 설치 단계를 실행해주세요.\n' >&2
  exit 1
fi
export PYTHONPATH="$PWD/backend${PYTHONPATH:+:$PYTHONPATH}"
PYTHON="$PWD/.venv/bin/python"
NODE="${NODE_EXECUTABLE:-$(command -v node || true)}"
if [[ -z "$NODE" && -x "${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  NODE="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ -z "$NODE" || ! -f frontend/node_modules/vite/bin/vite.js ]]; then
  printf 'Node.js와 프론트 의존성을 먼저 설치해주세요.\n' >&2
  exit 1
fi
"$PYTHON" -m app.cli init --demo
pids=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM
"$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2 --no-access-log &
pids+=("$!")
"$PYTHON" -m app.worker &
pids+=("$!")
(cd frontend && "$NODE" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort) &
pids+=("$!")
printf '\n화면: http://127.0.0.1:5173\nAPI: http://127.0.0.1:8000/docs\nCtrl+C로 종료합니다.\n\n'
# Exit if any child fails; cleanup stops the remaining processes (macOS Bash compatible).
while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      printf '개발 프로세스 하나가 종료되어 나머지도 정리합니다.\n' >&2
      exit 1
    fi
  done
  sleep 1
done
