#!/usr/bin/env node
import { BACKFILL_PLAYER_DELAY_MS, loadConfig } from "../config.js";
import {
  normalizeShardConfig,
  parseShardValue,
  shardLabel,
} from "../utils/shard.js";
import {
  DEFAULT_CAREER_PLAYER_CACHE,
  DEFAULT_CAREER_SLUG_CACHE,
} from "./constants.js";
import { printCareerSummary, runCareerBackfill } from "./runner.js";
import type { CareerBackfillOptions } from "../types.js";

function printUsage(): void {
  console.log(`CareerHub — usbasket profile careers → Hoop Central

Usage:
  npm run career:backfill -- [options]

Prerequisites:
  npm run discover:global   (builds usbasket-global-player-slugs.cache.json)

Options:
  --backfill             Process players from global ID cache (required)
  --enrich-existing      Skip players with no existing HC match (unless --create-new)
  --create-new           Create HC players when no match (default for career:backfill)
  --include-authoritative  Ingest NBA/G League lines from usbasket (default: skip)
  --dry-run              Log payloads without POSTing
  --resume               Skip player IDs in checkpoint (default with --backfill)
  --fresh                Ignore checkpoint
  --limit <n>            Cap players processed
  --player-slug <id>     Single player test
  --shard <n/total>      Parallel shard (e.g. 0/8)
  --shards <n>           Total shards
  --health               Check Hoop Central health and exit
  --fixtures             Use local HTML fixtures
  --help                 Show this help

Examples:
  npm run career:dry-run -- --player-slug 66630
  npm run career:backfill -- --player-slug 66630 --fresh
  npm run career:enrich -- --resume --limit 10
  npm run career:backfill -- --shard 0/4 --resume
`);
}

function parseArgs(argv: string[]): CareerBackfillOptions & { showHelp: boolean; health: boolean } {
  let backfill = false;
  let dryRun = false;
  let resume = true;
  let fresh = false;
  let health = false;
  let useFixtures = false;
  let enrichExisting = false;
  let createNewPlayers = true;
  let skipAuthoritativeSources = true;
  let limit: number | undefined;
  let playerSlug: string | undefined;
  let shardIndex: number | undefined;
  let shardCount: number | undefined;
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
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--resume":
        resume = true;
        break;
      case "--fresh":
        fresh = true;
        resume = false;
        break;
      case "--health":
        health = true;
        break;
      case "--fixtures":
        useFixtures = true;
        break;
      case "--enrich-existing":
        enrichExisting = true;
        createNewPlayers = false;
        break;
      case "--create-new":
        createNewPlayers = true;
        break;
      case "--include-authoritative":
        skipAuthoritativeSources = false;
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
        break;
      }
      case "--limit": {
        const value = argv[++i];
        if (!value) throw new Error("--limit requires a value");
        limit = Number.parseInt(value, 10);
        break;
      }
      case "--player-slug": {
        const value = argv[++i];
        if (!value) throw new Error("--player-slug requires a value");
        playerSlug = value.trim();
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (shardIndex != null && shardCount == null) {
    throw new Error("Use --shard n/total (e.g. 0/8) or pass both --shard and --shards");
  }

  const shard = normalizeShardConfig(shardIndex, shardCount);

  if (!showHelp && !backfill && !playerSlug && !health) {
    showHelp = true;
  }

  return {
    backfill,
    dryRun,
    resume: fresh ? false : resume,
    fresh,
    useFixtures,
    enrichExisting,
    createNewPlayers,
    skipAuthoritativeSources,
    limit,
    playerSlug,
    requestDelayMs: BACKFILL_PLAYER_DELAY_MS,
    checkpointPath: "",
    logPath: "",
    slugCachePath: DEFAULT_CAREER_SLUG_CACHE,
    playerCachePath: DEFAULT_CAREER_PLAYER_CACHE,
    linkCachePath: "",
    shardIndex: shard.shardIndex,
    shardCount: shard.shardCount,
    showHelp,
    health,
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
    const { IngestClient } = await import("../ingestClient.js");
    const ingest = new IngestClient(config.hoopCentralApiUrl, config.ingestApiKey);
    const health = await ingest.healthCheck();
    console.log(`Hoop Central: ${config.hoopCentralApiUrl}`);
    console.log(`Health: ${health.ok ? "ok" : "failed"} (HTTP ${health.status})`);
    process.exit(health.ok ? 0 : 1);
  }

  console.log("CareerHub backfill");
  console.log(`Target: ${config.hoopCentralApiUrl}`);
  console.log(`Mode: ${args.dryRun ? "dry-run" : "live ingest"}`);
  const ingestMode = args.enrichExisting
    ? args.createNewPlayers
      ? "enrich-existing + create-new"
      : "enrich-existing only"
    : "create-new (link to BDL when matched)";
  console.log(`Ingest: ${ingestMode}`);
  if (args.shardCount > 1) {
    console.log(`Shard: ${shardLabel(args.shardIndex, args.shardCount)}`);
  }
  console.log("");

  const { summary } = await runCareerBackfill(config, args);
  printCareerSummary(summary, args.dryRun);
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
