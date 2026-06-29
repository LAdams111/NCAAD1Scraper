import type { AppConfig } from "../config.js";
import {
  listSeasonYearParams,
  parsePlayersFromIndexHtml,
  UsbasketClient,
  UsbasketRateLimitError,
} from "../usbasketClient.js";
import { shardLabel } from "../utils/shard.js";
import {
  globalDiscoveryCheckpointPath,
  globalPlayerCachePath,
  globalSlugCachePath,
  isTaskComplete,
  loadGlobalDiscoveryCheckpoint,
  markTaskComplete,
  saveGlobalDiscoveryCheckpoint,
  type GlobalDiscoveryCheckpoint,
} from "./checkpoint.js";
import {
  countGlobalCacheStats,
  loadGlobalPlayerCache,
  mergeDiscoveredPlayer,
  saveGlobalPlayerCache,
  saveGlobalSlugCache,
  type GlobalPlayerCache,
} from "./globalCache.js";
import {
  FALLBACK_YEAR_PARAMS,
  parseEurobasketCountriesFromHtml,
  resolveDiscoverSegments,
  segmentKey,
  taskKey,
  type DiscoverSegment,
} from "./segments.js";

export interface GlobalDiscoveryOptions {
  resume: boolean;
  fresh: boolean;
  includeEurobasket: boolean;
  includeWomen: boolean;
  segmentFilter?: string;
  limitTasks?: number;
  shardIndex: number;
  shardCount: number;
  playerCachePath?: string;
  slugCachePath?: string;
  checkpointPath?: string;
}

export interface GlobalDiscoverySummary {
  tasksTotal: number;
  tasksRun: number;
  tasksSkipped: number;
  tasksFailed: number;
  newPlayers: number;
  totalPlayers: number;
  elapsedMs: number;
}

export interface DiscoveryTask {
  segment: DiscoverSegment;
  yearParam: string;
  women: boolean;
  key: string;
}

function taskBelongsToShard(taskIndex: number, shardIndex: number, shardCount: number): boolean {
  if (shardCount <= 1) return true;
  return taskIndex % shardCount === shardIndex;
}

export function buildDiscoveryTasks(options: {
  segments: DiscoverSegment[];
  yearParamsBySegment: Map<string, string[]>;
  includeWomen: boolean;
}): DiscoveryTask[] {
  const tasks: DiscoveryTask[] = [];

  for (const segment of options.segments) {
    const segKey = segmentKey(segment, false);
    const years =
      options.yearParamsBySegment.get(segKey) ??
      options.yearParamsBySegment.get(segment.id) ??
      [...FALLBACK_YEAR_PARAMS];

    for (const yearParam of years) {
      tasks.push({
        segment,
        yearParam,
        women: false,
        key: taskKey(segment, yearParam, false),
      });

      if (options.includeWomen) {
        tasks.push({
          segment,
          yearParam,
          women: true,
          key: taskKey(segment, yearParam, true),
        });
      }
    }
  }

  return tasks;
}

async function resolveYearParamsForSegment(
  client: UsbasketClient,
  segment: DiscoverSegment,
): Promise<string[]> {
  const bootstrapYear = segment.host === "usbasket" ? "2024" : "2024";
  try {
    const html = await client.fetchHtml(
      client.segmentIndexUrl(segment.id, bootstrapYear, { host: segment.host }),
      8,
      true,
    );
    const years = listSeasonYearParams(html);
    return years.length ? years : [...FALLBACK_YEAR_PARAMS];
  } catch {
    return [...FALLBACK_YEAR_PARAMS];
  }
}

function ingestIndexPage(
  cache: GlobalPlayerCache,
  html: string,
  segment: DiscoverSegment,
  women: boolean,
  strDataRows: Array<{ PLAYERID: string; PLAYERNAME: string }> | null,
): number {
  const seg = segmentKey(segment, women);
  let added = 0;

  if (strDataRows?.length) {
    for (const row of strDataRows) {
      const playerId = row.PLAYERID?.trim();
      if (!playerId) continue;
      if (
        mergeDiscoveredPlayer(cache, playerId, row.PLAYERNAME, seg, "strData")
      ) {
        added += 1;
      }
    }
  }

  const linkPlayers = parsePlayersFromIndexHtml(html);
  for (const { playerId, playerName } of linkPlayers) {
    if (mergeDiscoveredPlayer(cache, playerId, playerName, seg, "html")) {
      added += 1;
    }
  }

  return added;
}

