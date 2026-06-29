#!/usr/bin/env bash
# Launch all discovery shards with stagger to avoid usbasket rate limits / device caps.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs/discovery

SHARDS="${DISCOVERY_SHARDS:-4}"
STAGGER_SEC="${DISCOVERY_STAGGER_SEC:-120}"

echo "[launcher] Starting ${SHARDS} discovery shard(s) with ${STAGGER_SEC}s stagger"
echo "[launcher] Flags: --include-eurobasket --resume"

for ((i = 0; i < SHARDS; i++)); do
  log="logs/discovery/shard-${i}.log"
  echo "[launcher] shard ${i}/${SHARDS} → ${log}"
  nohup node dist/discover/index.js --include-eurobasket --shard "${i}/${SHARDS}" --resume >> "${log}" 2>&1 &
  echo "[launcher]   pid $!"
  if (( i < SHARDS - 1 )); then
    sleep "${STAGGER_SEC}"
  fi
done

echo "[launcher] All shards launched. Monitor: tail -f logs/discovery/shard-0.log"
