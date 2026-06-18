import dotenv from "dotenv";
import { writeFileSync } from "node:fs";
import { UsbasketClient } from "../dist/usbasketClient.js";
import {
  defaultSeasonLabelForYearParam,
  parseSeasonRowsFromIndexData,
} from "../dist/scrape/playerSeason.js";
import {
  DEFAULT_SEASON_CACHE,
  emptySeasonCache,
  saveSeasonCache,
} from "../dist/scrape/discovery.js";
import { DEFAULT_SLUG_CACHE, saveSlugCache } from "../dist/scrape/slugCache.js";

dotenv.config();

const cookie = process.env.USBASKET_COOKIE?.trim() || null;
const client = new UsbasketClient(500, 500, cookie);

console.log("[bootstrap] Fetching current season index (2025-2026)...");
const { rows } = await client.fetchSeasonIndex("2025-2026");
const label = defaultSeasonLabelForYearParam("2025-2026");
const parsed = parseSeasonRowsFromIndexData(rows, label);

const cache = emptySeasonCache();
for (const entry of parsed) {
  const existing = cache.players[entry.playerId] ?? {
    displayName: entry.displayName,
    position: entry.position,
    seasons: [],
  };
  existing.displayName = entry.displayName;
  if (entry.position) existing.position = entry.position;
  const key = `${entry.season.seasonLabel}:${entry.season.teamName}`;
  existing.seasons = [
    ...existing.seasons.filter((s) => `${s.seasonLabel}:${s.teamName}` !== key),
    entry.season,
  ];
  cache.players[entry.playerId] = existing;
}

const slugs = Object.keys(cache.players).sort();
saveSeasonCache(DEFAULT_SEASON_CACHE, cache);
saveSlugCache(DEFAULT_SLUG_CACHE, slugs);

writeFileSync(
  "scrape-ncaa-backfill.checkpoint.json",
  `${JSON.stringify(
    {
      version: 1,
      completedSlugs: [],
      allSlugs: slugs,
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

console.log(`[bootstrap] Cached ${slugs.length} players from 2025-26 index.`);
