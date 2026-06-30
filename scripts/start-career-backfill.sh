#!/usr/bin/env bash
# Launch all career backfill shards with stagger; keep this process alive until they finish.
# Run inside screen/tmux so the session survives terminal disconnects:
#   screen -dmS career-backfill bash -c 'cd /path/to/NCAAD1Scraper && bash scripts/start-career-backfill.sh >> logs/career/launcher.log 2>&1'
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs/career

SHARDS="${CAREER_SHARDS:-4}"
STAGGER_SEC="${CAREER_STAGGER_SEC:-120}"
RESTART_SEC="${CAREER_RESTART_SEC:-300}"

run_shard() {
  local shard_index="$1"
  local log="logs/career/shard-${shard_index}.log"
  while true; do
    echo "[shard-${shard_index}] starting $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${log}"
    set +e
    caffeinate -i node dist/career/index.js --backfill --shard "${shard_index}/${SHARDS}" --resume ${CAREER_EXTRA_FLAGS:-} >> "${log}" 2>&1
    local exit_code=$?
    set -e
    if (( exit_code == 0 )); then
      echo "[shard-${shard_index}] completed $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${log}"
      return 0
    fi
    echo "[shard-${shard_index}] exited ${exit_code}, restarting in ${RESTART_SEC}s $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${log}"
    sleep "${RESTART_SEC}"
  done
}

echo "[launcher] Starting ${SHARDS} career backfill shard(s) with ${STAGGER_SEC}s stagger"
echo "[launcher] Queue: usbasket-global-player-ids.cache.json"
echo "[launcher] Flags: --backfill --resume ${CAREER_EXTRA_FLAGS:-}"

pids=()
for ((i = 0; i < SHARDS; i++)); do
  echo "[launcher] shard ${i}/${SHARDS} → logs/career/shard-${i}.log"
  run_shard "${i}" &
  pids+=($!)
  echo "[launcher]   supervisor pid $!"
  if (( i < SHARDS - 1 )); then
    sleep "${STAGGER_SEC}"
  fi
done

echo "[launcher] All shard supervisors running. Waiting for completion..."
for pid in "${pids[@]}"; do
  wait "${pid}" || echo "[launcher] supervisor pid ${pid} exited non-zero"
done
echo "[launcher] All shards finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
