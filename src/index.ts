#!/usr/bin/env node
import {
  DEFAULT_SEASON_CACHE,
  DEFAULT_SLUG_CACHE,
  NCAA_LEAGUE_NAME,
  NCAA_USBASKET_SEGMENT,
} from "./division.js";
import {
  BACKFILL_INDEX_DELAY_MS,
  BACKFILL_PLAYER_DELAY_MS,
  loadConfig,
} from "./config.js";
import { IngestClient } from "./ingestClient.js";
import { printSummary, runScrape } from "./scrape/runner.js";
import type { ScrapeOptions } from "./types.js";
import { DEFAULT_TEAM_CACHE } from "./scrape/teamCache.js";
import {
  normalizeShardConfig,
  parseShardValue,
  shardCheckpointPath,
  shardLabel,
  shardLinkCachePath,
  shardLogPath,
} from "./utils/shard.js";

function printUsage(): void {
  console.log(`CCAAScraper — usbasket.com ${NCAA_USBASKET_SEGMENT} → Hoop Central (${NCAA_LEAGUE_NAME})

Usage:
  npm run scrape -- [options]

Options:
  --backfill             Crawl usbasket CCAA index (all seasons) and ingest all players
  --dry-run              Parse and log payloads; do not POST
  --resume               Skip player IDs in checkpoint file (default with --backfill)
  --fresh                Ignore checkpoint and reprocess all
  --limit <n>            Cap players processed (testing)
  --player-slug <id>     Single player test (usbasket player ID)
  --rediscover           Re-crawl CCAA index and refresh season cache (shard 0 only)
  --discover-only        Crawl index, save cache, and exit (shard 0 only)
  --delay <ms>           Override request delay (default from .env)
  --shard <n>            Shard index (use with --shards, or pass n/total e.g. 0/2)
  --shards <n>           Total parallel shards (default: 1)
  --health               Check Hoop Central health and exit
  --fixtures             Use local HTML fixtures (tests only)
  --help                 Show this help

Examples:
  npm run scrape:dry-run -- --player-slug <id>
  npm run scrape -- --player-slug <id>
  npm run test:build
  npm run scrape:backfill -- --resume --limit 5
  npm run scrape:backfill:shard0 -- --resume
  npm run scrape:backfill:shard1 -- --resume
`);
}

function parseArgs(argv: string[]): Omit<ScrapeOptions, "requestDelayMs" | "indexDelayMs"> & {
  showHelp: boolean;
  health: boolean;
  requestDelayMs?: number;
  indexDelayMs?: number;
} {
  let backfill = false;
  let dryRun = false;
  let resume = false;
  let fresh = false;
  let health = false;
  let useFixtures = false;
  let limit: number | undefined;
  let playerSlug: string | undefined;
  let requestDelayMs: number | undefined;
  let showHelp = false;
  let shardIndex: number | undefined;
  let shardCount: number | undefined;
  let rediscover = false;
  let discoverOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        showHelp = true;
        break;
      case "--backfill":
        backfill = true;
        resume = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--resume":
        resume = true;
        break;
      case "--fresh":
        fresh = true;
        break;
      case "--health":
        health = true;
        break;
      case "--fixtures":
        useFixtures = true;
        break;
      case "--shard": {
        const value = argv[++i];
        if (!value) throw new Error("--shard requires a value");
        const parsed = parseShardValue(value);
        shardIndex = parsed.shardIndex;
        if (parsed.shardCount > 0) shardCount = parsed.shardCount;
        break;
      }
      case "--shards": {
        const value = argv[++i];
        if (!value) throw new Error("--shards requires a value");
        shardCount = Number.parseInt(value, 10);
        if (Number.isNaN(shardCount) || shardCount <= 0) {
          throw new Error(`Invalid --shards value: ${value}`);
        }
        break;
      }
      case "--limit": {
        const value = argv[++i];
        if (!value) throw new Error("--limit requires a value");
        limit = Number.parseInt(value, 10);
        if (Number.isNaN(limit) || limit <= 0) throw new Error(`Invalid limit: ${value}`);
        break;
      }
      case "--player-slug": {
        const value = argv[++i];
        if (!value) throw new Error("--player-slug requires a value");
        playerSlug = value.trim();
        break;
      }
      case "--rediscover":
        rediscover = true;
        backfill = true;
        resume = true;
        break;
      case "--discover-only":
        discoverOnly = true;
        backfill = true;
        resume = false;
        break;
      case "--delay": {
        const value = argv[++i];
        if (!value) throw new Error("--delay requires a value");
        requestDelayMs = Number.parseInt(value, 10);
        if (Number.isNaN(requestDelayMs) || requestDelayMs < 0) {
          throw new Error(`Invalid delay: ${value}`);
        }
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!showHelp && !backfill && !playerSlug && !health) {
    showHelp = true;
  }

  if (shardIndex != null && shardCount == null) {
    throw new Error("Use --shard n/total (e.g. 0/2) or pass both --shard and --shards");
  }
  if (shardCount != null && shardCount > 1 && shardIndex == null) {
    throw new Error("--shards requires --shard");
  }

  const shard = normalizeShardConfig(shardIndex, shardCount);

  return {
    backfill,
    dryRun,
    resume: fresh ? false : resume,
    useFixtures,
    health,
    limit,
    playerSlug,
    requestDelayMs,
    indexDelayMs: undefined,
    checkpointPath: shardCheckpointPath(shard.shardIndex, shard.shardCount),
    logPath: shardLogPath(shard.shardIndex, shard.shardCount),
    slugCachePath: DEFAULT_SLUG_CACHE,
    seasonCachePath: DEFAULT_SEASON_CACHE,
    teamCachePath: DEFAULT_TEAM_CACHE,
    linkCachePath: shardLinkCachePath(shard.shardIndex, shard.shardCount),
    shardIndex: shard.shardIndex,
    shardCount: shard.shardCount,
    rediscover,
    discoverOnly,
    showHelp,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.showHelp) {
    printUsage();
    process.exit(0);
  }

  const config = loadConfig();

  if (args.health) {
    const ingest = new IngestClient(config.hoopCentralApiUrl, config.ingestApiKey);
    const health = await ingest.healthCheck();
    console.log(`Hoop Central: ${config.hoopCentralApiUrl}`);
    console.log(`Health: ${health.ok ? "ok" : "failed"} (HTTP ${health.status})`);
    process.exit(health.ok ? 0 : 1);
  }

  const {
    showHelp: _showHelp,
    health: _health,
    requestDelayMs: cliDelay,
    indexDelayMs: _cliIndexDelay,
    ...rest
  } = args;

  const scrapeOptions: ScrapeOptions = {
    ...rest,
    requestDelayMs:
      cliDelay ??
      (rest.backfill
        ? Math.min(config.requestDelayMs, BACKFILL_PLAYER_DELAY_MS)
        : config.requestDelayMs),
    indexDelayMs: rest.backfill
      ? Math.min(config.indexDelayMs, BACKFILL_INDEX_DELAY_MS)
      : config.indexDelayMs,
  };

  console.log("Starting CCAAScraper");
  console.log(`Target: ${config.hoopCentralApiUrl}`);
  console.log(`Mode: ${args.dryRun ? "dry-run" : "live ingest"}`);
  if (scrapeOptions.shardCount > 1) {
    console.log(`Shard: ${shardLabel(scrapeOptions.shardIndex, scrapeOptions.shardCount)}`);
  }
  console.log("");

  const { summary } = await runScrape(config, scrapeOptions);

  printSummary(summary, args.dryRun);
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
