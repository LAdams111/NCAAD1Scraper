#!/usr/bin/env node
/**
 * Ingest CCAA career seasons that were missed by the profile parser (no duplicate re-ingest).
 *
 * Usage:
 *   node scripts/audit-ccaa-missing-career.mjs --shard 0/8
 *   node scripts/repair-ccaa-missing-career.mjs
 *   node scripts/repair-ccaa-missing-career.mjs --player 734808
 *   node scripts/repair-ccaa-missing-career.mjs --dry-run
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { loadConfig } from "../dist/config.js";
import { DEFAULT_SEASON_CACHE } from "../dist/division.js";
import { loadSeasonCache, saveSeasonCache } from "../dist/scrape/discovery.js";
import { createLinkResolver, buildBioPayload } from "../dist/scrape/linking.js";
import { parsePlayerBioFromHtml } from "../dist/scrape/playerMeta.js";
import {
  buildRecordsFromSeasonRows,
  mergeSeasonRows,
  seasonRowKey,
} from "../dist/scrape/playerSeason.js";
import { toIngestPayload } from "../dist/transform.js";
import { IngestClient } from "../dist/ingestClient.js";
import { filterValidUsportsSeasons } from "../dist/utils/usportsTeams.js";
import { UsbasketClient, playerUrl } from "../dist/usbasketClient.js";

const REPORT_PREFIX = "ccaa-missing-career-report";

function parseArgs(argv) {
  let player;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--player") player = argv[++i]?.trim();
    if (argv[i] === "--dry-run") dryRun = true;
  }
  return { player, dryRun };
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadReports() {
  const paths = readdirSync(".").filter(
    (name) => name === `${REPORT_PREFIX}.json` || name.startsWith(`${REPORT_PREFIX}.shard-`),
  );
  if (paths.length === 0) {
    console.error(
      `No ${REPORT_PREFIX}*.json found. Run audit first, e.g. node scripts/audit-ccaa-missing-career.mjs --shard 0/8`,
    );
    process.exit(1);
  }

  const issues = [];
  for (const path of paths.sort()) {
    const report = loadJson(path);
    issues.push(...(report.issues ?? []));
  }
  return issues;
}

const { player, dryRun } = parseArgs(process.argv.slice(2));
const issues = loadReports().filter((row) => !player || row.playerId === player);

if (issues.length === 0) {
  console.log("No missing-career issues to repair.");
  process.exit(0);
}

const config = loadConfig();
const seasonCache = loadSeasonCache(DEFAULT_SEASON_CACHE);
if (!seasonCache) {
  console.error(`Missing ${DEFAULT_SEASON_CACHE}`);
  process.exit(1);
}

const client = new UsbasketClient(400, 800, config.usbasketCookie);
await client.ensureLoggedIn(config.usbasketEmail, config.usbasketPassword);

const ingest = new IngestClient(config.hoopCentralApiUrl, config.ingestApiKey);
const linkResolver = createLinkResolver({
  linkCachePath: "ccaa-to-bdl.cache.json",
  loadCompletionStatus: async (source) => {
    const result = await ingest.getCompletionStatus(source);
    return result.players;
  },
});

let playersUpdated = 0;
let seasonsIngested = 0;
let failures = 0;

for (const issue of issues) {
  const entry = seasonCache.players[issue.playerId];
  if (!entry) {
    console.warn(`[skip] ${issue.playerId}: not in season cache`);
    continue;
  }

  const cachedSeasons = filterValidUsportsSeasons(entry.seasons ?? []);
  const cachedKeys = new Set(cachedSeasons.map((season) => seasonRowKey(season)));
  const missing = mergeSeasonRows(
    (issue.missing ?? []).filter((season) => !cachedKeys.has(seasonRowKey(season))),
  );
  if (missing.length === 0) continue;

  console.log(
    `[repair] ${issue.playerId} ${entry.displayName}: ${missing.length} missing season(s)`,
  );

  if (dryRun) {
    for (const season of missing) {
      console.log(`  [dry-run] would ingest ${seasonRowKey(season)}`);
    }
    continue;
  }

  try {
    const html = await client.fetchHtml(
      playerUrl(issue.playerId, entry.displayName.replace(/\s+/g, "-")),
    );
    const bio = parsePlayerBioFromHtml(
      html,
      issue.playerId,
      entry.displayName,
      entry.position ?? null,
    );
    const linkTarget = await linkResolver.resolveLinkTarget(
      issue.playerId,
      bio.displayName,
      bio.birthDate,
      missing.map((season) => season.seasonLabel),
    );
    const bioResult = await ingest.sendPlayerBio(buildBioPayload(bio, linkTarget ?? undefined));
    const playerFields = { displayName: entry.displayName };
    const records = buildRecordsFromSeasonRows(issue.playerId, entry.displayName, missing);

    for (const record of records) {
      const payload = toIngestPayload(record, playerFields, true);
      await ingest.sendPlayerSeason(payload);
      seasonsIngested += 1;
      console.log(
        `[season] ${issue.playerId} ${record.seasonLabel} ${record.teamAbbreviation} → playerId=${bioResult.playerId}`,
      );
    }

    entry.seasons = mergeSeasonRows(entry.seasons ?? [], missing);
    playersUpdated += 1;
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[fail] ${issue.playerId} ${entry.displayName}: ${message}`);
  }
}

if (!dryRun && playersUpdated > 0) {
  saveSeasonCache(DEFAULT_SEASON_CACHE, seasonCache);
}

console.log(
  `\nDone. Updated ${playersUpdated} player(s), ingested ${seasonsIngested} season row(s), failed ${failures}.`,
);
