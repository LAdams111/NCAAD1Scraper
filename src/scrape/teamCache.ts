import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { nameToSlug } from "../utils/teams.js";

export const DEFAULT_TEAM_CACHE = "ccaa-teams.cache.json";

export interface TeamCacheEntry {
  abbrev: string;
  seasonYear: number;
  fullName: string;
  slug: string;
}

export interface TeamCache {
  version: 1;
  teams: Record<string, TeamCacheEntry>;
  updatedAt: string;
}

function cacheKey(abbrev: string, seasonYear: number): string {
  return `${abbrev.toUpperCase()}:${seasonYear}`;
}

export function loadTeamCache(path: string): TeamCache {
  if (!existsSync(path)) {
    return { version: 1, teams: {}, updatedAt: new Date().toISOString() };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as TeamCache;
    if (raw.version !== 1 || typeof raw.teams !== "object") {
      return { version: 1, teams: {}, updatedAt: new Date().toISOString() };
    }
    return raw;
  } catch {
    return { version: 1, teams: {}, updatedAt: new Date().toISOString() };
  }
}

export function saveTeamCache(path: string, cache: TeamCache): void {
  cache.updatedAt = new Date().toISOString();
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export function setCachedTeam(
  cache: TeamCache,
  abbrev: string,
  seasonYear: number,
  fullName: string,
): TeamCacheEntry {
  const entry: TeamCacheEntry = {
    abbrev: abbrev.toUpperCase(),
    seasonYear,
    fullName,
    slug: nameToSlug(fullName),
  };
  cache.teams[cacheKey(abbrev, seasonYear)] = entry;
  return entry;
}
