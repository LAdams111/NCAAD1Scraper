import { readFileSync } from "node:fs";
import type { AppConfig } from "../config.js";
import { IngestClient } from "../ingestClient.js";
import {
  appendLog,
  markSlugComplete,
} from "../scrape/checkpoint.js";
import { loadShardCheckpoint } from "../utils/shard.js";
import {
  buildBioPayload,
  createLinkResolver,
  type LinkResolver,
} from "../scrape/linking.js";
import { parsePlayerBioFromHtml, isPlaceholderDisplayName } from "../scrape/playerMeta.js";
import { parseAllCareerYearByYearSeasons, parsePlayoffsBySeasonLabelFromPlayerHtml } from "../scrape/playerSeason.js";
import {
  UsbasketClient,
  UsbasketRateLimitError,
  playerUrl,
} from "../usbasketClient.js";
import {
  playerBelongsToShard,
  shardLabel,
} from "../utils/shard.js";
import type {
  CareerBackfillOptions,
  CareerBackfillSummary,
  CareerPlayerSeasonRecord,
  NcaaPlayerBio,
} from "../types.js";
import { CAREER_SOURCE } from "../types.js";
import {
  DEFAULT_CAREER_CHECKPOINT,
  DEFAULT_CAREER_LINK_CACHE,
  DEFAULT_CAREER_LOG,
} from "./constants.js";
import { loadCareerQueue, lookupQueueDisplayName, resolveCareerCachePaths } from "./queue.js";
import { buildCareerSeasonRecords, toCareerIngestPayload } from "./transform.js";
import { loadGlobalPlayerCache } from "../discover/globalCache.js";

function careerCheckpointPath(shardIndex: number, shardCount: number): string {
  if (shardCount <= 1) return DEFAULT_CAREER_CHECKPOINT;
  return DEFAULT_CAREER_CHECKPOINT.replace(
    ".checkpoint.json",
    `.shard-${shardIndex}-of-${shardCount}.checkpoint.json`,
  );
}

function careerLogPath(shardIndex: number, shardCount: number): string {
  if (shardCount <= 1) return DEFAULT_CAREER_LOG;
  return DEFAULT_CAREER_LOG.replace(".log", `.shard-${shardIndex}-of-${shardCount}.log`);
}

function careerLinkCachePath(shardIndex: number, shardCount: number): string {
  if (shardCount <= 1) return DEFAULT_CAREER_LINK_CACHE;
  return DEFAULT_CAREER_LINK_CACHE.replace(
    ".cache.json",
    `.shard-${shardIndex}-of-${shardCount}.cache.json`,
  );
}

async function fetchProfileHtml(
  client: UsbasketClient,
  options: CareerBackfillOptions,
  playerId: string,
  displayName: string,
): Promise<string> {
  if (options.useFixtures) {
    return readFileSync(`src/test/fixtures/player-${playerId}.html`, "utf8");
  }
  return client.fetchHtml(playerUrl(playerId, displayName.replace(/\s+/g, "-")));
}

