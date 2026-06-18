#!/usr/bin/env node
import {
  BACKFILL_INDEX_DELAY_MS,
  BACKFILL_PLAYER_DELAY_MS,
  DEFAULT_PLAYER_DELAY_MS,
  loadConfig,
} from "./config.js";
import { IngestClient } from "./ingestClient.js";
import {
  DEFAULT_CHECKPOINT,
  DEFAULT_LOG,
} from "./scrape/checkpoint.js";
import { DEFAULT_SEASON_CACHE } from "./scrape/discovery.js";
import { DEFAULT_NCAA_LINK_CACHE } from "./scrape/linkCache.js";
import { printSummary, runScrape } from "./scrape/runner.js";
import { DEFAULT_SLUG_CACHE } from "./scrape/slugCache.js";
import { DEFAULT_TEAM_CACHE } from "./scrape/teamCache.js";
import type { ScrapeOptions } from "./types.js";

function printUsage(): void {
  console.log(`NCAAD1Scraper — usbasket.com NCAA D1 → Hoop Central season stats

Usage:
  npm run scrape -- [options]

Options:
  --backfill             Crawl usbasket NCAA index (all seasons) and ingest all players
  --dry-run              Parse and log payloads; do not POST
  --resume               Skip player IDs in checkpoint file (default with --backfill)
  --fresh                Ignore checkpoint and reprocess all
  --limit <n>            Cap players processed (testing)
  --player-slug <id>     Single player test (usbasket player ID, e.g. 736073)
  --delay <ms>           Override request delay (default: 12000)
  --health               Check Hoop Central health and exit
  --fixtures             Use local HTML fixtures (tests only)
  --help                 Show this help

Examples:
  npm run scrape:dry-run -- --player-slug 736073
  npm run scrape -- --player-slug 736073
  npm run test:build
  npm run scrape:backfill -- --resume --limit 5
`);
}

function parseArgs(argv: string[]): ScrapeOptions & { showHelp: boolean; health: boolean } {
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
        requestDelayMs = requestDelayMs ?? BACKFILL_PLAYER_DELAY_MS;
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

  return {
    backfill,
    dryRun,
    resume: fresh ? false : resume,
    useFixtures,
    health,
    limit,
    playerSlug,
    requestDelayMs:
      requestDelayMs ?? (backfill ? BACKFILL_PLAYER_DELAY_MS : DEFAULT_PLAYER_DELAY_MS),
    indexDelayMs: BACKFILL_INDEX_DELAY_MS,
    checkpointPath: DEFAULT_CHECKPOINT,
    logPath: DEFAULT_LOG,
    slugCachePath: DEFAULT_SLUG_CACHE,
    seasonCachePath: DEFAULT_SEASON_CACHE,
    teamCachePath: DEFAULT_TEAM_CACHE,
    linkCachePath: DEFAULT_NCAA_LINK_CACHE,
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

  const { showHelp: _showHelp, health: _health, ...scrapeOptions } = args;

  console.log("Starting NCAAD1Scraper");
  console.log(`Target: ${config.hoopCentralApiUrl}`);
  console.log(`Mode: ${args.dryRun ? "dry-run" : "live ingest"}`);
  console.log("");

  const { summary } = await runScrape(config, scrapeOptions);

  printSummary(summary, args.dryRun);
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
