import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  countShardPlayers,
  normalizeShardConfig,
  parseShardValue,
  playerBelongsToShard,
  shardCheckpointPath,
} from "../utils/shard.js";

describe("shard utils", () => {
  it("parses shard fraction syntax", () => {
    assert.deepEqual(parseShardValue("0/2"), { shardIndex: 0, shardCount: 2 });
    assert.deepEqual(parseShardValue("1/3"), { shardIndex: 1, shardCount: 3 });
  });

  it("assigns numeric player IDs deterministically", () => {
    assert.equal(playerBelongsToShard("362901", 1, 2), true);
    assert.equal(playerBelongsToShard("362901", 0, 2), false);
    assert.equal(playerBelongsToShard("377509", 1, 2), true);
  });

  it("partitions all players across shards", () => {
    const ids = ["100", "101", "102", "103", "104", "105"];
    const shard0 = ids.filter((id) => playerBelongsToShard(id, 0, 2));
    const shard1 = ids.filter((id) => playerBelongsToShard(id, 1, 2));
    assert.equal(shard0.length + shard1.length, ids.length);
    assert.deepEqual(shard0, ["100", "102", "104"]);
    assert.deepEqual(shard1, ["101", "103", "105"]);
  });

  it("builds shard-specific checkpoint paths", () => {
    assert.equal(
      shardCheckpointPath(1, 2),
      "scrape-ccaa-backfill.shard-1-of-2.checkpoint.json",
    );
  });

  it("counts shard membership", () => {
    assert.equal(countShardPlayers(["10", "11", "12", "13"], 0, 2), 2);
  });

  it("defaults to single-shard mode", () => {
    assert.deepEqual(normalizeShardConfig(undefined, undefined), {
      shardIndex: 0,
      shardCount: 1,
    });
  });
});
