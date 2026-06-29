import {
  DEFAULT_CHECKPOINT,
  DEFAULT_LINK_CACHE,
  DEFAULT_LOG,
} from "../division.js";
import {
  ensureCheckpoint,
  loadCheckpoint,
  type NcaaCheckpoint,
  saveCheckpoint,
} from "../scrape/checkpoint.js";

export interface ShardConfig {
  shardIndex: number;
  shardCount: number;
}

export function parseShardValue(value: string): ShardConfig {
  if (value.includes("/")) {
    const [indexRaw, countRaw] = value.split("/");
    const shardIndex = Number.parseInt(indexRaw, 10);
    const shardCount = Number.parseInt(countRaw, 10);
    validateShard(shardIndex, shardCount);
    return { shardIndex, shardCount };
  }

  const shardIndex = Number.parseInt(value, 10);
  if (Number.isNaN(shardIndex)) {
    throw new Error(`Invalid --shard value: ${value}`);
  }
  return { shardIndex, shardCount: -1 };
}

export function validateShard(shardIndex: number, shardCount: number): void {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`--shards must be a positive integer (got ${shardCount})`);
  }
  if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) {
    throw new Error(`--shard must be between 0 and ${shardCount - 1} (got ${shardIndex})`);
  }
}

export function normalizeShardConfig(
  shardIndex: number | undefined,
  shardCount: number | undefined,
): ShardConfig {
  const count = shardCount ?? 1;
  const index = shardIndex ?? 0;
  validateShard(index, count);
  return { shardIndex: index, shardCount: count };
}

/** Stable usbasket ID → shard bucket (same player always same shard). */
export function playerBelongsToShard(
  playerId: string,
  shardIndex: number,
  shardCount: number,
): boolean {
  if (shardCount <= 1) return true;

  const numericId = Number.parseInt(playerId, 10);
  if (!Number.isNaN(numericId)) {
    return numericId % shardCount === shardIndex;
  }

  let hash = 0;
  for (let i = 0; i < playerId.length; i += 1) {
    hash = (hash + playerId.charCodeAt(i)) % shardCount;
  }
  return hash === shardIndex;
}

export function shardLabel(shardIndex: number, shardCount: number): string {
  return shardCount <= 1 ? "single" : `${shardIndex}/${shardCount}`;
}

function shardSuffix(shardIndex: number, shardCount: number): string {
  return `.shard-${shardIndex}-of-${shardCount}`;
}

export function shardCheckpointPath(shardIndex: number, shardCount: number): string {
  if (shardCount <= 1) return DEFAULT_CHECKPOINT;
  return DEFAULT_CHECKPOINT.replace(".checkpoint.json", `${shardSuffix(shardIndex, shardCount)}.checkpoint.json`);
}

export function shardLogPath(shardIndex: number, shardCount: number): string {
  if (shardCount <= 1) return DEFAULT_LOG;
  return DEFAULT_LOG.replace(".log", `${shardSuffix(shardIndex, shardCount)}.log`);
}

export function shardLinkCachePath(shardIndex: number, shardCount: number): string {
  if (shardCount <= 1) return DEFAULT_LINK_CACHE;
  return DEFAULT_LINK_CACHE.replace(".cache.json", `${shardSuffix(shardIndex, shardCount)}.cache.json`);
}

/** Seed a new shard checkpoint from an existing single-worker run. */
export function loadShardCheckpoint(
  shardIndex: number,
  shardCount: number,
  resume: boolean,
): NcaaCheckpoint {
  const path = shardCheckpointPath(shardIndex, shardCount);
  if (!resume) return ensureCheckpoint(null);

  const existing = loadCheckpoint(path);
  if (existing) return ensureCheckpoint(existing);

  if (shardCount <= 1) return ensureCheckpoint(null);

  const legacy = loadCheckpoint(DEFAULT_CHECKPOINT);
  if (!legacy) return ensureCheckpoint(null);

  const completedSlugs = legacy.completedSlugs.filter((playerId) =>
    playerBelongsToShard(playerId, shardIndex, shardCount),
  );
  const checkpoint: NcaaCheckpoint = {
    version: 1,
    completedSlugs,
    allSlugs: legacy.allSlugs?.filter((playerId) =>
      playerBelongsToShard(playerId, shardIndex, shardCount),
    ),
    updatedAt: new Date().toISOString(),
  };
  saveCheckpoint(path, checkpoint);
  console.log(
    `[shard] Imported ${completedSlugs.length} completed player(s) from legacy checkpoint into shard ${shardLabel(shardIndex, shardCount)}`,
  );
  return checkpoint;
}

export function countShardPlayers(playerIds: string[], shardIndex: number, shardCount: number): number {
  return playerIds.filter((playerId) => playerBelongsToShard(playerId, shardIndex, shardCount)).length;
}
