#!/usr/bin/env node
/**
 * Replace Player-{id} placeholders in the season cache with names from index link text.
 */
import { readFileSync } from "node:fs";
import { loadConfig } from "../dist/config.js";
import { DEFAULT_SEASON_CACHE, NCAA_USBASKET_BOOTSTRAP_YEAR } from "../dist/division.js";
import { loadSeasonCache, saveSeasonCache } from "../dist/scrape/discovery.js";
import {
  listSeasonYearParams,
  parsePlayersFromIndexHtml,
  UsbasketClient,
} from "../dist/usbasketClient.js";
import { formatDisplayName } from "../dist/utils/season.js";

const config = loadConfig();
const cachePath = DEFAULT_SEASON_CACHE;
const cache = loadSeasonCache(cachePath);
if (!cache) {
  throw new Error(`Missing ${cachePath}`);
}

const client = new UsbasketClient(config.requestDelayMs, config.indexDelayMs, config.usbasketCookie);
await client.ensureLoggedIn(config.usbasketEmail, config.usbasketPassword);

const bootstrapHtml = await client.fetchHtml(
  client.indexUrl(NCAA_USBASKET_BOOTSTRAP_YEAR),
  8,
  true,
);
const yearParams = listSeasonYearParams(bootstrapHtml);
let patched = 0;

for (const yearParam of yearParams) {
  const { html } = await client.fetchSeasonIndex(yearParam);
  for (const { playerId, playerName } of parsePlayersFromIndexHtml(html)) {
    if (!playerName) continue;
    const entry = cache.players[playerId];
    if (!entry || !/^Player-\d+$/.test(entry.displayName)) continue;
    entry.displayName = formatDisplayName(playerName);
    patched += 1;
  }
}

saveSeasonCache(cachePath, cache);
console.log(`Patched ${patched} placeholder names in ${cachePath}`);
