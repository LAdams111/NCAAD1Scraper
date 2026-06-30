#!/usr/bin/env node
import { loadDiscoveryConfig } from "../config.js";
import { normalizeShardConfig, parseShardValue, shardLabel } from "../utils/shard.js";
import { runGlobalDiscovery, printGlobalDiscoverySummary } from "./globalDiscovery.js";

function printUsage(): void {
  console.log(`UsbasketGlobalDiscovery — collect all usbasket/eurobasket player IDs

Usage:
  npm run discover:global -- [options]

Options:
  --resume               Skip completed segment/season tasks (default)
  --fresh                Ignore checkpoint and rebuild shard cache from scratch
  --include-eurobasket   Also crawl eurobasket.com country player indexes
  --include-women        Also crawl women's indexes (?women=1)
  --segment <id>         Only crawl one segment (e.g. NCAA1, CCAA, Spain)
  --limit-tasks <n>      Cap index pages fetched (testing)
  --shard <n/total>      Parallel shard (e.g. 0/8)
  --shards <n>           Total shards (use with --shard n)
  --help                 Show this help

Output files:
  usbasket-global-player-ids.cache.json     All player IDs + segment metadata
  usbasket-global-player-slugs.cache.json   Flat ID list for backfill queues
  usbasket-global-discovery.checkpoint.json Resume state (per shard if sharded)

Examples:
  npm run discover:global -- --segment NCAA1 --limit-tasks 3
  npm run discover:global -- --resume
  npm run discover:global -- --include-eurobasket --shard 0/8 --resume
  npm run discover:global:merge
`);
}

function parseArgs(argv: string[]): {
  showHelp: boolean;
  resume: boolean;
  fresh: boolean;
  includeEurobasket: boolean;
  includeWomen: boolean;
  segmentFilter?: string;
  limitTasks?: number;
  shardIndex: number;
  shardCount: number;
} {
  let showHelp = false;
  let resume = true;
  let fresh = false;
  let includeEurobasket = false;
  let includeWomen = false;
  let segmentFilter: string | undefined;
  let limitTasks: number | undefined;
  let shardIndex: number | undefined;
  let shardCount: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        showHelp = true;
        break;
      case "--resume":
        resume = true;
        break;
      case "--fresh":
        fresh = true;
        resume = false;
        break;
      case "--include-eurobasket":
        includeEurobasket = true;
        break;
      case "--include-women":
        includeWomen = true;
        break;
      case "--segment": {
        const value = argv[++i];
        if (!value) throw new Error("--segment requires a value");
        segmentFilter = value.trim();
        break;
      }
      case "--limit-tasks": {
        const value = argv[++i];
        if (!value) throw new Error("--limit-tasks requires a value");
        limitTasks = Number.parseInt(value, 10);
        if (Number.isNaN(limitTasks) || limitTasks <= 0) {
          throw new Error(`Invalid --limit-tasks: ${value}`);
        }
        break;
      }
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
          throw new Error(`Invalid --shards: ${value}`);
        }
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (shardIndex != null && shardCount == null) {
    throw new Error("Use --shard n/total (e.g. 0/8) or pass both --shard and --shards");
  }
  if (shardCount != null && shardCount > 1 && shardIndex == null) {
    throw new Error("--shards requires --shard");
  }

  const shard = normalizeShardConfig(shardIndex, shardCount);

  return {
    showHelp,
    resume,
    fresh,
    includeEurobasket,
    includeWomen,
    segmentFilter,
    limitTasks,
    shardIndex: shard.shardIndex,
    shardCount: shard.shardCount,
  };
}

async function main(): Promise<void> {
  process.on("unhandledRejection", (reason) => {
    console.error("[discover] Unhandled rejection:", reason);
    process.exit(1);
  });
  process.on("uncaughtException", (error) => {
    console.error("[discover] Uncaught exception:", error);
    process.exit(1);
  });

  const args = parseArgs(process.argv.slice(2));

  if (args.showHelp) {
    printUsage();
    process.exit(0);
  }

  const config = loadDiscoveryConfig();

  console.log("UsbasketGlobalDiscovery");
  console.log(`USBasket login: ${config.usbasketCookie || config.usbasketEmail ? "yes" : "no"}`);
  if (args.shardCount > 1) {
    console.log(`Shard: ${shardLabel(args.shardIndex, args.shardCount)}`);
  }
  console.log("");

  const { summary } = await runGlobalDiscovery(config, args);
  printGlobalDiscoverySummary(summary);
  process.exit(summary.tasksFailed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
