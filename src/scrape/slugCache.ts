import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const DEFAULT_SLUG_CACHE = "ncaa-player-slugs.cache.json";

export interface SlugCache {
  version: 1;
  slugs: string[];
  updatedAt: string;
}

export function loadSlugCache(path: string): string[] | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as SlugCache;
    if (raw.version !== 1 || !Array.isArray(raw.slugs)) return null;
    return raw.slugs;
  } catch {
    return null;
  }
}

export function saveSlugCache(path: string, slugs: string[]): void {
  const payload: SlugCache = {
    version: 1,
    slugs,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
