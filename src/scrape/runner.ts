import { readFileSync } from "node:fs";
import { NCAA_LEAGUE_NAME, NCAA_USBASKET_SEGMENT } from "../division.js";
import type { AppConfig } from "../config.js";
import { IngestClient } from "../ingestClient.js";
import { toIngestPayload } from "../transform.js";
import type {
  CachedPlayerSeasons,
  HoopCentralIngestPayload,
  NcaaPlayerBio,
  ScrapeOptions,
  ScrapeSummary,
} from "../types.js";
import {
  UsbasketClient,
  UsbasketRateLimitError,
  playerUrl,
} from "../usbasketClient.js";
import {
  appendLog,
  markSlugComplete,
  saveCheckpointSlugs,
} from "./checkpoint.js";
import {
  DEFAULT_SEASON_CACHE,
  discoverAllPlayers,
  fetchIndexSeasonsForPlayer,
  emptySeasonCache,
  loadSeasonCache,
  lookupFirstIndexSeasonForPlayer,
  lookupPlayerMetaFromIndex,
  resolvePlayerFromIndex,
  saveSeasonCache,
} from "./discovery.js";
import { buildBioPayload, createLinkResolver, type LinkResolver } from "./linking.js";
import { parsePlayerBioFromHtml, isPlaceholderDisplayName } from "./playerMeta.js";
import { filterValidUsportsSeasons, isValidUsportsTeamName } from "../utils/usportsTeams.js";
import {
  buildRecordsFromSeasonRows,
  collectAllNcaaSeasons,
  mergeSeasonRows,
} from "./playerSeason.js";
import { loadSlugCache, saveSlugCache } from "./slugCache.js";
import type { NcaaSeasonRow } from "../types.js";
import {
  loadShardCheckpoint,
  playerBelongsToShard,
  shardLabel,
} from "../utils/shard.js";

function formatSeasonLabels(seasons: NcaaSeasonRow[]): string {
  return seasons.map((season) => season.seasonLabel).join(", ");
}

async function fetchPlayerHtml(
  client: UsbasketClient,
  options: ScrapeOptions,
  playerId: string,
  displayName: string,
): Promise<string> {
  if (options.useFixtures) {
    return readFileSync(`src/test/fixtures/player-${playerId}.html`, "utf8");
  }

  return client.fetchHtml(playerUrl(playerId, displayName.replace(/\s+/g, "-")));
}