async function ingestCareerRecords(
  ingest: IngestClient,
  options: CareerBackfillOptions,
  playerId: string,
  records: CareerPlayerSeasonRecord[],
  playerFields: { displayName: string },
  includeFgPct: boolean,
): Promise<{ ok: boolean; seasonRows: number; playerId?: number }> {
  if (records.length === 0) {
    return { ok: true, seasonRows: 0 };
  }

  let failures = 0;
  let hoopPlayerId: number | undefined;

  for (const record of records) {
    const payload = toCareerIngestPayload(record, playerFields, includeFgPct);

    if (options.dryRun) {
      console.log(JSON.stringify(payload, null, 2));
      continue;
    }

    try {
      const result = await ingest.sendPlayerSeason(payload);
      hoopPlayerId = result.playerId;
      console.log(
        `[season] ${playerId} ${record.seasonLabel} ${record.leagueSlug}/${record.teamSlug} → playerId=${result.playerId}`,
      );
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[season-fail] ${playerId} ${record.seasonLabel} ${record.leagueSlug}: ${message}`,
      );
    }
  }

  return {
    ok: failures === 0,
    seasonRows: records.length,
    playerId: hoopPlayerId,
  };
}

async function processCareerPlayer(
  client: UsbasketClient,
  ingest: IngestClient,
  options: CareerBackfillOptions,
  playerId: string,
  displayName: string,
  linkResolver: LinkResolver,
  includeFgPct: boolean,
): Promise<{
  ok: boolean;
  linked: boolean;
  seasonRows: number;
  routedSeasons: number;
  skippedRoutes: number;
  skipped?: boolean;
  playerId?: number;
}> {
  const html = await fetchProfileHtml(client, options, playerId, displayName);
  const bio: NcaaPlayerBio = parsePlayerBioFromHtml(html, playerId, displayName, null);
  const careerSeasons = parseAllCareerYearByYearSeasons(html);

  if (careerSeasons.length === 0) {
    console.log(`[skip] ${playerId} ${bio.displayName}: no career lines on profile`);
    return {
      ok: true,
      linked: false,
      seasonRows: 0,
      routedSeasons: 0,
      skippedRoutes: 0,
      skipped: true,
    };
  }

  console.log(
    `[profile] ${bio.displayName}: ${careerSeasons.length} career line(s) ` +
      `[${careerSeasons.map((s) => s.seasonLabel).join(", ")}]`,
  );

  const linkTarget = await linkResolver.resolveLinkTarget(
    playerId,
    bio.displayName,
    bio.birthDate,
    careerSeasons.map((season) => season.seasonLabel),
  );

  const shouldLinkOnly = options.enrichExisting && !options.createNewPlayers;
  if (shouldLinkOnly && !linkTarget) {
    console.log(`[skip] ${playerId} ${bio.displayName}: enrich-existing — no HC match`);
    return {
      ok: true,
      linked: false,
      seasonRows: 0,
      routedSeasons: 0,
      skippedRoutes: 0,
      skipped: true,
    };
  }

  const playoffsBySeasonLabel = parsePlayoffsBySeasonLabelFromPlayerHtml(html);

  const { records, skipped } = buildCareerSeasonRecords(playerId, bio.displayName, careerSeasons, {
    skipAuthoritativeSources: options.skipAuthoritativeSources,
    playoffsBySeasonLabel: playoffsBySeasonLabel.size ? playoffsBySeasonLabel : undefined,
  });

  if (records.length === 0) {
    console.log(`[skip] ${playerId} ${bio.displayName}: no ingestible seasons (${skipped} routed away)`);
    return {
      ok: true,
      linked: false,
      seasonRows: 0,
      routedSeasons: 0,
      skippedRoutes: skipped,
      skipped: true,
    };
  }

  const playerFields = { displayName: bio.displayName };
  const linkPayload = buildBioPayload(bio, linkTarget ?? undefined, CAREER_SOURCE);

  let linked = false;
  let hoopPlayerId: number | undefined;

  if (options.dryRun) {
    if (linkTarget) {
      console.log(
        `[dry-run] would link ${playerId} → ${linkTarget.source}:${linkTarget.externalId}`,
      );
    }
    console.log(`[dry-run] would ingest ${records.length} season(s)`);
    linked = Boolean(linkTarget);
  } else {
    const bioResult = await ingest.sendPlayerBio(linkPayload);
    hoopPlayerId = bioResult.playerId;
    linked =
      bioResult.linkedVia === "linkTo" ||
      bioResult.linkedVia === "fuzzy" ||
      bioResult.linkedVia === "identity";

    if (linkTarget) {
      linkResolver.rememberLink(playerId, linkTarget);
    }

    console.log(
      `[link] ${playerId} ${bio.displayName} → playerId=${bioResult.playerId} (${bioResult.linkedVia})`,
    );
  }

  const seasonResult = await ingestCareerRecords(
    ingest,
    options,
    playerId,
    records,
    playerFields,
    includeFgPct,
  );

  if (!options.dryRun && seasonResult.ok && seasonResult.seasonRows > 0) {
    const hoopId = seasonResult.playerId ?? hoopPlayerId ?? "?";
    console.log(
      `[done] ${bio.displayName}: ${seasonResult.seasonRows} season(s) → playerId=${hoopId}` +
        (linked ? " (linked)" : ""),
    );
    appendLog(
      options.logPath,
      `OK ${playerId}: ${bio.displayName} → playerId=${hoopId} (${seasonResult.seasonRows} seasons${linked ? ", linked" : ""})`,
    );
  }

  return {
    ok: seasonResult.ok,
    linked,
    seasonRows: seasonResult.seasonRows,
    routedSeasons: records.length,
    skippedRoutes: skipped,
    playerId: seasonResult.playerId ?? hoopPlayerId,
  };
}

export async function runCareerBackfill(
  config: AppConfig,
  options: CareerBackfillOptions,
): Promise<{ summary: CareerBackfillSummary }> {
  const cachePaths = resolveCareerCachePaths(options);
  const checkpointPath =
    options.checkpointPath || careerCheckpointPath(options.shardIndex, options.shardCount);
  const logPath = options.logPath || careerLogPath(options.shardIndex, options.shardCount);
  const linkCachePath =
    options.linkCachePath || careerLinkCachePath(options.shardIndex, options.shardCount);

  const client = new UsbasketClient(
    options.requestDelayMs,
    options.requestDelayMs,
    config.usbasketCookie,
  );

  if (!options.useFixtures) {
    await client.ensureLoggedIn(config.usbasketEmail, config.usbasketPassword);
  }

  const ingest = new IngestClient(config.hoopCentralApiUrl, config.ingestApiKey);

  let checkpoint = loadShardCheckpoint(
    options.shardIndex,
    options.shardCount,
    options.resume && !options.fresh,
  );

  const queue = loadCareerQueue(cachePaths);
  if (!queue.length && !options.playerSlug) {
    throw new Error(
      `No player IDs found. Run npm run discover:global first, or pass --player-slug.`,
    );
  }

  const playerCache = loadGlobalPlayerCache(cachePaths.playerCachePath);

  let allIds = options.playerSlug ? [options.playerSlug] : queue.map((entry) => entry.playerId);

  const shardIds =
    options.shardCount > 1
      ? allIds.filter((id) => playerBelongsToShard(id, options.shardIndex, options.shardCount))
      : allIds;

  const pending = shardIds.filter((id) => !checkpoint.completedSlugs.includes(id));
  const toProcess = options.limit ? pending.slice(0, options.limit) : pending;

  const linkResolver = createLinkResolver({
    linkCachePath,
    source: CAREER_SOURCE,
    loadCompletionStatus: async (source) => {
      const status = await ingest.getCompletionStatus(source);
      return status.players;
    },
  });

  const summary: CareerBackfillSummary = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: shardIds.length - pending.length,
    linked: 0,
    seasonRows: 0,
    routedSeasons: 0,
    skippedRoutes: 0,
  };

  console.log(
    `\n=== Career backfill === ${toProcess.length} to process` +
      (options.limit ? ` (limit ${options.limit})` : "") +
      (options.shardCount > 1
        ? ` · shard ${shardLabel(options.shardIndex, options.shardCount)} (${shardIds.length} in shard)`
        : "") +
      ` · ${allIds.length} total IDs · ${shardIds.length - pending.length} already done` +
      (options.enrichExisting ? " · enrich-existing" : "") +
      `\n`,
  );

  for (const playerId of toProcess) {
    summary.processed += 1;
    const displayName = lookupQueueDisplayName(queue, playerCache, playerId);
    const label = isPlaceholderDisplayName(displayName) ? `Player-${playerId}` : displayName;
    console.log(`[${summary.processed}/${toProcess.length}] ${label} (${playerId})`);

    try {
      const result = await processCareerPlayer(
        client,
        ingest,
        { ...options, logPath, checkpointPath, linkCachePath },
        playerId,
        displayName,
        linkResolver,
        config.includeFgPct,
      );

      if (result.ok) {
        summary.succeeded += 1;
        summary.seasonRows += result.seasonRows;
        summary.routedSeasons += result.routedSeasons;
        summary.skippedRoutes += result.skippedRoutes;
        if (!options.dryRun && (result.seasonRows > 0 || result.skipped)) {
          markSlugComplete(checkpoint, playerId, checkpointPath);
        }
      } else {
        summary.failed += 1;
        appendLog(logPath, `FAIL ${playerId}`);
      }
      if (result.linked) summary.linked += 1;
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      appendLog(logPath, `FAIL ${playerId}: ${message}`);
      console.error(`[error] ${playerId}: ${message}`);

      if (error instanceof UsbasketRateLimitError) {
        console.error("");
        console.error("Stopping career backfill — usbasket rate limit reached.");
        console.error("Wait 1–2 hours, then rerun with --resume.");
        break;
      }
    }
  }

  return { summary };
}

export function printCareerSummary(summary: CareerBackfillSummary, dryRun: boolean): void {
  console.log("");
  console.log("=== Career backfill summary ===");
  console.log(`Processed:      ${summary.processed}`);
  console.log(`Succeeded:      ${summary.succeeded}`);
  console.log(`Failed:         ${summary.failed}`);
  console.log(`Skipped:        ${summary.skipped} (checkpoint / no match / no data)`);
  console.log(`Linked:         ${summary.linked}`);
  console.log(`Season rows:    ${summary.seasonRows}`);
  console.log(`Routed seasons: ${summary.routedSeasons}`);
  console.log(`Skipped routes: ${summary.skippedRoutes} (NBA/G League authoritative skips)`);
  if (dryRun) {
    console.log("");
    console.log("Dry run — no data was POSTed to Hoop Central.");
  }
}
