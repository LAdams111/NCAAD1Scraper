import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { formatDisplayName } from "../utils/season.js";

export const DEFAULT_GLOBAL_PLAYER_CACHE = "usbasket-global-player-ids.cache.json";
export const DEFAULT_GLOBAL_SLUG_CACHE = "usbasket-global-player-slugs.cache.json";

export interface GlobalPlayerEntry {
  displayName: string;
  segments: string[];
  /** strData JSON rows and/or HTML profile links */
  sources: Array<"strData" | "html">;
}

export interface GlobalPlayerCache {
  version: 1;
  players: Record<string, GlobalPlayerEntry>;
  updatedAt: string;
}

export interface GlobalSlugCache {
  version: 1;
  slugs: string[];
  updatedAt: string;
}

export function emptyGlobalPlayerCache(): GlobalPlayerCache {
  return {
    version: 1,
    players: {},
    updatedAt: new Date().toISOString(),
  };
}

export function loadGlobalPlayerCache(path: string): GlobalPlayerCache | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as GlobalPlayerCache;
    if (raw.version !== 1 || typeof raw.players !== "object") return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveGlobalPlayerCache(path: string, cache: GlobalPlayerCache): void {
  cache.updatedAt = new Date().toISOString();
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export function saveGlobalSlugCache(path: string, playerIds: string[]): void {
  const payload: GlobalSlugCache = {
    version: 1,
    slugs: [...playerIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function mergeDiscoveredPlayer(
  cache: GlobalPlayerCache,
  playerId: string,
  displayName: string | null | undefined,
  segmentKey: string,
  source: "strData" | "html",
): boolean {
  const existing = cache.players[playerId];
  const formatted =
    displayName?.trim() ? formatDisplayName(displayName.trim()) : null;

  if (!existing) {
    cache.players[playerId] = {
      displayName: formatted ?? `Player-${playerId}`,
      segments: [segmentKey],
      sources: [source],
    };
    return true;
  }

  let changed = false;

  if (
    formatted &&
    (!existing.displayName || /^Player-\d+$/.test(existing.displayName))
  ) {
    existing.displayName = formatted;
    changed = true;
  }

  if (!existing.segments.includes(segmentKey)) {
    existing.segments.push(segmentKey);
    changed = true;
  }

  if (!existing.sources.includes(source)) {
    existing.sources.push(source);
    changed = true;
  }

  return changed;
}

export function countGlobalCacheStats(cache: GlobalPlayerCache): {
  players: number;
  withName: number;
  bySegment: Record<string, number>;
} {
  const bySegment: Record<string, number> = {};
  let withName = 0;

  for (const entry of Object.values(cache.players)) {
    if (!/^Player-\d+$/.test(entry.displayName)) withName += 1;
    for (const segment of entry.segments) {
      bySegment[segment] = (bySegment[segment] ?? 0) + 1;
    }
  }

  return {
    players: Object.keys(cache.players).length,
    withName,
    bySegment,
  };
}
