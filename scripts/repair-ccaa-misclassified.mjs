#!/usr/bin/env node
/**
 * Remove misclassified CCAA seasons from cache and unmark players in checkpoints.
 *
 * Usage:
 *   node scripts/audit-ccaa-misclassified.mjs --profiles
 *   node scripts/repair-ccaa-misclassified.mjs
 *   node scripts/repair-ccaa-misclassified.mjs --player 433126
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { DEFAULT_SEASON_CACHE } from "../dist/division.js";
import { loadCheckpoint, saveCheckpoint } from "../dist/scrape/checkpoint.js";
import { shardCheckpointPath } from "../dist/utils/shard.js";

const REPORT_PATH = "ccaa-misclassified-report.json";

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

if (!existsSync(REPORT_PATH)) {
  console.error(`Missing ${REPORT_PATH}. Run: node scripts/audit-ccaa-misclassified.mjs --profiles`);
  process.exit(1);
}

const report = loadJson(REPORT_PATH);
const cache = loadJson(DEFAULT_SEASON_CACHE);

const removals = report.issues.filter((row) => {
  if (player && row.playerId !== player) return false;
  return [
    "non-ccaa-team-label",
    "ambiguous-team-rewrite",
    "profile-juco-fingerprint-match",
    "log-heuristic-juco-mohawk",
  ].includes(row.reason);
});

const byPlayer = new Map();
for (const row of removals) {
  const key = `${row.playerId}:${row.seasonLabel}:${row.teamName}`;
  if (!byPlayer.has(row.playerId)) byPlayer.set(row.playerId, new Set());
  byPlayer.get(row.playerId).add(key);
}

let removedSeasons = 0;
for (const [playerId, removeKeys] of byPlayer) {
  const entry = cache.players[playerId];
  if (!entry) continue;
  const before = entry.seasons?.length ?? 0;
  entry.seasons = (entry.seasons ?? []).filter((season) => {
    const key = `${playerId}:${season.seasonLabel}:${season.teamName}`;
    return !removeKeys.has(key);
  });
  removedSeasons += before - entry.seasons.length;
  console.log(
    `[cache] ${playerId} ${entry.displayName}: removed ${before - entry.seasons.length} season(s)`,
  );
}

writeFileSync(DEFAULT_SEASON_CACHE, `${JSON.stringify(cache, null, 2)}\n`);

const affectedIds = [...byPlayer.keys()];
for (let shardIndex = 0; shardIndex < shardCount; shardIndex += 1) {
  const path = shardCheckpointPath(shardIndex, shardCount);
  const checkpoint = loadCheckpoint(path);
  if (!checkpoint) continue;

  const before = checkpoint.completedSlugs.length;
  const remove = new Set(affectedIds);
  checkpoint.completedSlugs = checkpoint.completedSlugs.filter((id) => !remove.has(id));
  checkpoint.updatedAt = new Date().toISOString();
  saveCheckpoint(path, checkpoint);
  console.log(
    `[shard ${shardIndex}/${shardCount}] unmarked ${before - checkpoint.completedSlugs.length} player(s)`,
  );
}

console.log(`\nRemoved ${removedSeasons} misclassified season(s) from cache.`);
console.log(`Re-run CCAA shards with --resume to re-ingest ${affectedIds.length} player(s).`);
console.log(
  `\nNote: Hoop Central may still show old CCAA rows until removed manually or overwritten.`,
);
for (const row of removals.slice(0, 20)) {
  console.log(`  - usbasket-ccaa:${row.playerId} ${row.seasonLabel} @ ${row.teamName} (${row.reason})`);
}
