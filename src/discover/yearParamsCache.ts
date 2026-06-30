import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const DEFAULT_YEAR_PARAMS_CACHE = "usbasket-global-discovery-year-params.cache.json";

export interface YearParamsCache {
  version: 1;
  /** segmentKey → season year params from site dropdown */
  segments: Record<string, string[]>;
  /** Cached EuroBasket country segment ids (when include-eurobasket is used) */
  eurobasketCountryIds: string[];
  updatedAt: string;
}

export function emptyYearParamsCache(): YearParamsCache {
  return {
    version: 1,
    segments: {},
    eurobasketCountryIds: [],
    updatedAt: new Date().toISOString(),
  };
}

export function loadYearParamsCache(path: string): YearParamsCache | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as YearParamsCache;
    if (raw.version !== 1 || typeof raw.segments !== "object") return null;
    if (!Array.isArray(raw.eurobasketCountryIds)) raw.eurobasketCountryIds = [];
    return raw;
  } catch {
    return null;
  }
}

export function saveYearParamsCache(path: string, cache: YearParamsCache): void {
  cache.updatedAt = new Date().toISOString();
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export function getCachedYearParams(
  cache: YearParamsCache,
  segmentKey: string,
): string[] | null {
  const years = cache.segments[segmentKey];
  if (!years?.length) return null;
  return years;
}

export function setCachedYearParams(
  cache: YearParamsCache,
  path: string,
  segmentKey: string,
  years: string[],
): void {
  cache.segments[segmentKey] = years;
  saveYearParamsCache(path, cache);
}
