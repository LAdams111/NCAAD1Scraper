import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStrDataFromHtml } from "../usbasketClient.js";
import {
  indexRowToSeasonRow,
  parseNcaaSeasonFromStatsHtml,
  parseCareerYearByYearSeasons,
  createZeroStatSeasonRow,
  indexRowToPlaceholderSeasonRow,
  mergeSeasonRows,
  parseSeasonRowsFromIndexData,
  parseSeasonRowsFromPlayerHtml,
  parsePlayoffStatsFromStatsHtml,
  parsePlayoffsBySeasonLabelFromPlayerHtml,
  isExcludedCcaaLeagueLabel,
  statsBlockMatchesCcaaLeague,
} from "../scrape/playerSeason.js";
import {
  parsePlayerBioFromHtml,
  parseUsbasketBirthDate,
} from "../scrape/playerMeta.js";
import { matchBdlExternalId, buildBdlLookup, isPlausibleCollegeAge, matchExternalId } from "../scrape/linking.js";
import { normalizeSeasonLabel, calcPct } from "../utils/season.js";
import { normalizeUsportsTeam, isValidUsportsTeamName, isNonCcaaTeamLabel } from "../utils/usportsTeams.js";

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
    const seasons = parseSeasonRowsFromPlayerHtml(html, "NCAA1");
    assert.ok(seasons.length >= 1);
    const current = seasons[0];
    assert.equal(current.seasonLabel, "2025-26");
    assert.equal(current.pointsPerGame, 23.5);
    assert.equal(current.reboundsPerGame, 3.1);
    assert.equal(current.assistsPerGame, 6.4);
  });

  it("parses PlayerStatsAjax NCAA fragment (AVERAGE header)", () => {
    const fragment = readFileSync("src/test/fixtures/player-stats-ajax-2012.html", "utf8");
    const season = parseNcaaSeasonFromStatsHtml(fragment, "NCAA1");
    assert.ok(season);
    assert.equal(season.seasonLabel, "2011-12");
    assert.equal(season.teamName, "Duke");
    assert.equal(season.gamesPlayed, 36);
    assert.equal(season.pointsPerGame, 13.2);
    assert.equal(season.threePointPct, 39.8);
    assert.equal(season.freeThrowPct, 87.5);
  });

  it("parses playoff averages from a stats block", () => {
    const fragment = readFileSync("src/test/fixtures/player-stats-playoffs.html", "utf8");
    const playoffs = parsePlayoffStatsFromStatsHtml(fragment);
    assert.ok(playoffs);
    assert.equal(playoffs.gamesPlayed, 5);
    assert.equal(playoffs.pointsPerGame, 25.7);
    assert.equal(playoffs.reboundsPerGame, 7.6);
    assert.equal(playoffs.assistsPerGame, 8.8);
    assert.equal(playoffs.fieldGoalPct, 56);
    assert.equal(playoffs.threePointPct, 37.5);
    assert.equal(playoffs.freeThrowPct, 68.4);
  });

  it("indexes playoff stats by season label on profile pages", () => {
    const fragment = readFileSync("src/test/fixtures/player-stats-playoffs.html", "utf8");
    const playoffsBySeason = parsePlayoffsBySeasonLabelFromPlayerHtml(fragment);
    assert.equal(playoffsBySeason.size, 1);
    const playoffs = playoffsBySeason.get("2023-24");
    assert.ok(playoffs);
    assert.equal(playoffs.gamesPlayed, 5);
  });

  it("parses CCAA stats labeled (NAIA) with my_pStats1 averages", () => {
    const fragment = readFileSync("src/test/fixtures/player-stats-ccaa-2024.html", "utf8");
    const season = parseNcaaSeasonFromStatsHtml(fragment);
    assert.ok(season);
    assert.equal(season.seasonLabel, "2024-25");
    assert.equal(season.teamName, "Keyano");
    assert.equal(season.gamesPlayed, 3);
    assert.equal(season.pointsPerGame, 2.7);
    assert.equal(season.reboundsPerGame, 2.7);
  });

  it("builds placeholder season rows from CCAA index rows with Games=0", () => {
    const row = {
      PLAYERID: "734991",
      PLAYERNAME: "Aaron Josiah",
      TEAMNAME: "Keyano",
      Games: "0",
      PTS: "0",
      REBT: "0",
      AS: "0",
      ST: "0",
      BS: "0",
      FGPM2: "0",
      FGPA2: "0",
      FGPM3: "0",
      FGPA3: "0",
    };
    const placeholder = indexRowToPlaceholderSeasonRow(row, "2023-24");
    assert.ok(placeholder);
    assert.equal(placeholder?.teamName, "Keyano");
    assert.equal(placeholder?.gamesPlayed, 0);
    assert.equal(placeholder?.pointsPerGame, 0);
  });

  it("prefers real stats over zero-stat placeholders when merging", () => {
    const merged = mergeSeasonRows(
      [createZeroStatSeasonRow("Keyano", "2024-25")],
      [
        {
          seasonLabel: "2024-25",
          teamName: "Keyano",
          teamAbbreviation: "KEY",
          gamesPlayed: 3,
          pointsPerGame: 2.7,
          reboundsPerGame: 2.7,
          assistsPerGame: 0,
          stealsPerGame: 0,
          blocksPerGame: 0.3,
          fieldGoalPct: 100,
          threePointPct: 0,
          freeThrowPct: null,
        },
      ],
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.gamesPlayed, 3);
    assert.equal(merged[0]?.pointsPerGame, 2.7);
  });

  it("parses CCAA Year-By-Year Career lines on profile pages", () => {
    const fragment = readFileSync("src/test/fixtures/player-career-brandon-ellis.html", "utf8");
    const seasons = parseCareerYearByYearSeasons(fragment, "CCAA");
    assert.equal(seasons.length, 2);
    assert.deepEqual(
      seasons.map((season) => ({
        seasonLabel: season.seasonLabel,
        teamName: season.teamName,
        pointsPerGame: season.pointsPerGame,
      })),
      [
        { seasonLabel: "1999-00", teamName: "Vanier College", pointsPerGame: 20 },
        { seasonLabel: "2000-01", teamName: "Vanier College", pointsPerGame: 37 },
      ],
    );
  });

  it("parses the last Year-By-Year career line before Awards markup", () => {
    const fragment = readFileSync("src/test/fixtures/player-career-mullett.html", "utf8");
    const seasons = parseCareerYearByYearSeasons(fragment, "CCAA");
    assert.equal(seasons.length, 2);
    assert.deepEqual(
      seasons.map((season) => ({
        seasonLabel: season.seasonLabel,
        teamName: season.teamName,
      })),
      [
        { seasonLabel: "2023-24", teamName: "Holland College" },
        { seasonLabel: "2024-25", teamName: "Holland College" },
      ],
    );
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
    assert.equal(parseUsbasketBirthDate("Dec.9, 1996"), "1996-12-09");
  });

  it("parses birthDate from authenticated profile HTML (raw markup, not cheerio text)", () => {
    const html =
      '<div>Dec.9, 1996<br/>Full name: Haywood L. Highsmith<br/></div>';
    const bio = parsePlayerBioFromHtml(html, "345545", "Haywood Highsmith");
    assert.equal(bio.birthDate, "1996-12-09");
  });

  it("ignores Player-{id} placeholder fallbacks and reads profile title", () => {
    const html =
      '<h1 class="player-title pltitlebigger">HADI ABUZGAYA basketball player profile</h1>';
    const bio = parsePlayerBioFromHtml(html, "342752", "Player-342752");
    assert.equal(bio.displayName, "Hadi Abuzgaya");
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

  it("does not link external sources on name alone without birthDate", () => {
    const lookup = buildBdlLookup([
      {
        playerId: 4830,
        externalId: "1846",
        displayName: "Derrick Brown",
        birthDate: "1987-09-08",
        seasons: [],
      },
    ]);
    assert.equal(matchExternalId("Derrick Brown", null, lookup), null);
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
      matchExternalId("Chris Cooper", null, lookup),
      null,
    );
    assert.equal(
      matchExternalId("Chris Cooper", "1990-01-17", lookup),
      null,
    );
    assert.ok(isPlausibleCollegeAge("1990-01-17", ["2010-11", "2011-12"]));
    assert.ok(!isPlausibleCollegeAge("1926-09-29", ["2010-11", "2011-12"]));
  });
});

