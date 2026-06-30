import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePlayersFromIndexHtml } from "../usbasketClient.js";
import {
  mergeDiscoveredPlayer,
  countGlobalCacheStats,
  emptyGlobalPlayerCache,
} from "../discover/globalCache.js";
import {
  buildDiscoveryTasks,
  type DiscoveryTask,
} from "../discover/globalDiscovery.js";
import {
  parseEurobasketCountriesFromHtml,
  resolveDiscoverSegments,
  segmentKey,
  taskKey,
  USBASKET_MENS_SEGMENTS,
} from "../discover/segments.js";
import {
  emptyYearParamsCache,
  getCachedYearParams,
  setCachedYearParams,
} from "../discover/yearParamsCache.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("global discovery segments", () => {
  it("builds stable task keys", () => {
    const segment = USBASKET_MENS_SEGMENTS.find((s) => s.id === "NCAA1");
    assert.ok(segment);
    assert.equal(taskKey(segment!, "2024", false), "usbasket:NCAA1:2024");
    assert.equal(taskKey(segment!, "2024", true), "usbasket:NCAA1:women:2024");
  });

  it("parses eurobasket countries from navigation HTML", () => {
    const html =
      '<a href="https://www.eurobasket.com/Spain/basketball.aspx">Spain</a>' +
      '<a href="https://www.eurobasket.com/Germany/basketball.aspx">Germany</a>';
    const countries = parseEurobasketCountriesFromHtml(html);
    assert.deepEqual(
      countries.map((c) => c.id),
      ["Germany", "Spain"],
    );
  });

  it("filters segments by exact segment id", () => {
    const segments = resolveDiscoverSegments({ includeEurobasket: false, segmentFilter: "CCAA" });
    assert.equal(segments.length, 1);
    assert.equal(segments[0]?.id, "CCAA");
  });
});

describe("global discovery cache", () => {
  it("merges player IDs across segments without duplicating", () => {
    const cache = emptyGlobalPlayerCache();
    assert.equal(mergeDiscoveredPlayer(cache, "123", "LeBron James", "usbasket:NBA", "strData"), true);
    assert.equal(mergeDiscoveredPlayer(cache, "123", "LeBron James", "usbasket:NCAA1", "html"), true);
    assert.equal(mergeDiscoveredPlayer(cache, "123", "LeBron James", "usbasket:NCAA1", "html"), false);
    assert.equal(Object.keys(cache.players).length, 1);
    assert.deepEqual(cache.players["123"]?.segments, ["usbasket:NBA", "usbasket:NCAA1"]);
  });

  it("counts cache stats", () => {
    const cache = emptyGlobalPlayerCache();
    mergeDiscoveredPlayer(cache, "1", "Named Player", "usbasket:NBA", "strData");
    mergeDiscoveredPlayer(cache, "2", "", "usbasket:NBA", "html");
    const stats = countGlobalCacheStats(cache);
    assert.equal(stats.players, 2);
    assert.equal(stats.withName, 1);
    assert.equal(stats.bySegment["usbasket:NBA"], 2);
  });
});

describe("global discovery tasks", () => {
  it("builds segment × season tasks", () => {
    const segment = USBASKET_MENS_SEGMENTS.find((s) => s.id === "CCAA");
    assert.ok(segment);
    const yearParamsBySegment = new Map([[segmentKey(segment!, false), ["2024", "2023"]]]);
    const tasks = buildDiscoveryTasks({
      segments: [segment!],
      yearParamsBySegment,
      includeWomen: false,
    });
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0]?.key, "usbasket:CCAA:2024");
  });
});

describe("global discovery year params cache", () => {
  it("persists resolved season params incrementally", () => {
    const dir = mkdtempSync(join(tmpdir(), "discover-years-"));
    const path = join(dir, "year-params.cache.json");
    const cache = emptyYearParamsCache();

    setCachedYearParams(cache, path, "usbasket:NCAA1", ["2024", "2023"]);
    assert.deepEqual(getCachedYearParams(cache, "usbasket:NCAA1"), ["2024", "2023"]);
    assert.equal(getCachedYearParams(cache, "usbasket:NBA"), null);

    const reloaded = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(reloaded.segments["usbasket:NCAA1"], ["2024", "2023"]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("eurobasket player link parsing", () => {
  it("parses basketball.eurobasket.com profile links", () => {
    const html =
      '<a href="https://basketball.eurobasket.com/player/gasol-pau/12345">Pau Gasol</a>';
    const players = parsePlayersFromIndexHtml(html);
    assert.equal(players.length, 1);
    assert.equal(players[0]?.playerId, "12345");
  });
});

describe("discovery task sharding", () => {
  it("distributes tasks evenly across shards", () => {
    const tasks: DiscoveryTask[] = Array.from({ length: 8 }, (_, i) => ({
      segment: USBASKET_MENS_SEGMENTS[0]!,
      yearParam: String(2000 + i),
      women: false,
      key: `task-${i}`,
    }));

    const shard0 = tasks.filter((_, index) => index % 4 === 0);
    const shard1 = tasks.filter((_, index) => index % 4 === 1);
    assert.equal(shard0.length, 2);
    assert.equal(shard1.length, 2);
  });
});
