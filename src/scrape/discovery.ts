import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { CachedPlayerSeasons } from "../types.js";
import {
  listSeasonYearParams,
  parsePlayerIdsFromIndexHtml,
  type UsbasketClient,
  UsbasketRateLimitError,
} from "../usbasketClient.js";
import {
  defaultSeasonLabelForYearParam,
  indexRowToSeasonRow,
  mergeSeasonRows,
  parseSeasonRowsFromIndexData,
} from "./playerSeason.js";
import { normalizeSeasonLabel } from "../utils/season.js";

export const DEFAULT_SEASON_CACHE = "ncaa-player-seasons.cache.json";

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
  const bootstrapHtml = await client.fetchHtml(client.indexUrl("2025-2026"), 8, true);
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
        const discoveredIds = parsePlayerIdsFromIndexHtml(html);
        console.log(
          `[index]   no strData JSON — registered ${discoveredIds.length} player IDs (name index only)`,
        );

        for (const playerId of discoveredIds) {
          if (!cache.players[playerId]) {
            cache.players[playerId] = {
              displayName: `Player-${playerId}`,
              position: null,
              seasons: [],
            };
          }
        }
      }
    } catch (error) {
      if (error instanceof UsbasketRateLimitError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[index]   failed Year=${yearParam}: ${message}`);
    }
  }

  const slugs = Object.keys(cache.players).sort();
  console.log(`[index] Discovery complete: ${slugs.length} unique players`);
  return { cache, slugs };
}

/** Scan season indexes when profile AJAX has no NCAA rows (common for NBA-profile pages). */
export async function fetchIndexSeasonsForPlayer(
  client: UsbasketClient,
  playerId: string,
): Promise<CachedPlayerSeasons["players"][string]["seasons"]> {
  const bootstrapHtml = await client.fetchHtml(client.indexUrl("2025-2026"), 8, true);
  const yearParams = listSeasonYearParams(bootstrapHtml);
  const seasons: CachedPlayerSeasons["players"][string]["seasons"] = [];

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

      const season = indexRowToSeasonRow(row, label);
      if (season) seasons.push(season);
    }
  }

  return mergeSeasonRows(seasons);
}
