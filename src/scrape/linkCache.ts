import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const DEFAULT_NCAA_LINK_CACHE = "ncaa-to-bdl.cache.json";

export interface LinkCache {
  version: 1;
  mappings: Record<string, string>;
  updatedAt: string;
}

export function loadLinkCache(path: string): LinkCache {
  if (!existsSync(path)) {
    return { version: 1, mappings: {}, updatedAt: new Date().toISOString() };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as LinkCache;
    if (raw.version !== 1 || typeof raw.mappings !== "object") {
      return { version: 1, mappings: {}, updatedAt: new Date().toISOString() };
    }
    return raw;
  } catch {
    return { version: 1, mappings: {}, updatedAt: new Date().toISOString() };
  }
}

export function saveLinkCache(path: string, cache: LinkCache): void {
  cache.updatedAt = new Date().toISOString();
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
