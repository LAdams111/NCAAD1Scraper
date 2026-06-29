#!/usr/bin/env node
/**
 * Unmark name-only CCAA players (empty seasons in cache) so --resume re-fetches profiles.
 *
 * Usage:
 *   node scripts/repair-ccaa-profiles.mjs
 *   node scripts/repair-ccaa-profiles.mjs --player 723529
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_SEASON_CACHE, DEFAULT_CHECKPOINT } from "../dist/division.js";
import { loadCheckpoint, saveCheckpoint } from "../dist/scrape/checkpoint.js";
import { shardCheckpointPath } from "../dist/utils/shard.js";

function parseArgs(argv) {
  let player;
  let shardCount = 4;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--player") player = argv[++i]?.trim();
    if (argv[i] === "--shards") shardCount = Number.parseInt(argv[++i], 10);
  }
  return { player, shardCount };
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const { player, shardCount } = parseArgs(process.argv.slice(2));
const cache = loadJson(DEFAULT_SEASON_CACHE);

const nameOnlyIds = Object.entries(cache.players)
  .filter(([id, entry]) => {
    if (player && id !== player) return false;
    return (entry.seasons ?? []).length === 0;
  })
  .map(([id]) => id);

console.log(`Name-only players to re-process: ${nameOnlyIds.length}`);

for (let shardIndex = 0; shardIndex < shardCount; shardIndex += 1) {
  const path = shardCheckpointPath(shardIndex, shardCount);
  const checkpoint = loadCheckpoint(path);
  if (!checkpoint) {
    console.log(`[shard ${shardIndex}/${shardCount}] no checkpoint at ${path}`);
    continue;
  }

  const before = checkpoint.completedSlugs.length;
  const remove = new Set(nameOnlyIds);
  checkpoint.completedSlugs = checkpoint.completedSlugs.filter((id) => !remove.has(id));
  checkpoint.updatedAt = new Date().toISOString();
  saveCheckpoint(path, checkpoint);
  console.log(
    `[shard ${shardIndex}/${shardCount}] removed ${before - checkpoint.completedSlugs.length} from completed (${checkpoint.completedSlugs.length} remain)`,
  );
}

const singlePath = DEFAULT_CHECKPOINT;
try {
  const legacy = loadCheckpoint(singlePath);
  if (legacy) {
    const before = legacy.completedSlugs.length;
    const remove = new Set(nameOnlyIds);
    legacy.completedSlugs = legacy.completedSlugs.filter((id) => !remove.has(id));
    legacy.updatedAt = new Date().toISOString();
    saveCheckpoint(singlePath, legacy);
    console.log(`[legacy] removed ${before - legacy.completedSlugs.length} from completed`);
  }
} catch {
  // optional legacy checkpoint
}

console.log(`\nDone. Re-run all ${shardCount} shards with --resume to fetch profiles and ingest stats.`);
