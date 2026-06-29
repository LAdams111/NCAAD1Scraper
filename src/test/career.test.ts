import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAllCareerYearByYearSeasons } from "../scrape/playerSeason.js";
import { routeLeagueTag, normalizeCareerTeam } from "../career/leagueRoutes.js";
import { buildCareerSeasonRecords } from "../career/transform.js";

describe("career league routing", () => {
  it("routes NCAA and high school tags", () => {
    assert.equal(routeLeagueTag("NCAA").leagueSlug, "ncaa");
    assert.equal(routeLeagueTag("NCAA2").leagueSlug, "ncaa-d2");
    assert.equal(routeLeagueTag("CCAA").leagueSlug, "ccaa");
    assert.equal(routeLeagueTag("CIS").leagueSlug, "u-sports");
    assert.equal(routeLeagueTag("High School").leagueSlug, "high-school");
  });

  it("skips authoritative NBA and G League by default", () => {
    assert.equal(routeLeagueTag("NBA").skip, true);
    assert.equal(routeLeagueTag("G-League").skip, true);
    assert.equal(routeLeagueTag("NBA", { skipAuthoritativeSources: false }).skip, false);
  });

  it("creates dynamic league slugs for unknown tags", () => {
    const route = routeLeagueTag("Germany-ProA");
    assert.equal(route.skip, false);
    assert.equal(route.leagueSlug, "germany-proa");
  });

  it("routes pre-seeded international leagues from usbasket tag variants", () => {
    assert.equal(routeLeagueTag("Australia-NBL").leagueSlug, "nbl");
    assert.equal(routeLeagueTag("Australia-NBL").leagueName, "NBL Australia");
    assert.equal(routeLeagueTag("EuroLeague").leagueSlug, "euroleague");
    assert.equal(routeLeagueTag("BAL").leagueSlug, "bal");
    assert.equal(routeLeagueTag("CBA").leagueSlug, "cba");
    assert.equal(routeLeagueTag("B-League").leagueSlug, "b-league");
  });

  it("normalizes team slugs consistently for the same school", () => {
    const a = normalizeCareerTeam("St. Vincent-St. Mary", "high-school");
    const b = normalizeCareerTeam("St. Vincent-St. Mary", "high-school");
    assert.equal(a.slug, b.slug);
  });
});

describe("career profile parsing", () => {
  it("parses all career lines from Brandon Ellis fixture", () => {
    const html = readFileSync("src/test/fixtures/player-career-brandon-ellis.html", "utf8");
    const seasons = parseAllCareerYearByYearSeasons(html);
    assert.ok(seasons.length >= 8);
    assert.ok(seasons.some((s) => s.leagueText.includes("CCAA")));
    assert.ok(seasons.some((s) => s.leagueText.includes("CIS")));
    assert.ok(seasons.some((s) => s.leagueText.includes("Germany-ProA")));
  });

  it("builds routed ingest records and skips NBA when configured", () => {
    const html = readFileSync("src/test/fixtures/player-career-brandon-ellis.html", "utf8");
    const seasons = parseAllCareerYearByYearSeasons(html);
    const { records, skipped } = buildCareerSeasonRecords("17016", "Brandon Ellis", seasons);
    assert.ok(records.length >= 6);
    assert.ok(records.every((r) => r.source === "usbasket-profile"));
    assert.ok(records.some((r) => r.leagueSlug === "ccaa"));
    assert.ok(records.some((r) => r.leagueSlug === "u-sports"));
    assert.equal(skipped, 0);
  });

  it("uses zero gamesPlayed when career line omits game count", () => {
    const html =
      'Year-By-Year Career <b>1999-2000:</b> St. Vincent-St. Mary HS of Akron(Ohio): 18.1 ppg, 6.1 rpg, 3.8 apg profile-head';
    const seasons = parseAllCareerYearByYearSeasons(html);
    const hs = seasons.find((s) => s.seasonLabel === "1999-00");
    assert.ok(hs);
    assert.equal(hs.gamesPlayed, 0);
    assert.equal(hs.pointsPerGame, 18.1);
  });

  it("parses explicit game counts from career lines", () => {
    const html =
      "Year-By-Year Career <b>2023-2024:</b> Lakers(NBA): 71 games, 25.7 ppg, 7.8 rpg, 8.3 apg profile-head";
    const seasons = parseAllCareerYearByYearSeasons(html);
    assert.equal(seasons[0]?.gamesPlayed, 71);
  });

  it("parses high school slash-format career lines without league parentheses", () => {
    const html =
      "Year-By-Year Career <b>2018-2019:</b> Atlanta, GA / Holy Spirit Preparatory School: 29ppg, 9rpg profile-head";
    const seasons = parseAllCareerYearByYearSeasons(html);
    assert.equal(seasons.length, 1);
    assert.equal(seasons[0]?.seasonLabel, "2018-19");
    assert.equal(seasons[0]?.teamName, "Holy Spirit Preparatory School");
    assert.equal(seasons[0]?.leagueText, "High School");
    assert.equal(seasons[0]?.pointsPerGame, 29);
    assert.equal(seasons[0]?.reboundsPerGame, 9);
    assert.equal(seasons[0]?.assistsPerGame, 0);
  });

  it("parses AAU career lines without assists per game", () => {
    const html =
      "Year-By-Year Career <b>2018:</b> Atlanta XPress (GA) (UAA U17): 21ppg, 6.1rpg profile-head";
    const seasons = parseAllCareerYearByYearSeasons(html);
    assert.equal(seasons.length, 1);
    assert.equal(seasons[0]?.teamName, "Atlanta XPress");
    assert.equal(seasons[0]?.pointsPerGame, 21);
    assert.equal(seasons[0]?.reboundsPerGame, 6.1);
  });
});
