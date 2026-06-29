import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const DEFAULT_GLOBAL_DISCOVERY_CHECKPOINT =
  "usbasket-global-discovery.checkpoint.json";

export interface GlobalDiscoveryCheckpoint {
  version: 1;
  completedTasks: string[];
  updatedAt: string;
}

export function emptyGlobalDiscoveryCheckpoint(): GlobalDiscoveryCheckpoint {
  return {
    version: 1,
    completedTasks: [],
    updatedAt: new Date().toISOString(),
  };
}

export function loadGlobalDiscoveryCheckpoint(
  path: string,
): GlobalDiscoveryCheckpoint | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as GlobalDiscoveryCheckpoint;
    if (raw.version !== 1 || !Array.isArray(raw.completedTasks)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveGlobalDiscoveryCheckpoint(
  path: string,
  checkpoint: GlobalDiscoveryCheckpoint,
): void {
  checkpoint.updatedAt = new Date().toISOString();
  writeFileSync(path, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

export function isTaskComplete(checkpoint: GlobalDiscoveryCheckpoint, task: string): boolean {
  return checkpoint.completedTasks.includes(task);
}

export function markTaskComplete(
  checkpoint: GlobalDiscoveryCheckpoint,
  task: string,
): void {
  if (checkpoint.completedTasks.includes(task)) return;
  checkpoint.completedTasks.push(task);
}

export function globalDiscoveryCheckpointPath(
  shardIndex: number,
  shardCount: number,
): string {
  if (shardCount <= 1) return DEFAULT_GLOBAL_DISCOVERY_CHECKPOINT;
  return DEFAULT_GLOBAL_DISCOVERY_CHECKPOINT.replace(
    ".checkpoint.json",
    `.shard-${shardIndex}-of-${shardCount}.checkpoint.json`,
  );
}

export function globalPlayerCachePath(shardIndex: number, shardCount: number): string {
  const base = "usbasket-global-player-ids.cache.json";
  if (shardCount <= 1) return base;
  return base.replace(".cache.json", `.shard-${shardIndex}-of-${shardCount}.cache.json`);
}

export function globalSlugCachePath(shardIndex: number, shardCount: number): string {
  const base = "usbasket-global-player-slugs.cache.json";
  if (shardCount <= 1) return base;
  return base.replace(".cache.json", `.shard-${shardIndex}-of-${shardCount}.cache.json`);
}
