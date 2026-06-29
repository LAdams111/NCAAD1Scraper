import { existsSync, readFileSync } from "node:fs";
import {
  DEFAULT_GLOBAL_PLAYER_CACHE,
  DEFAULT_GLOBAL_SLUG_CACHE,
  loadGlobalPlayerCache,
  type GlobalPlayerCache,
} from "../discover/globalCache.js";
import { loadSlugCache } from "../scrape/slugCache.js";

export interface CareerQueueEntry {
  playerId: string;
  displayName: string;
}

export function loadCareerQueue(options: {
  slugCachePath: string;
  playerCachePath: string;
}): CareerQueueEntry[] {
  const slugPath = options.slugCachePath;
  const playerPath = options.playerCachePath;

  const playerCache = loadGlobalPlayerCache(playerPath);
  if (playerCache) {
    return Object.entries(playerCache.players)
      .map(([playerId, entry]) => ({
        playerId,
        displayName: entry.displayName,
      }))
      .sort((a, b) => a.playerId.localeCompare(b.playerId, undefined, { numeric: true }));
  }

  const slugs = loadSlugCache(slugPath);
  if (slugs?.length) {
    return slugs.map((playerId) => ({
      playerId,
      displayName: `Player-${playerId}`,
    }));
  }

  if (existsSync(slugPath)) {
    try {
      const raw = JSON.parse(readFileSync(slugPath, "utf8")) as { slugs?: string[] };
      if (Array.isArray(raw.slugs)) {
        return raw.slugs.map((playerId) => ({
          playerId,
          displayName: `Player-${playerId}`,
        }));
      }
    } catch {
      // fall through
    }
  }

  return [];
}

export function resolveCareerCachePaths(options: {
  slugCachePath?: string;
  playerCachePath?: string;
}): { slugCachePath: string; playerCachePath: string } {
  return {
    slugCachePath: options.slugCachePath ?? DEFAULT_GLOBAL_SLUG_CACHE,
    playerCachePath: options.playerCachePath ?? DEFAULT_GLOBAL_PLAYER_CACHE,
  };
}

export function lookupQueueDisplayName(
  queue: CareerQueueEntry[],
  playerCache: GlobalPlayerCache | null,
  playerId: string,
): string {
  const fromCache = playerCache?.players[playerId]?.displayName;
  if (fromCache && !/^Player-\d+$/.test(fromCache)) return fromCache;
  const fromQueue = queue.find((entry) => entry.playerId === playerId)?.displayName;
  if (fromQueue && !/^Player-\d+$/.test(fromQueue)) return fromQueue;
  return fromCache ?? fromQueue ?? `Player-${playerId}`;
}
