#!/usr/bin/env node
/**
 * Merge sharded global discovery caches into one union file.
 * Run after all shards of `npm run discover:global` complete.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import {
  countGlobalCacheStats,
  mergeDiscoveredPlayer,
  saveGlobalPlayerCache,
  saveGlobalSlugCache,
  type GlobalPlayerCache,
} from "../src/discover/globalCache.js";

function emptyCache(): GlobalPlayerCache {
  return { version: 1, players: {}, updatedAt: new Date().toISOString() };
}

function loadCache(path: string): GlobalPlayerCache | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as GlobalPlayerCache;
    if (raw.version !== 1 || typeof raw.players !== "object") return null;
    return raw;
  } catch {
    return null;
  }
}

function mergeInto(target: GlobalPlayerCache, source: GlobalPlayerCache): void {
  for (const [playerId, entry] of Object.entries(source.players)) {
    for (const segment of entry.segments) {
      for (const src of entry.sources) {
        mergeDiscoveredPlayer(target, playerId, entry.displayName, segment, src);
      }
    }
  }
}

function main(): void {
  const merged = emptyCache();
  const paths: string[] = ["usbasket-global-player-ids.cache.json"];

  for (const name of readdirSync(".")) {
    if (/^usbasket-global-player-ids\.shard-\d+-of-\d+\.cache\.json$/.test(name)) {
      paths.push(name);
    }
  }

  let loaded = 0;
  for (const path of paths) {
    const cache = loadCache(path);
    if (!cache) continue;
    mergeInto(merged, cache);
    loaded += 1;
    console.log(`[merge] ${path}: ${Object.keys(cache.players).length} player(s)`);
  }

  if (loaded === 0) {
    console.error("No discovery cache files found.");
    process.exit(1);
  }

  saveGlobalPlayerCache("usbasket-global-player-ids.cache.json", merged);
  saveGlobalSlugCache(
    "usbasket-global-player-slugs.cache.json",
    Object.keys(merged.players),
  );

  const stats = countGlobalCacheStats(merged);
  console.log("");
  console.log(`[merge] Union: ${stats.players} unique player ID(s) from ${loaded} file(s)`);
  console.log(`[merge] Wrote usbasket-global-player-ids.cache.json`);
  console.log(`[merge] Wrote usbasket-global-player-slugs.cache.json`);
}

main();