describe("CCAA team aliases", () => {
  it("normalizes Langara team labels", () => {
    const langara = normalizeUsportsTeam("Langara");
    assert.equal(langara.slug, "langara");
    assert.equal(langara.name, "Langara");
  });

  it("keeps Douglas and Douglas College as separate canonical teams when unaliased", () => {
    const douglas = normalizeUsportsTeam("Douglas");
    assert.equal(douglas.slug, "douglas");
  });

  it("rejects known non-CCAA usbasket team labels", () => {
    assert.equal(isValidUsportsTeamName("Benedict"), false);
    assert.equal(isValidUsportsTeamName("Big Bend CC"), false);
    assert.equal(isValidUsportsTeamName("Langara"), true);
    assert.equal(isValidUsportsTeamName("Keyano"), true);
    assert.equal(isValidUsportsTeamName("Keyano College"), true);
    assert.equal(normalizeUsportsTeam("Keyano College").slug, "keyano");
    assert.equal(normalizeUsportsTeam("Keyano College").name, "Keyano");
    assert.equal(isValidUsportsTeamName("College Montmorency"), true);
    assert.equal(normalizeUsportsTeam("College Montmorency").slug, "montmorency");
    assert.equal(isValidUsportsTeamName("Capilano University"), true);
    assert.equal(normalizeUsportsTeam("Capilano University").slug, "capilano");
    assert.equal(isValidUsportsTeamName("Northern Alberta Institute of Technology"), true);
    assert.equal(normalizeUsportsTeam("Northern Alberta Institute of Technology").slug, "nait");
    assert.equal(isValidUsportsTeamName("St. Mary's University, Calgary"), true);
    assert.equal(normalizeUsportsTeam("St. Mary's University, Calgary").slug, "stmu");
  });

  it("rejects US JUCO Mohawk Valley — not CCAA Mohawk College", () => {
    assert.equal(isNonCcaaTeamLabel("Mohawk Valley"), true);
    assert.equal(isValidUsportsTeamName("Mohawk Valley"), false);
    assert.equal(isValidUsportsTeamName("Mohawk"), true);
    assert.equal(normalizeUsportsTeam("Mohawk Valley").name, "Mohawk Valley");
  });

  it("rejects JUCO stat blocks for CCAA ingest", () => {
    assert.equal(isExcludedCcaaLeagueLabel("JUCO"), true);
    assert.equal(isExcludedCcaaLeagueLabel("Season: 2018-2019 (JUCO)"), true);
    assert.equal(isExcludedCcaaLeagueLabel("CCAA"), false);

    const jucoHtml =
      '<h4 class="plstats-head">Season: 2018-2019 (JUCO) </h4><div class="dvgamesstats"><table class="my_Title"><tr class="my_Headers"><td colspan="16"><b>AVERAGES</b></td></tr><tr class="my_pStats1"><td class="headcol">Mohawk Valley</td><td>27</td><td>16.2</td><td>8.0</td><td>57.1%</td><td>41.0%</td><td>80.0%</td><td>0.8</td><td>2.4</td><td>3.2</td><td>0.9</td><td>2.0</td><td>0.4</td><td>0.9</td><td>1.8</td></tr></table></div>';
    assert.equal(statsBlockMatchesCcaaLeague(jucoHtml), false);
    assert.equal(parseNcaaSeasonFromStatsHtml(jucoHtml), null);
  });

  it("rejects US JUCO St.Clair Co.CC — not CCAA St Clair", () => {
    assert.equal(isNonCcaaTeamLabel("St.Clair Co.CC"), true);
    assert.equal(isValidUsportsTeamName("St.Clair Co.CC"), false);
    assert.equal(isValidUsportsTeamName("St.Clair"), true);
  });
});