export async function runGlobalDiscovery(
  config: AppConfig,
  options: GlobalDiscoveryOptions,
): Promise<{ summary: GlobalDiscoverySummary; cache: GlobalPlayerCache }> {
  const started = Date.now();
  const playerCachePath =
    options.playerCachePath ?? globalPlayerCachePath(options.shardIndex, options.shardCount);
  const slugCachePath =
    options.slugCachePath ?? globalSlugCachePath(options.shardIndex, options.shardCount);
  const checkpointPath =
    options.checkpointPath ??
    globalDiscoveryCheckpointPath(options.shardIndex, options.shardCount);

  const client = new UsbasketClient(
    config.requestDelayMs,
    config.indexDelayMs,
    config.usbasketCookie,
  );
  await client.ensureLoggedIn(config.usbasketEmail, config.usbasketPassword);

  let eurobasketCountries: DiscoverSegment[] = [];
  if (options.includeEurobasket) {
    console.log("[discover] Loading EuroBasket country list...");
    const bootstrapHtml = await client.fetchHtml(
      "https://www.eurobasket.com/Spain/basketball-Players.aspx?Year=2024",
      8,
      true,
    );
    eurobasketCountries = parseEurobasketCountriesFromHtml(bootstrapHtml);
    console.log(`[discover] Found ${eurobasketCountries.length} EuroBasket countries`);
  }

  const segments = resolveDiscoverSegments({
    includeEurobasket: options.includeEurobasket,
    eurobasketCountries,
    segmentFilter: options.segmentFilter,
  });

  if (!segments.length) {
    throw new Error("No discovery segments matched the current filters");
  }

  console.log(`[discover] Segments to crawl: ${segments.length}`);

  const yearParamsBySegment = new Map<string, string[]>();
  for (const segment of segments) {
    const years = await resolveYearParamsForSegment(client, segment);
    yearParamsBySegment.set(segmentKey(segment, false), years);
    console.log(`[discover] ${segmentKey(segment, false)}: ${years.length} season(s)`);
  }

  const allTasks = buildDiscoveryTasks({
    segments,
    yearParamsBySegment,
    includeWomen: options.includeWomen,
  });

  const shardTasks = allTasks.filter((_, index) =>
    taskBelongsToShard(index, options.shardIndex, options.shardCount),
  );

  let checkpoint: GlobalDiscoveryCheckpoint =
    options.fresh || !options.resume
      ? { version: 1, completedTasks: [], updatedAt: new Date().toISOString() }
      : (loadGlobalDiscoveryCheckpoint(checkpointPath) ?? {
          version: 1,
          completedTasks: [],
          updatedAt: new Date().toISOString(),
        });

  const cache =
    options.fresh || !options.resume
      ? { version: 1 as const, players: {}, updatedAt: new Date().toISOString() }
      : (loadGlobalPlayerCache(playerCachePath) ?? {
          version: 1 as const,
          players: {},
          updatedAt: new Date().toISOString(),
        });

  const initialCount = Object.keys(cache.players).length;
  let tasksRun = 0;
  let tasksSkipped = 0;
  let tasksFailed = 0;
  let newPlayers = 0;

  console.log(
    `[discover] Tasks: ${shardTasks.length} on shard ${shardLabel(options.shardIndex, options.shardCount)} ` +
      `(${allTasks.length} total)`,
  );
  console.log(`[discover] Cache: ${initialCount} known player ID(s)`);
  console.log("");

  for (const task of shardTasks) {
    if (options.limitTasks != null && tasksRun >= options.limitTasks) {
      console.log(`[discover] Reached --limit-tasks ${options.limitTasks}`);
      break;
    }

    if (isTaskComplete(checkpoint, task.key)) {
      tasksSkipped += 1;
      continue;
    }

    const label = task.key;
    console.log(`[discover] ${label}`);

    try {
      const { html, rows } = await client.fetchSegmentSeasonIndex(
        task.segment.id,
        task.yearParam,
        { women: task.women, host: task.segment.host },
      );

      const before = Object.keys(cache.players).length;
      const added = ingestIndexPage(cache, html, task.segment, task.women, rows);
      const after = Object.keys(cache.players).length;
      newPlayers += after - before;

      console.log(
        `[discover]   +${added} merge(s), ${rows?.length ?? 0} strData row(s), ` +
          `${parsePlayersFromIndexHtml(html).length} link(s), total=${after}`,
      );

      markTaskComplete(checkpoint, task.key);
      saveGlobalDiscoveryCheckpoint(checkpointPath, checkpoint);
      saveGlobalPlayerCache(playerCachePath, cache);
      tasksRun += 1;
    } catch (error) {
      if (error instanceof UsbasketRateLimitError) throw error;
      tasksFailed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[discover]   failed: ${message}`);
    }
  }

  const playerIds = Object.keys(cache.players);
  saveGlobalSlugCache(slugCachePath, playerIds);

  const stats = countGlobalCacheStats(cache);
  const summary: GlobalDiscoverySummary = {
    tasksTotal: shardTasks.length,
    tasksRun,
    tasksSkipped,
    tasksFailed,
    newPlayers,
    totalPlayers: stats.players,
    elapsedMs: Date.now() - started,
  };

  console.log("");
  console.log("[discover] Complete");
  console.log(`  Tasks run:     ${summary.tasksRun}`);
  console.log(`  Tasks skipped: ${summary.tasksSkipped}`);
  console.log(`  Tasks failed:  ${summary.tasksFailed}`);
  console.log(`  Player IDs:    ${summary.totalPlayers} (${summary.newPlayers} new this run)`);
  console.log(`  Named:         ${stats.withName}`);
  console.log(`  Cache file:    ${playerCachePath}`);
  console.log(`  Slug file:     ${slugCachePath}`);
  console.log(`  Elapsed:       ${Math.round(summary.elapsedMs / 1000)}s`);

  return { summary, cache };
}

export function printGlobalDiscoverySummary(summary: GlobalDiscoverySummary): void {
  console.log("");
  console.log("=== Global discovery summary ===");
  console.log(`Tasks run:     ${summary.tasksRun}`);
  console.log(`Tasks skipped: ${summary.tasksSkipped}`);
  console.log(`Tasks failed:  ${summary.tasksFailed}`);
  console.log(`Player IDs:    ${summary.totalPlayers}`);
  console.log(`New this run:  ${summary.newPlayers}`);
}
