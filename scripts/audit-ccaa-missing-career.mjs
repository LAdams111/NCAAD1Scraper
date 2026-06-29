#!/usr/bin/env node
/**
 * Find CCAA players whose usbasket profile exposes career seasons missing from cache.
 *
 * Usage:
 *   node scripts/audit-ccaa-missing-career.mjs --shard 0/8
 *   node scripts/audit-ccaa-missing-career.mjs --player 734808
 *   node scripts/audit-ccaa-missing-career.mjs --shard 0/8 --limit 20
 */
import { writeFileSync } from "node:fs";
import { loadConfig } from "../dist/config.js";
import { DEFAULT_SEASON_CACHE, DEFAULT_SLUG_CACHE } from "../dist/division.js";
import { loadSeasonCache } from "../dist/scrape/discovery.js";
import { loadSlugCache } from "../dist/scrape/slugCache.js";
import {
  collectAllNcaaSeasons,
  mergeSeasonRows,
  seasonRowKey,
} from "../dist/scrape/playerSeason.js";
import { filterValidUsportsSeasons } from "../dist/utils/usportsTeams.js";
import { playerBelongsToShard, parseShardValue, shardLabel } from "../dist/utils/shard.js";
import { UsbasketClient, playerUrl } from "../dist/usbasketClient.js";

function parseArgs(argv) {
  let player;
  let limit;
  let shardIndex = 0;
  let shardCount = 1;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--player") player = argv[++i]?.trim();
    if (argv[i] === "--limit") limit = Number.parseInt(argv[++i], 10);
    if (argv[i] === "--shard") {
      const parsed = parseShardValue(argv[++i]);
      shardIndex = parsed.shardIndex;
      if (parsed.shardCount > 0) shardCount = parsed.shardCount;
    }
    if (argv[i] === "--shards") shardCount = Number.parseInt(argv[++i], 10);
  }
  return { player, limit, shardIndex, shardCount };
}

function reportPath(shardIndex, shardCount) {
  if (shardCount <= 1) return "ccaa-missing-career-report.json";
  return `ccaa-missing-career-report.shard-${shardIndex}-of-${shardCount}.json`;
}

async function expectedSeasons(client, playerId, displayName, cachedSeasons) {
  const slug = displayName.replace(/\s+/g, "-");
  const html = await client.fetchHtml(playerUrl(playerId, slug));
  const profileSeasons = await collectAllNcaaSeasons(client, playerId, html);
  return filterValidUsportsSeasons(mergeSeasonRows(cachedSeasons, profileSeasons));
}

const { player, limit, shardIndex, shardCount } = parseArgs(process.argv.slice(2));
const config = loadConfig();
const client = new UsbasketClient(400, 800, config.usbasketCookie);
await client.ensureLoggedIn(config.usbasketEmail, config.usbasketPassword);

const seasonCache = loadSeasonCache(DEFAULT_SEASON_CACHE);
if (!seasonCache) {
  console.error(`Missing ${DEFAULT_SEASON_CACHE}`);
  process.exit(1);
}

const slugs = loadSlugCache(DEFAULT_SLUG_CACHE) ?? Object.keys(seasonCache.players);
let playerIds = player ? [player] : slugs.filter((id) => playerBelongsToShard(id, shardIndex, shardCount));

if (limit && limit > 0) playerIds = playerIds.slice(0, limit);

console.log(
  `Scanning ${playerIds.length} player(s) on shard ${shardLabel(shardIndex, shardCount)}...`,
);

const issues = [];
let scanned = 0;
let profileErrors = 0;

for (const playerId of playerIds) {
  const entry = seasonCache.players[playerId];
  if (!entry) continue;

  scanned += 1;
  const cachedSeasons = filterValidUsportsSeasons(entry.seasons ?? []);
  const cachedKeys = new Set(cachedSeasons.map((season) => seasonRowKey(season)));

  try {
    const expected = await expectedSeasons(client, playerId, entry.displayName, entry.seasons ?? []);
    const missing = mergeSeasonRows(
      expected.filter((season) => !cachedKeys.has(seasonRowKey(season))),
    );
    if (missing.length === 0) continue;

    issues.push({
      playerId,
      displayName: entry.displayName,
      cachedSeasons: cachedSeasons.map((season) => seasonRowKey(season)),
      expectedSeasons: expected.map((season) => seasonRowKey(season)),
      missing,
    });
    console.log(
      `[missing] ${playerId} ${entry.displayName}: +${missing.length} season(s) ` +
        `[${missing.map((season) => seasonRowKey(season)).join(", ")}]`,
    );
  } catch (error) {
    profileErrors += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[error] ${playerId} ${entry.displayName}: ${message}`);
  }
}

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  shardIndex,
  shardCount,
  issues,
  summary: {
    playersScanned: scanned,
    playersWithMissing: issues.length,
    missingSeasonRows: issues.reduce((sum, row) => sum + row.missing.length, 0),
    profileErrors,
  },
};

const outPath = reportPath(shardIndex, shardCount);
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `\nWrote ${outPath}: ${report.summary.playersWithMissing} player(s), ` +
    `${report.summary.missingSeasonRows} missing season row(s).`,
);
