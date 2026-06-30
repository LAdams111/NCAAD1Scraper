#!/usr/bin/env bash
# Supplement pass: scan completed tasks for paginated index pages (page 2+ only).
set -euo pipefail
cd "$(dirname "$0")/.."
export DISCOVERY_EXTRA_FLAGS="--supplement-pagination"
exec bash scripts/start-global-discovery.sh
