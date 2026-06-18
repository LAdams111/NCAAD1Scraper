import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStrDataFromHtml } from "../usbasketClient.js";
import {
  indexRowToSeasonRow,
  parseNcaaSeasonFromStatsHtml,
  parseSeasonRowsFromIndexData,
  parseSeasonRowsFromPlayerHtml,
} from "../scrape/playerSeason.js";
import {
  parsePlayerBioFromHtml,
  parseUsbasketBirthDate,
} from "../scrape/playerMeta.js";
import { matchBdlExternalId, buildBdlLookup, isPlausibleCollegeAge, matchExternalId } from "../scrape/linking.js";
import { normalizeSeasonLabel, calcPct } from "../utils/season.js";

describe("season utils", () => {
  it("normalizes usbasket season labels", () => {
    assert.equal(normalizeSeasonLabel("2025-2026"), "2025-26");
    assert.equal(normalizeSeasonLabel("2014-2015"), "2014-15");
  });

  it("calculates shooting percentages", () => {
    assert.equal(calcPct(5, 10), 50);
    assert.equal(calcPct(0, 0), null);
  });
});

describe("index parsing", () => {
  it("parses strData from index HTML fixture snippet", () => {
    const snippet = readFileSync("src/test/fixtures/index-snippet.html", "utf8");
    const rows = parseStrDataFromHtml(snippet);
    assert.ok(rows);
    assert.ok(rows.length >= 2);

    const acuff = rows.find((r) => r.PLAYERID === "736073");
    assert.ok(acuff);
    assert.equal(acuff.PLAYERNAME, "Acuff Darius");

    const season = indexRowToSeasonRow(acuff, "2025-26");
    assert.ok(season);
    assert.equal(season.teamName, "Arkansas");
    assert.equal(season.gamesPlayed, 36);
    assert.equal(season.fieldGoalPct, calcPct(5.5, 10.8));
    assert.equal(season.threePointPct, calcPct(2.5, 5.8));
  });

  it("builds player-season rows from index data", () => {
    const snippet = readFileSync("src/test/fixtures/index-snippet.html", "utf8");
    const rows = parseStrDataFromHtml(snippet);
    assert.ok(rows);
    const parsed = parseSeasonRowsFromIndexData(rows!, "2025-26");
    const acuff = parsed.find((p) => p.playerId === "736073");
    assert.ok(acuff);
    assert.equal(acuff.displayName, "Darius Acuff");
  });
});

describe("player page parsing", () => {
  it("parses AVERAGES row from player fixture", () => {
    const html = readFileSync("src/test/fixtures/player-736073.html", "utf8");
    const seasons = parseSeasonRowsFromPlayerHtml(html);
    assert.ok(seasons.length >= 1);
    const current = seasons[0];
    assert.equal(current.seasonLabel, "2025-26");
    assert.equal(current.pointsPerGame, 23.5);
    assert.equal(current.reboundsPerGame, 3.1);
    assert.equal(current.assistsPerGame, 6.4);
  });

  it("parses PlayerStatsAjax NCAA fragment (AVERAGE header)", () => {
    const fragment = readFileSync("src/test/fixtures/player-stats-ajax-2012.html", "utf8");
    const season = parseNcaaSeasonFromStatsHtml(fragment);
    assert.ok(season);
    assert.equal(season.seasonLabel, "2011-12");
    assert.equal(season.teamName, "Duke");
    assert.equal(season.gamesPlayed, 36);
    assert.equal(season.pointsPerGame, 13.2);
  });
});

describe("player bio parsing", () => {
  it("parses birthDate and hometown from player fixture", () => {
    const html = readFileSync("src/test/fixtures/player-736073.html", "utf8");
    const bio = parsePlayerBioFromHtml(html, "736073", "Darius Acuff", "G");
    assert.equal(bio.birthDate, "2006-11-16");
    assert.equal(bio.displayName, "Darius Acuff");
    assert.equal(bio.hometown, "Detroit, MI");
    assert.equal(bio.heightCm, 188);
    assert.equal(bio.weightKg, 82);
  });

  it("normalizes usbasket birth date strings", () => {
    assert.equal(parseUsbasketBirthDate("Nov.16, 2006"), "2006-11-16");
    assert.equal(parseUsbasketBirthDate("November 16 2006"), "2006-11-16");
  });

  it("matches BallDontLie candidates by name and birthDate", () => {
    const lookup = buildBdlLookup([
      {
        playerId: 1,
        externalId: "123",
        displayName: "Darius Acuff",
        birthDate: "2006-11-16",
        seasons: [],
      },
      {
        playerId: 2,
        externalId: "999",
        displayName: "Darius Acuff",
        birthDate: "2000-01-01",
        seasons: [],
      },
    ]);
    assert.equal(matchBdlExternalId("Darius Acuff", "2006-11-16", lookup), "123");
    assert.equal(matchBdlExternalId("Darius Acuff", null, lookup), null);
  });

  it("rejects cross-source link when only name matches wrong era", () => {
    const lookup = buildBdlLookup([
      {
        playerId: 7302,
        externalId: "46392457",
        displayName: "Chris Cooper",
        birthDate: "1926-09-29",
        seasons: [],
      },
    ]);
    assert.equal(
      matchExternalId("Chris Cooper", null, lookup, ["2010-11", "2011-12"]),
      null,
    );
    assert.ok(isPlausibleCollegeAge("1990-01-17", ["2010-11", "2011-12"]));
    assert.ok(!isPlausibleCollegeAge("1926-09-29", ["2010-11", "2011-12"]));
  });
});
