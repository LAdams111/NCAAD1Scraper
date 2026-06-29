import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { CachedPlayerSeasons } from "../types.js";
import {
  listSeasonYearParams,
  parsePlayerIdsFromIndexHtml,
  parsePlayersFromIndexHtml,
  type UsbasketClient,
  UsbasketRateLimitError,
} from "../usbasketClient.js";
import {
  defaultSeasonLabelForYearParam,
  indexRowToPlaceholderSeasonRow,
  indexRowToSeasonRow,
  mergeSeasonRows,
  parseSeasonRowsFromIndexData,
} from "./playerSeason.js";
import { formatDisplayName, normalizeSeasonLabel } from "../utils/season.js";

import { DEFAULT_SEASON_CACHE, NCAA_USBASKET_BOOTSTRAP_YEAR } from "../division.js";

export { DEFAULT_SEASON_CACHE };

export function loadSeasonCache(path: string): CachedPlayerSeasons | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as CachedPlayerSeasons;
    if (raw.version !== 1 || typeof raw.players !== "object") return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveSeasonCache(path: string, cache: CachedPlayerSeasons): void {
  cache.updatedAt = new Date().toISOString();
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export function emptySeasonCache(): CachedPlayerSeasons {
  return {
    version: 1,
    players: {},
    updatedAt: new Date().toISOString(),
  };
}

function mergeSeason(
  existing: CachedPlayerSeasons["players"][string]["seasons"],
  incoming: CachedPlayerSeasons["players"][string]["seasons"][number],
): CachedPlayerSeasons["players"][string]["seasons"] {
  const key = `${incoming.seasonLabel}:${incoming.teamName}`;
  const filtered = existing.filter((s) => `${s.seasonLabel}:${s.teamName}` !== key);
  return [...filtered, incoming];
}

export async function discoverAllPlayers(
  client: UsbasketClient,
): Promise<{ cache: CachedPlayerSeasons; slugs: string[] }> {
  const bootstrapHtml = await client.fetchHtml(
    client.indexUrl(NCAA_USBASKET_BOOTSTRAP_YEAR),
    8,
    true,
  );
  let yearParams = listSeasonYearParams(bootstrapHtml);
  if (!yearParams.length) {
    yearParams = [
      "2008",
      "2009",
      "2010",
      "2011",
      "2012",
      "2013",
      "2014",
      "2015",
      "2016",
      "2017",
      "2018",
      "2019",
      "2020",
      "2021",
      "2022",
      "2023",
      "2024",
      "2025",
      "2024-2025",
      "2025-2026",
    ];
  }

  const cache = emptySeasonCache();

  for (let i = 0; i < yearParams.length; i += 1) {
    const yearParam = yearParams[i];
    console.log(`[index] Season ${i + 1}/${yearParams.length}: Year=${yearParam}`);

    try {
      const { html, rows } = await client.fetchSeasonIndex(yearParam);
      const defaultLabel = defaultSeasonLabelForYearParam(yearParam);

      if (rows?.length) {
        const parsed = parseSeasonRowsFromIndexData(rows, defaultLabel);
        console.log(`[index]   ${parsed.length} player-season rows (${rows.length} total in JSON)`);

        for (const entry of parsed) {
          const existing = cache.players[entry.playerId] ?? {
            displayName: entry.displayName,
            position: entry.position,
            seasons: [],
          };
          existing.displayName = entry.displayName;
          if (entry.position) existing.position = entry.position;
          existing.seasons = mergeSeason(existing.seasons, entry.season);
          cache.players[entry.playerId] = existing;
        }
      } else {
        console.log(`[index]   no strData JSON for Year=${yearParam}`);
      }

      const discoveredPlayers = parsePlayersFromIndexHtml(html);
      if (discoveredPlayers.length) {
        console.log(`[index]   registered ${discoveredPlayers.length} player IDs from page links`);
        for (const { playerId, playerName } of discoveredPlayers) {
          const displayName = playerName
            ? formatDisplayName(playerName)
            : `Player-${playerId}`;
          const existing = cache.players[playerId];
          if (!existing) {
            cache.players[playerId] = {
              displayName,
              position: null,
              seasons: [],
            };
            continue;
          }
          if (playerName && /^Player-\d+$/.test(existing.displayName)) {
            existing.displayName = displayName;
          }
        }
      } else if (!rows?.length) {
        console.log(`[index]   no player links found for Year=${yearParam}`);
      }
    } catch (error) {
      if (error instanceof UsbasketRateLimitError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[index]   failed Year=${yearParam}: ${message}`);
    }
  }

  const slugs = Object.keys(cache.players).sort();
  const withStats = slugs.filter((id) => (cache.players[id]?.seasons.length ?? 0) > 0).length;
  console.log(
    `[index] Discovery complete: ${slugs.length} unique players (${withStats} with index stats)`,
  );
  return { cache, slugs };
}

/** Find a player's name on the index (newest seasons first). */
export async function lookupPlayerMetaFromIndex(
  client: UsbasketClient,
  playerId: string,
): Promise<{ displayName: string; position: string | null } | null> {
  const bootstrapHtml = await client.fetchHtml(
    client.indexUrl(NCAA_USBASKET_BOOTSTRAP_YEAR),
    8,
    true,
  );
  const yearParams = listSeasonYearParams(bootstrapHtml);

  for (const yearParam of [...yearParams].reverse()) {
    const { rows } = await client.fetchSeasonIndex(yearParam);
    if (!rows?.length) continue;

    for (const row of rows) {
      if (row.PLAYERID?.trim() !== playerId) continue;
      return {
        displayName: formatDisplayName(row.PLAYERNAME),
        position: row.POSITION?.trim() || null,
      };
    }
  }

  return null;
}

/** Backfill fast path: newest index season only (avoids scanning all 19 years). */
export async function lookupFirstIndexSeasonForPlayer(
  client: UsbasketClient,
  playerId: string,
): Promise<{
  displayName: string;
  position: string | null;
  season: CachedPlayerSeasons["players"][string]["seasons"][number];
} | null> {
  const bootstrapHtml = await client.fetchHtml(
    client.indexUrl(NCAA_USBASKET_BOOTSTRAP_YEAR),
    8,
    true,
  );
  const yearParams = listSeasonYearParams(bootstrapHtml);

  for (const yearParam of [...yearParams].reverse()) {
    const { rows } = await client.fetchSeasonIndex(yearParam);
    if (!rows?.length) continue;

    const defaultLabel = defaultSeasonLabelForYearParam(yearParam);
    for (const row of rows) {
      if (row.PLAYERID?.trim() !== playerId) continue;

      let label = defaultLabel;
      if (row.Season) {
        const fromRow = normalizeSeasonLabel(row.Season);
        if (fromRow) label = fromRow;
      }

      const season =
        indexRowToSeasonRow(row, label) ?? indexRowToPlaceholderSeasonRow(row, label);
      if (!season) continue;

      return {
        displayName: formatDisplayName(row.PLAYERNAME),
        position: row.POSITION?.trim() || null,
        season,
      };
    }
  }

  return null;
}

/** Resolve name + index seasons for one player (single-player runs without a saved cache). */
export async function resolvePlayerFromIndex(
  client: UsbasketClient,
  playerId: string,
): Promise<CachedPlayerSeasons["players"][string] | null> {
  const bootstrapHtml = await client.fetchHtml(
    client.indexUrl(NCAA_USBASKET_BOOTSTRAP_YEAR),
    8,
    true,
  );
  const yearParams = listSeasonYearParams(bootstrapHtml);
  let displayName: string | null = null;
  let position: string | null = null;
  const seasons: CachedPlayerSeasons["players"][string]["seasons"] = [];

  for (const yearParam of [...yearParams].reverse()) {
    const { rows } = await client.fetchSeasonIndex(yearParam);
    if (!rows?.length) continue;

    const defaultLabel = defaultSeasonLabelForYearParam(yearParam);
    for (const row of rows) {
      if (row.PLAYERID?.trim() !== playerId) continue;

      if (!displayName) {
        displayName = formatDisplayName(row.PLAYERNAME);
        position = row.POSITION?.trim() || null;
      }

      let label = defaultLabel;
      if (row.Season) {
        const fromRow = normalizeSeasonLabel(row.Season);
        if (fromRow) label = fromRow;
      }

      const season =
        indexRowToSeasonRow(row, label) ?? indexRowToPlaceholderSeasonRow(row, label);
      if (season) seasons.push(season);
    }
  }

  if (!displayName) return null;

  return {
    displayName,
    position,
    seasons: mergeSeasonRows(seasons),
  };
}

/** Scan season indexes when profile AJAX has no NCAA rows (common for NBA-profile pages). */
export async function fetchIndexSeasonsForPlayer(
  client: UsbasketClient,
  playerId: string,
): Promise<CachedPlayerSeasons["players"][string]["seasons"]> {
  const resolved = await resolvePlayerFromIndex(client, playerId);
  return resolved?.seasons ?? [];
}