async function ingestSeasonRecords(
  ingest: IngestClient,
  options: ScrapeOptions,
  playerId: string,
  records: ReturnType<typeof buildRecordsFromSeasonRows>,
  playerFields: HoopCentralIngestPayload["player"],
  includeFgPct: boolean,
): Promise<{ ok: boolean; seasonRows: number; playerId?: number }> {
  if (records.length === 0) {
    console.warn(`[skip] ${playerId}: no stat rows`);
    return { ok: true, seasonRows: 0 };
  }

  let failures = 0;
  let hoopPlayerId: number | undefined;

  for (const record of records) {
    const payload = toIngestPayload(record, playerFields, includeFgPct);

    if (options.dryRun) {
      console.log(JSON.stringify(payload, null, 2));
      continue;
    }

    try {
      const result = await ingest.sendPlayerSeason(payload);
      hoopPlayerId = result.playerId;
      console.log(
        `[season] ${playerId} ${record.seasonLabel} ${record.teamAbbreviation} → playerId=${result.playerId}`,
      );
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[season-fail] ${playerId} ${record.seasonLabel}: ${message}`);
    }
  }

  return {
    ok: failures === 0,
    seasonRows: records.length,
    playerId: hoopPlayerId,
  };
}

function resolveDisplayName(
  cacheName: string | undefined,
  bioName: string,
): string {
  if (cacheName && !isPlaceholderDisplayName(cacheName)) return cacheName;
  return bioName;
}

function filterUsportsSeasonRows(
  seasons: NcaaSeasonRow[],
  playerId: string,
  displayName: string,
): NcaaSeasonRow[] {
  const valid = filterValidUsportsSeasons(seasons);
  for (const season of seasons) {
    if (isValidUsportsTeamName(season.teamName)) continue;
    console.log(
      `[skip-team] ${playerId} ${displayName}: ${season.teamName} (${season.seasonLabel}) not a CCAA school`,
    );
  }
  return valid;
}

async function processPlayer(
  client: UsbasketClient,
  ingest: IngestClient,
  options: ScrapeOptions,
  playerId: string,
  cacheEntry: CachedPlayerSeasons["players"][string] | undefined,
  linkResolver: LinkResolver,
  includeFgPct: boolean,
  seasonCache?: CachedPlayerSeasons | null,
): Promise<{ ok: boolean; linked: boolean; seasonRows: number; playerId?: number; skipped?: boolean }> {
  const displayName = cacheEntry?.displayName ?? `Player-${playerId}`;
  let indexSeasons = cacheEntry?.seasons ?? [];

  let bio: NcaaPlayerBio;
  let mergedSeasons = mergeSeasonRows(indexSeasons);

  if (options.backfill && cacheEntry) {
    const html = await fetchPlayerHtml(client, options, playerId, displayName);

    bio = parsePlayerBioFromHtml(
      html,
      playerId,
      cacheEntry.displayName,
      cacheEntry.position ?? null,
    );

    const profileSeasons = await collectAllNcaaSeasons(client, playerId, html);
    mergedSeasons = mergeSeasonRows(indexSeasons, profileSeasons);

    if (mergedSeasons.length === 0) {
      if (options.backfill) {
        const hit = await lookupFirstIndexSeasonForPlayer(client, playerId);
        if (hit) {
          indexSeasons = [hit.season];
          console.log(
            `[index] ${playerId}: roster ${hit.season.seasonLabel} @ ${hit.season.teamName}`,
          );
        }
      } else {
        indexSeasons = await fetchIndexSeasonsForPlayer(client, playerId);
        if (indexSeasons.length) {
          console.log(`[index] ${playerId}: found ${indexSeasons.length} roster season(s) on index`);
        }
      }
      mergedSeasons = mergeSeasonRows(indexSeasons, profileSeasons);
    }

    if (seasonCache && options.seasonCachePath) {
      seasonCache.players[playerId] = {
        displayName: bio.displayName,
        position: bio.position,
        seasons: mergedSeasons,
      };
      saveSeasonCache(options.seasonCachePath, seasonCache);
    }

    if (mergedSeasons.length > 0) {
      const source =
        indexSeasons.length > 0 && profileSeasons.length > 0
          ? "index+profile"
          : indexSeasons.length > 0
            ? "index"
            : "profile";
      console.log(
        `[player] ${bio.displayName}: ${mergedSeasons.length} season(s) from ${source}` +
          ` [${formatSeasonLabels(mergedSeasons)}]`,
      );
    }
  } else {
    const html = await fetchPlayerHtml(client, options, playerId, displayName);

    bio = parsePlayerBioFromHtml(
      html,
      playerId,
      cacheEntry?.displayName,
      cacheEntry?.position ?? null,
    );

    const profileSeasons = await collectAllNcaaSeasons(client, playerId, html);
    mergedSeasons = mergeSeasonRows(indexSeasons, profileSeasons);

    // During backfill, discovery already scanned every season index — never re-fetch all 20.
    if (mergedSeasons.length === 0 && !options.backfill) {
      console.log(`[index] ${playerId}: no NCAA seasons on profile — scanning season indexes...`);
      indexSeasons = await fetchIndexSeasonsForPlayer(client, playerId);
      mergedSeasons = mergeSeasonRows(indexSeasons, profileSeasons);
      if (indexSeasons.length) {
        console.log(`[index] ${playerId}: found ${indexSeasons.length} season(s) on index`);
      }
    } else if (profileSeasons.length > indexSeasons.length) {
      console.log(
        `[profile] ${bio.displayName} (${playerId}): ${indexSeasons.length} index + ` +
          `${profileSeasons.length} profile → ${mergedSeasons.length} merged` +
          (mergedSeasons.length ? ` [${formatSeasonLabels(mergedSeasons)}]` : ""),
      );
    } else if (mergedSeasons.length > 0) {
      console.log(
        `[player] ${bio.displayName}: ${mergedSeasons.length} season(s)` +
          ` [${formatSeasonLabels(mergedSeasons)}]`,
      );
    }
  }

  mergedSeasons = filterUsportsSeasonRows(mergedSeasons, playerId, bio.displayName);
  mergedSeasons = mergeSeasonRows(mergedSeasons);

  if (seasonCache && options.seasonCachePath && seasonCache.players[playerId]) {
    seasonCache.players[playerId].seasons = mergedSeasons;
    saveSeasonCache(options.seasonCachePath, seasonCache);
  }

  if (mergedSeasons.length === 0) {
    console.log(`[skip] ${playerId} ${bio.displayName}: no CCAA seasons`);
    return { ok: true, linked: false, seasonRows: 0, skipped: true };
  }

  const resolvedName = resolveDisplayName(cacheEntry?.displayName, bio.displayName);

  // Stats-only ingest: never send scraped or cached bio fields to Hoop Central.
  const playerFields: HoopCentralIngestPayload["player"] = {
    displayName: resolvedName,
  };

  let linked = false;
  let hoopPlayerId: number | undefined;

  const linkTarget = await linkResolver.resolveLinkTarget(
    playerId,
    bio.displayName,
    bio.birthDate,
    mergedSeasons.map((season) => season.seasonLabel),
  );

  const linkPayload = buildBioPayload(bio, linkTarget ?? undefined);

  if (options.dryRun) {
    if (linkTarget) {
      console.log(
        `[dry-run] would link ${playerId} → ${linkTarget.source}:${linkTarget.externalId}`,
      );
    } else {
      console.log(`[dry-run] would resolve or create profile for ${playerId} (stats only, no bio)`);
    }
    console.log(JSON.stringify(linkPayload, null, 2));
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

  const records = buildRecordsFromSeasonRows(
    playerId,
    resolvedName,
    mergedSeasons,
  );

  const seasonResult = await ingestSeasonRecords(
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
      `[done] ${playerFields.displayName}: ${seasonResult.seasonRows} season(s) → playerId=${hoopId}` +
        (linked ? " (linked)" : ""),
    );
    appendLog(
      options.logPath,
      `OK ${playerId}: ${playerFields.displayName} → playerId=${hoopId} (${seasonResult.seasonRows} seasons${linked ? ", linked" : ""})`,
    );
  }

  return {
    ok: seasonResult.ok,
    linked,
    seasonRows: seasonResult.seasonRows,
    playerId: seasonResult.playerId ?? hoopPlayerId,
  };
}

export async function runScrape(
  config: AppConfig,
  options: ScrapeOptions,
): Promise<{ summary: ScrapeSummary }> {
  const client = new UsbasketClient(
    options.requestDelayMs,
    options.indexDelayMs,
    config.usbasketCookie,
  );

  if (!options.useFixtures) {
    await client.ensureLoggedIn(config.usbasketEmail, config.usbasketPassword);
  }

  const ingest = new IngestClient(config.hoopCentralApiUrl, config.ingestApiKey);

  if (options.backfill) {
    console.log(
      `[usbasket] Pacing: ${options.requestDelayMs}ms between player requests, ` +
        `${options.indexDelayMs}ms between index seasons (+ jitter).`,
    );
    console.log("");
  }

  let checkpoint = loadShardCheckpoint(
    options.shardIndex,
    options.shardCount,
    options.resume,
  );

  let seasonCache = loadSeasonCache(options.seasonCachePath);
  let slugs: string[];

  if (options.playerSlug) {
    if (
      options.shardCount > 1 &&
      !playerBelongsToShard(options.playerSlug, options.shardIndex, options.shardCount)
    ) {
      throw new Error(
        `Player ${options.playerSlug} is not assigned to shard ${shardLabel(options.shardIndex, options.shardCount)}`,
      );
    }
    slugs = [options.playerSlug];
  } else if (options.backfill) {
    const cachedSlugs =
      loadSlugCache(options.slugCachePath) ?? checkpoint.allSlugs ?? null;

    if (!seasonCache || !cachedSlugs?.length) {
      if (options.shardCount > 1 && options.shardIndex !== 0) {
        throw new Error(
          `Shard ${shardLabel(options.shardIndex, options.shardCount)}: index cache missing. ` +
            "Start shard 0/2 first and wait for index discovery to finish, then start other shards.",
        );
      }
      console.log(`Crawling usbasket ${NCAA_USBASKET_SEGMENT} index (all seasons) → ${NCAA_LEAGUE_NAME}...`);
      try {
        const discovered = await discoverAllPlayers(client);
        seasonCache = discovered.cache;
        slugs = discovered.slugs;
        saveSeasonCache(options.seasonCachePath || DEFAULT_SEASON_CACHE, seasonCache);
        saveSlugCache(options.slugCachePath, slugs);
        checkpoint = saveCheckpointSlugs(checkpoint, slugs, options.checkpointPath);
      } catch (error) {
        if (error instanceof UsbasketRateLimitError) {
          console.error("");
          console.error("Stopping — usbasket rate limit reached during index crawl.");
          console.error("Wait 1–2 hours, then rerun with --resume.");
          throw error;
        }
        throw error;
      }
    } else {
      console.log(`Using saved ${NCAA_USBASKET_SEGMENT} slug index (${cachedSlugs.length} players).`);
      slugs = cachedSlugs;
      if (!seasonCache) {
        throw new Error(
          `Missing ${options.seasonCachePath} — rerun without --resume or delete checkpoint to rediscover.`,
        );
      }
    }
  } else {
    throw new Error("Either --player-slug or --backfill is required");
  }

  const shardSlugs =
    options.shardCount > 1
      ? slugs.filter((slug) =>
          playerBelongsToShard(slug, options.shardIndex, options.shardCount),
        )
      : slugs;

  const pending = shardSlugs.filter((slug) => !checkpoint.completedSlugs.includes(slug));
  const ordered =
    options.backfill && seasonCache
      ? [...pending].sort((a, b) => {
          const aSeasons = seasonCache!.players[a]?.seasons.length ?? 0;
          const bSeasons = seasonCache!.players[b]?.seasons.length ?? 0;
          if (bSeasons !== aSeasons) return bSeasons - aSeasons;
          return a.localeCompare(b, undefined, { numeric: true });
        })
      : pending;
  const toProcess = options.limit ? ordered.slice(0, options.limit) : ordered;

  if (options.playerSlug) {
    if (!seasonCache) seasonCache = emptySeasonCache();
    if (!seasonCache.players[options.playerSlug]) {
      console.log(`[index] Looking up player ${options.playerSlug} on season index...`);
      const meta = await lookupPlayerMetaFromIndex(client, options.playerSlug);
      if (meta) {
        seasonCache.players[options.playerSlug] = {
          ...meta,
          seasons: [],
        };
        console.log(`[index] Found ${meta.displayName}`);
      } else {
        console.warn(
          `[index] Player ${options.playerSlug} not found on index — profile fetch may fail`,
        );
      }
    }
  }

  const linkResolver = createLinkResolver({
    linkCachePath: options.linkCachePath,
    loadCompletionStatus: async (source) => {
      const status = await ingest.getCompletionStatus(source);
      return status.players;
    },
  });

  const summary: ScrapeSummary = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: shardSlugs.length - pending.length,
    linked: 0,
    seasonRows: 0,
  };

  console.log(
    `\n=== Players === ${toProcess.length} to process` +
      (options.limit ? ` (limit ${options.limit})` : "") +
      (options.shardCount > 1
        ? ` · shard ${shardLabel(options.shardIndex, options.shardCount)} (${shardSlugs.length} in shard)`
        : "") +
      ` · ${slugs.length} total in index · ${shardSlugs.length - pending.length} already done ===\n`,
  );

  for (const playerId of toProcess) {
    summary.processed += 1;
    const cacheEntry = seasonCache?.players[playerId];
    const playerLabel =
      cacheEntry?.displayName && !isPlaceholderDisplayName(cacheEntry.displayName)
        ? cacheEntry.displayName
        : `Player-${playerId}`;
    console.log(`[${summary.processed}/${toProcess.length}] ${playerLabel} (${playerId})`);

    try {
      const result = await processPlayer(
        client,
        ingest,
        options,
        playerId,
        cacheEntry,
        linkResolver,
        config.includeFgPct,
        seasonCache,
      );

      if (result.ok) {
        summary.succeeded += 1;
        summary.seasonRows += result.seasonRows;
        if (!options.dryRun && result.seasonRows > 0) {
          markSlugComplete(checkpoint, playerId, options.checkpointPath);
        }
      } else {
        summary.failed += 1;
        appendLog(options.logPath, `FAIL ${playerId}`);
      }
      if (result.linked) summary.linked += 1;
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      appendLog(options.logPath, `FAIL ${playerId}: ${message}`);
      console.error(`[error] ${playerId}: ${message}`);

      if (error instanceof UsbasketRateLimitError) {
        console.error("");
        console.error("Stopping backfill — usbasket rate limit reached.");
        console.error("Wait 1–2 hours, then rerun with --resume.");
        break;
      }
    }
  }

  return { summary };
}

export function printSummary(summary: ScrapeSummary, dryRun: boolean): void {
  console.log("");
  console.log("=== Summary ===");
  console.log(`Processed: ${summary.processed}`);
  console.log(`Succeeded: ${summary.succeeded}`);
  console.log(`Failed:    ${summary.failed}`);
  console.log(`Skipped:   ${summary.skipped} (already in checkpoint)`);
  console.log(`Linked:    ${summary.linked}`);
  console.log(`Season rows: ${summary.seasonRows}`);
  if (dryRun) {
    console.log("");
    console.log("Dry run — no data was POSTed to Hoop Central.");
  }
}
