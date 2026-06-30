import { load } from "cheerio";
import {
  NCAA_USBASKET_EXCLUDED_LEAGUE_TAGS,
  NCAA_USBASKET_MEMBER_TAGS,
  NCAA_USBASKET_TAG,
  NCAA_USBASKET_TAGS,
} from "../division.js";
import type {
  CareerSeasonRow,
  NcaaSeasonRow,
  PlayoffStatsRow,
  SeasonStatsBundle,
  UsbasketIndexRow,
} from "../types.js";
import {
  calcPct,
  formatDisplayName,
  normalizeSeasonLabel,
  round1,
  seasonLabelFromYearParam,
} from "../utils/season.js";
import { teamAbbreviation } from "../utils/teams.js";
import { isValidUsportsTeamName } from "../utils/usportsTeams.js";
import type { UsbasketClient } from "../usbasketClient.js";
import { buildPlayerSeasonRecord } from "../transform.js";
import type { NcaaPlayerSeasonRecord } from "../types.js";

function parseNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number.parseFloat(value.trim());
  return Number.isNaN(parsed) ? null : parsed;
}

export function indexRowToSeasonRow(
  row: UsbasketIndexRow,
  seasonLabel: string,
): NcaaSeasonRow | null {
  const gamesPlayed = parseNumber(row.Games);
  if (!gamesPlayed || gamesPlayed <= 0) return null;

  const pointsPerGame = parseNumber(row.PTS);
  const reboundsPerGame = parseNumber(row.REBT);
  const assistsPerGame = parseNumber(row.AS);
  if (pointsPerGame == null || reboundsPerGame == null || assistsPerGame == null) {
    return null;
  }

  const fgMade2 = parseNumber(row.FGPM2) ?? 0;
  const fgAtt2 = parseNumber(row.FGPA2) ?? 0;
  const fgMade3 = parseNumber(row.FGPM3) ?? 0;
  const fgAtt3 = parseNumber(row.FGPA3) ?? 0;

  const teamName = row.TEAMNAME.replace(/&quote;/g, "'").trim();
  if (!teamName) return null;

  return {
    seasonLabel,
    teamName,
    teamAbbreviation: teamAbbreviation(teamName),
    gamesPlayed,
    pointsPerGame: round1(pointsPerGame),
    reboundsPerGame: round1(reboundsPerGame),
    assistsPerGame: round1(assistsPerGame),
    stealsPerGame: round1(parseNumber(row.ST) ?? 0),
    blocksPerGame: round1(parseNumber(row.BS) ?? 0),
    fieldGoalPct: calcPct(fgMade2, fgAtt2),
    threePointPct: calcPct(fgMade3, fgAtt3),
    freeThrowPct: null,
  };
}

/** CCAA index often lists team roster with Games=0 — still create a placeholder season row. */
export function createZeroStatSeasonRow(teamName: string, seasonLabel: string): NcaaSeasonRow {
  const cleaned = teamName.replace(/&quote;/g, "'").trim();
  return {
    seasonLabel,
    teamName: cleaned,
    teamAbbreviation: teamAbbreviation(cleaned),
    gamesPlayed: 0,
    pointsPerGame: 0,
    reboundsPerGame: 0,
    assistsPerGame: 0,
    stealsPerGame: 0,
    blocksPerGame: 0,
    fieldGoalPct: null,
    threePointPct: null,
    freeThrowPct: null,
  };
}

export function indexRowToPlaceholderSeasonRow(
  row: UsbasketIndexRow,
  seasonLabel: string,
): NcaaSeasonRow | null {
  const teamName = row.TEAMNAME.replace(/&quote;/g, "'").trim();
  if (!teamName) return null;
  return createZeroStatSeasonRow(teamName, seasonLabel);
}

function seasonHasStats(season: NcaaSeasonRow): boolean {
  return season.gamesPlayed > 0 || season.pointsPerGame > 0;
}

/** Returns 0 when USBasket career text omits a game count (common for high school). */
function parseCareerGamesPlayed(statsText: string): number {
  const gamesMatch = /(\d+)\s+games?\b/i.exec(statsText);
  if (!gamesMatch) return 0;
  const parsed = Number.parseInt(gamesMatch[1], 10);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return parsed;
}

export function seasonsHaveRealStats(seasons: NcaaSeasonRow[]): boolean {
  return seasons.some(seasonHasStats);
}

export function countIndexSeasonRows(seasons: NcaaSeasonRow[]): number {
  return seasons.length;
}

export function parseSeasonRowsFromIndexData(
  rows: UsbasketIndexRow[],
  defaultSeasonLabel: string,
): Array<{ playerId: string; displayName: string; position: string | null; season: NcaaSeasonRow }> {
  const results: Array<{
    playerId: string;
    displayName: string;
    position: string | null;
    season: NcaaSeasonRow;
  }> = [];

  for (const row of rows) {
    const playerId = row.PLAYERID?.trim();
    if (!playerId) continue;

    let label = defaultSeasonLabel;
    if (row.Season) {
      const fromRow = normalizeSeasonLabel(row.Season);
      if (fromRow) label = fromRow;
    }

    const season =
      indexRowToSeasonRow(row, label) ?? indexRowToPlaceholderSeasonRow(row, label);
    if (!season) continue;

    results.push({
      playerId,
      displayName: formatDisplayName(row.PLAYERNAME),
      position: row.POSITION?.trim() || null,
      season,
    });
  }

  return results;
}

function normalizeLeagueLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isExcludedCcaaLeagueLabel(leagueText: string): boolean {
  const normalized = normalizeLeagueLabel(leagueText);
  return NCAA_USBASKET_EXCLUDED_LEAGUE_TAGS.some((tag) => {
    const target = normalizeLeagueLabel(tag);
    return (
      normalized === target ||
      normalized.startsWith(`${target},`) ||
      normalized.includes(` ${target}`) ||
      normalized.includes(target)
    );
  });
}

function htmlMatchesLeagueTag(
  html: string,
  tags: readonly string[] = NCAA_USBASKET_MEMBER_TAGS,
): boolean {
  const lower = html.toLowerCase();
  return tags.some((tag) => lower.includes(tag.toLowerCase()));
}

function headingMatchesLeagueTag(
  headingText: string,
  tags: readonly string[] = NCAA_USBASKET_MEMBER_TAGS,
): boolean {
  const lower = headingText.toLowerCase();
  return tags.some((tag) => lower.includes(tag.toLowerCase()));
}

function isCcaaIngestTags(tags: readonly string[]): boolean {
  return (
    tags.length === NCAA_USBASKET_MEMBER_TAGS.length &&
    tags.every((tag, index) => tag === NCAA_USBASKET_MEMBER_TAGS[index])
  );
}

function teamNameFromStatsHtml(html: string): string | null {
  const $ = load(html);
  const summaryTable = $("table.my_Title").first();
  if (!summaryTable.length) return null;
  const averagesRow = findAveragesRow($, summaryTable);
  if (!averagesRow.length) return null;
  const teamName = averagesRow.find("td").first().text().replace(/&quote;/g, "'").trim();
  return teamName || null;
}

/** Accept CCAA member stat blocks; reject JUCO/NCAA headings outright. */
export function statsBlockMatchesCcaaLeague(
  html: string,
  tags: readonly string[] = NCAA_USBASKET_MEMBER_TAGS,
): boolean {
  const $ = load(html);
  const headingText = $("h4.plstats-head, h4").first().text().trim();
  if (!headingText) return false;

  if (!isCcaaIngestTags(tags)) {
    return headingMatchesLeagueTag(headingText, tags) || htmlMatchesLeagueTag(html, tags);
  }

  if (isExcludedCcaaLeagueLabel(headingText)) {
    if (/juco/i.test(headingText)) return false;
    if (/naia/i.test(headingText)) {
      const teamName = teamNameFromStatsHtml(html);
      return Boolean(teamName && isValidUsportsTeamName(teamName));
    }
    return false;
  }

  if (headingMatchesLeagueTag(headingText, tags)) return true;
  if (/\(canada\)/i.test(headingText)) return true;
  return htmlMatchesLeagueTag(html, tags);
}

function findAveragesRow($: ReturnType<typeof load>, summaryTable: ReturnType<ReturnType<typeof load>>) {
  const averagesHeader = summaryTable
    .find("tr")
    .filter((__, tr) => /AVERAGES?/i.test($(tr).text()))
    .first();
  if (!averagesHeader.length) return averagesHeader;

  for (const rowClass of ["my_pStats1", "my_pStats2"] as const) {
    const row = averagesHeader.nextAll(`tr.${rowClass}`).first();
    if (row.length) return row;
  }

  return averagesHeader.nextAll("tr").first();
}

function parseAveragesCells(cells: string[]): Omit<
  PlayoffStatsRow,
  never
> | null {
  if (cells.length < 14) return null;

  const gamesPlayed = parseNumber(cells[1]);
  const pointsPerGame = parseNumber(cells[3]);
  const fieldGoalPct = parsePctCell(cells[4]);
  const threePointPct = parsePctCell(cells[5]);
  const freeThrowPct = parsePctCell(cells[6]);
  const reboundsPerGame = parseNumber(cells[9]);
  const assistsPerGame = parseNumber(cells[10]);
  const blocksPerGame = parseNumber(cells[12]);
  const stealsPerGame = parseNumber(cells[13]);

  if (!gamesPlayed || gamesPlayed <= 0) return null;
  if (pointsPerGame == null || reboundsPerGame == null || assistsPerGame == null) return null;

  return {
    gamesPlayed,
    pointsPerGame: round1(pointsPerGame),
    reboundsPerGame: round1(reboundsPerGame),
    assistsPerGame: round1(assistsPerGame),
    stealsPerGame: round1(stealsPerGame ?? 0),
    blocksPerGame: round1(blocksPerGame ?? 0),
    fieldGoalPct,
    threePointPct,
    freeThrowPct,
  };
}

function findPlayoffsAveragesRow(
  $: ReturnType<typeof load>,
  summaryTable: ReturnType<ReturnType<typeof load>>,
) {
  const rows = summaryTable.find("tr");
  let afterPlayoffMarker = false;

  for (const tr of rows.toArray()) {
    const row = $(tr);
    const text = row.text().replace(/\s+/g, " ").trim();

    if (/playoffs?/i.test(text) && !row.hasClass("my_pStats1") && !row.hasClass("my_pStats2")) {
      afterPlayoffMarker = true;
      continue;
    }

    if (afterPlayoffMarker && (row.hasClass("my_pStats1") || row.hasClass("my_pStats2"))) {
      return row;
    }
  }

  return summaryTable
    .find("tr.my_pStats1, tr.my_pStats2")
    .filter((__, tr) => /playoffs?/i.test($(tr).find("td").first().text()))
    .first();
}

export function parsePlayoffStatsFromStatsHtml(html: string): PlayoffStatsRow | null {
  if (!html || html === "No Data") return null;

  const $ = load(html);
  const summaryTable = $("table.my_Title").first();
  if (!summaryTable.length) return null;

  const playoffsRow = findPlayoffsAveragesRow($, summaryTable);
  if (!playoffsRow.length) return null;

  const cells = playoffsRow
    .find("td")
    .map((_i, td) => $(td).text().trim())
    .get();

  return parseAveragesCells(cells);
}

export function parseSeasonStatsBundleFromStatsHtml(
  html: string,
  usbasketTag: string | readonly string[] = NCAA_USBASKET_MEMBER_TAGS,
): SeasonStatsBundle {
  const season = parseNcaaSeasonFromStatsHtml(html, usbasketTag);
  const playoffs = parsePlayoffStatsFromStatsHtml(html);
  return { season, playoffs };
}

/** Parse one usbasket stats block (profile page or PlayerStatsAjax HTML). */
export function parseNcaaSeasonFromStatsHtml(
  html: string,
  usbasketTag: string | readonly string[] = NCAA_USBASKET_MEMBER_TAGS,
): NcaaSeasonRow | null {
  const tags = typeof usbasketTag === "string" ? [usbasketTag] : usbasketTag;
  if (!html || html === "No Data" || !statsBlockMatchesCcaaLeague(html, tags)) return null;

  const $ = load(html);
  const headingText = $("h4.plstats-head, h4").first().text();
  const seasonMatch = /Season:\s*([0-9]{4}-[0-9]{4})/i.exec(headingText);
  if (!seasonMatch) return null;

  const seasonLabel = normalizeSeasonLabel(seasonMatch[1]);
  if (!seasonLabel) return null;

  const summaryTable = $("table.my_Title").first();
  if (!summaryTable.length) return null;

  const averagesRow = findAveragesRow($, summaryTable);
  if (!averagesRow.length) return null;
  const cells = averagesRow
    .find("td")
    .map((_i, td) => $(td).text().trim())
    .get();

  if (cells.length < 14) return null;

  const teamName = cells[0]?.replace(/&quote;/g, "'").trim();
  const gamesPlayed = parseNumber(cells[1]);
  const pointsPerGame = parseNumber(cells[3]);
  const fg2Pct = parsePctCell(cells[4]);
  const fg3Pct = parsePctCell(cells[5]);
  const ftPct = parsePctCell(cells[6]);
  const reboundsPerGame = parseNumber(cells[9]);
  const assistsPerGame = parseNumber(cells[10]);
  const blocksPerGame = parseNumber(cells[12]);
  const stealsPerGame = parseNumber(cells[13]);

  if (!teamName || !gamesPlayed || gamesPlayed <= 0) return null;
  if (pointsPerGame == null || reboundsPerGame == null || assistsPerGame == null) return null;

  return {
    seasonLabel,
    teamName,
    teamAbbreviation: teamAbbreviation(teamName),
    gamesPlayed,
    pointsPerGame: round1(pointsPerGame),
    reboundsPerGame: round1(reboundsPerGame),
    assistsPerGame: round1(assistsPerGame),
    stealsPerGame: round1(stealsPerGame ?? 0),
    blocksPerGame: round1(blocksPerGame ?? 0),
    fieldGoalPct: fg2Pct,
    threePointPct: fg3Pct,
    freeThrowPct: ftPct,
  };
}

/** Parse every matching league season block embedded in a player profile page. */
export function parseSeasonRowsFromPlayerHtml(
  html: string,
  usbasketTag: string | readonly string[] = NCAA_USBASKET_TAGS,
): NcaaSeasonRow[] {
  const usbasketTags = typeof usbasketTag === "string" ? [usbasketTag] : usbasketTag;
  const $ = load(html);
  const rows: NcaaSeasonRow[] = [];

  $("h4.plstats-head, h4").each((_, heading) => {
    const headingText = $(heading).text();
    if (!headingMatchesLeagueTag(headingText, usbasketTags)) return;

    const container = $(heading).nextAll(".dvgamesstats").first();
    const fragment =
      container.length > 0
        ? `${$.html(heading)}${$.html(container)}`
        : `${$.html(heading)}${$.html($(heading).nextAll("table.my_Title").first())}`;

    const season = parseNcaaSeasonFromStatsHtml(fragment, usbasketTags);
    if (season) rows.push(season);
  });

  return dedupeSeasonRows(rows);
}

/** Parse embedded profile stat blocks including optional playoff averages. */
export function parseSeasonStatsBundlesFromPlayerHtml(
  html: string,
  usbasketTag: string | readonly string[] = NCAA_USBASKET_TAGS,
): SeasonStatsBundle[] {
  const usbasketTags = typeof usbasketTag === "string" ? [usbasketTag] : usbasketTag;
  const $ = load(html);
  const bundles: SeasonStatsBundle[] = [];

  $("h4.plstats-head, h4").each((_, heading) => {
    const headingText = $(heading).text();
    if (!headingMatchesLeagueTag(headingText, usbasketTags)) return;

    const container = $(heading).nextAll(".dvgamesstats").first();
    const fragment =
      container.length > 0
        ? `${$.html(heading)}${$.html(container)}`
        : `${$.html(heading)}${$.html($(heading).nextAll("table.my_Title").first())}`;

    bundles.push(parseSeasonStatsBundleFromStatsHtml(fragment, usbasketTags));
  });

  return bundles;
}

/** Collect playoff averages keyed by season label from all profile stat blocks. */
export function parsePlayoffsBySeasonLabelFromPlayerHtml(
  html: string,
): Map<string, PlayoffStatsRow> {
  const $ = load(html);
  const map = new Map<string, PlayoffStatsRow>();

  $("h4.plstats-head, h4").each((_, heading) => {
    const headingText = $(heading).text();
    const seasonMatch = /season\s*:\s*(\d{4}\s*-\s*\d{4})/i.exec(headingText);
    if (!seasonMatch) return;

    const seasonLabel = normalizeSeasonLabel(seasonMatch[1].replace(/\s+/g, ""));
    if (!seasonLabel) return;

    const container = $(heading).nextAll(".dvgamesstats").first();
    const fragment =
      container.length > 0
        ? `${$.html(heading)}${$.html(container)}`
        : `${$.html(heading)}${$.html($(heading).nextAll("table.my_Title").first())}`;

    const playoffs = parsePlayoffStatsFromStatsHtml(fragment);
    if (playoffs) {
      map.set(seasonLabel, playoffs);
    }
  });

  return map;
}

export function listProfileStatsSeasonParams(html: string, playerId: string): string[] {
  const pattern = new RegExp(
    `loadStatsData\\('${playerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}','([^']+)'\\)`,
    "g",
  );
  return [...new Set([...html.matchAll(pattern)].map((match) => match[1]))];
}

export function mergeSeasonRows(
  ...groups: NcaaSeasonRow[][]
): NcaaSeasonRow[] {
  const byKey = new Map<string, NcaaSeasonRow>();

  for (const group of groups) {
    for (const season of group) {
      const key = `${season.seasonLabel}:${season.teamName}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, season);
        continue;
      }
      if (seasonHasStats(season) && !seasonHasStats(existing)) {
        byKey.set(key, season);
      }
    }
  }

  return [...byKey.values()].sort((a, b) => a.seasonLabel.localeCompare(b.seasonLabel));
}

function dedupeSeasonRows(rows: NcaaSeasonRow[]): NcaaSeasonRow[] {
  return mergeSeasonRows(rows);
}

function stripHtmlText(value: string): string {
  return value
    .replace(/&quote;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stop at the next career line or Awards block — last Year-By-Year rows often run to end-of-section. */
function truncateCareerLineHtml(html: string): string {
  const lower = html.toLowerCase();
  let end = html.length;
  for (const marker of ["<br", "<div", "<b>"]) {
    const idx = lower.indexOf(marker);
    if (idx >= 0) end = Math.min(end, idx);
  }
  return html.slice(0, end);
}

export function seasonRowKey(
  season: Pick<NcaaSeasonRow, "seasonLabel" | "teamName">,
): string {
  return `${season.seasonLabel}:${season.teamName}`;
}

function careerSeasonLabel(rawSeason: string): string | null {
  const trimmed = rawSeason.trim();
  const normalized = normalizeSeasonLabel(trimmed);
  if (normalized) return normalized;

  if (/^\d{4}$/.test(trimmed)) {
    return seasonLabelFromYearParam(trimmed);
  }

  return null;
}

function parseCareerStatNumber(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isNaN(parsed) ? null : parsed;
}

interface CareerLineMeta {
  teamName: string;
  leagueText: string;
  statsText: string;
}

function normalizeCareerLineBody(body: string): string {
  return body.replace(/^\$[\d,\s]+:\s*/i, "").trim();
}

function inferCareerLeagueFromTeamName(teamName: string): string {
  if (/\bU21\b/i.test(teamName)) return "LNB U21";
  if (/\bU18\b|\bU19\b|\bU17\b/i.test(teamName)) return "LNB Youth";
  return "Unknown";
}

function inferCareerLeagueFromParens(parenGroups: string[], teamName: string): string {
  for (const group of parenGroups) {
    if (/preparatory|prep school|high school|\bhs\b/i.test(group)) {
      return "High School";
    }
    if (/uaa|aau|u17|u16|u15/i.test(group)) {
      return "AAU";
    }
    if (/ncaa|nba|g-?league|juco|naia|ccaa|u-?sports|cis/i.test(group)) {
      return group;
    }
  }
  if (/preparatory|prep school|high school|\bhs\b/i.test(teamName)) {
    return "High School";
  }
  return parenGroups[0] ?? "Unknown";
}

function inferCareerLeagueFromLocation(teamName: string, locationPrefix: string): string {
  if (/preparatory|prep school|high school|\bhs\b/i.test(teamName)) {
    return "High School";
  }
  const stateMatch = /,\s*([A-Z]{2})\b/.exec(locationPrefix);
  if (stateMatch) return stateMatch[1];
  return "High School";
}

/** Strip date clauses and extract the team from "signed at …" transaction phrasing. */
function stripCareerTransactionPrefix(head: string): string {
  let text = head.replace(/&quote;/g, "'").trim();

  const signedAt = /\bsigned\s+at\s+(.+)$/i.exec(text);
  if (signedAt) {
    text = signedAt[1].trim();
  } else {
    text = text.replace(/^(?:in|on)\s+[A-Za-z]{3,9}\.?'?\s*\d{0,2},?\s*/i, "");
    text = text.replace(/^missed\s+most\s+of\s+(?:the\s+)?season[^,]*,?\s*/i, "");
  }

  return text.trim();
}

function isNarrativeCareerTeamName(teamName: string): boolean {
  const trimmed = teamName.trim();
  if (!trimmed) return true;

  const lower = trimmed.toLowerCase();
  if (/^(in|on)\s+\w/.test(lower)) return true;
  if (/\bsigned at\b/.test(lower)) return true;
  if (/\bmissed (most of )?(the )?season\b/.test(lower)) return true;
  if (/^(drafted|traded|released|waived|acquired|declared)\b/.test(lower)) return true;
  if (/\b(traded to|drafted by|declared for|entered the draft)\b/.test(lower)) return true;
  return false;
}

/** USBasket career lines use several formats — not only `Team (League): stats`. */
function parseCareerLineMeta(body: string): CareerLineMeta | null {
  const trimmed = body.replace(/&quote;/g, "'").trim();
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx < 0) {
    const parenOnly = /^(.+?)\(([^)]+)\)\s*$/i.exec(trimmed);
    if (!parenOnly) return null;
    const rawHead = parenOnly[1].trim();
    if (
      /\b(?:missed (most of )?(the )?season|signed at|due to (an )?injury|released in|waived in)\b/i.test(
        `${rawHead} ${parenOnly[2]}`,
      )
    ) {
      return null;
    }
    const teamName = stripCareerTransactionPrefix(rawHead);
    if (!teamName || isNarrativeCareerTeamName(teamName)) return null;
    return {
      teamName,
      leagueText: parenOnly[2].trim(),
      statsText: "",
    };
  }

  const head = stripCareerTransactionPrefix(trimmed.slice(0, colonIdx).trim());
  const statsText = trimmed.slice(colonIdx + 1).trim();
  if (!head || isNarrativeCareerTeamName(head)) return null;

  if (head.includes("/")) {
    const segments = head.split("/").map((part) => part.trim()).filter(Boolean);
    const teamName = segments[segments.length - 1] ?? head;
    const leagueText = inferCareerLeagueFromLocation(teamName, segments.slice(0, -1).join(" / "));
    return { teamName, leagueText, statsText };
  }

  const parenGroups = [...head.matchAll(/\(([^)]+)\)/g)].map((match) => match[1].trim());
  const teamName = head.replace(/\([^)]+\)/g, " ").replace(/\s+/g, " ").trim();
  if (!teamName || isNarrativeCareerTeamName(teamName)) return null;

  let leagueText = inferCareerLeagueFromParens(parenGroups, teamName);
  if (leagueText === "Unknown" && parenGroups.length === 0) {
    leagueText = inferCareerLeagueFromTeamName(teamName);
  }
  if (
    leagueText === "Unknown" &&
    /\b(cup|league|challenge|euro|fiba|bcl)\b|eurocup|eurochallenge|champions league/i.test(head)
  ) {
    leagueText = head;
  }

  return {
    teamName,
    leagueText,
    statsText,
  };
}

function parseCareerStatFromTotals(
  statsText: string,
  perGamePattern: RegExp,
  totalPattern: RegExp,
): number | null {
  const perGame = parseCareerStatNumber(statsText, perGamePattern);
  if (perGame != null) return perGame;

  const total = parseCareerStatNumber(statsText, totalPattern);
  if (total == null) return null;

  const gamesPlayed = parseCareerGamesPlayed(statsText);
  if (gamesPlayed <= 0) return total;
  return total / gamesPlayed;
}

function buildCareerSeasonRow(
  seasonLabel: string,
  meta: CareerLineMeta,
): Omit<CareerSeasonRow, "leagueText"> {
  const { teamName, statsText } = meta;
  const pointsPerGame = parseCareerStatFromTotals(
    statsText,
    /([\d.]+)\s*ppg/i,
    /([\d.]+)\s*pts\b/i,
  );
  const reboundsPerGame = parseCareerStatFromTotals(
    statsText,
    /([\d.]+)\s*rpg/i,
    /([\d.]+)\s*reb\b/i,
  );
  const assistsPerGame = parseCareerStatFromTotals(
    statsText,
    /([\d.]+)\s*apg/i,
    /([\d.]+)\s*ast\b/i,
  );

  return {
    seasonLabel,
    teamName,
    teamAbbreviation: teamAbbreviation(teamName),
    gamesPlayed: parseCareerGamesPlayed(statsText),
    pointsPerGame: round1(pointsPerGame ?? 0),
    reboundsPerGame: round1(reboundsPerGame ?? 0),
    assistsPerGame: round1(assistsPerGame ?? 0),
    stealsPerGame: round1(parseCareerStatNumber(statsText, /([\d.]+)\s*spg/i) ?? 0),
    blocksPerGame: round1(parseCareerStatNumber(statsText, /([\d.]+)\s*bpg/i) ?? 0),
    fieldGoalPct: parseCareerPct(statsText, [/FGP:?\s*([\d.]+)%/i, /FG:\s*([\d.]+)%/i]),
    threePointPct: parseCareerPct(statsText, [/3FGP:?\s*([\d.]+)%/i, /3PT:?\s*([\d.]+)%/i, /3Pt:?\s*([\d.]+)%/i]),
    freeThrowPct: parseCareerPct(statsText, [/FTP:?\s*([\d.]+)%/i, /FT:?\s*([\d.]+)%/i]),
  };
}

function careerLineHasAnyStat(statsText: string): boolean {
  return (
    parseCareerStatNumber(statsText, /([\d.]+)\s*ppg/i) != null ||
    parseCareerStatNumber(statsText, /([\d.]+)\s*rpg/i) != null ||
    parseCareerStatNumber(statsText, /([\d.]+)\s*apg/i) != null ||
    parseCareerStatNumber(statsText, /([\d.]+)\s*pts\b/i) != null ||
    parseCareerStatNumber(statsText, /([\d.]+)\s*reb\b/i) != null ||
    parseCareerStatNumber(statsText, /([\d.]+)\s*ast\b/i) != null
  );
}

const CAREER_TRANSACTION_PATTERNS = [
  /\bdrafted by\b/i,
  /\bdeclared for\b/i,
  /\btraded to\b/i,
  /\btraded from\b/i,
  /\bacquired from\b/i,
  /\breleased\b/i,
  /\bwaived\b/i,
  /\bsigned with\b/i,
  /\bsigned to\b/i,
  /\bsigned at\b/i,
  /\bfree agent\b/i,
  /\bentered the draft\b/i,
  /\bnba draft\b/i,
  /\bmissed (most of )?(the )?season\b/i,
  /\bout for the season\b/i,
  /\bdue to (an )?injury\b/i,
] as const;

/** Skip draft/trade/news career lines that are not real team-season stints. */
export function isCareerTransactionSeason(
  season: Pick<
    CareerSeasonRow,
    "teamName" | "leagueText" | "gamesPlayed" | "pointsPerGame" | "reboundsPerGame" | "assistsPerGame"
  >,
): boolean {
  const team = season.teamName.trim();
  const league = season.leagueText.trim();
  const combined = `${team} ${league}`;

  if (/^\$[\d,\s]/.test(team)) return true;
  if (isNarrativeCareerTeamName(team)) return true;

  const hasPlayedStats =
    season.gamesPlayed > 0 ||
    season.pointsPerGame > 0 ||
    season.reboundsPerGame > 0 ||
    season.assistsPerGame > 0;

  if (/\bsigned at\b/i.test(combined) && hasPlayedStats) {
    return false;
  }

  if (!hasPlayedStats && CAREER_TRANSACTION_PATTERNS.some((pattern) => pattern.test(combined))) {
    return true;
  }

  if (hasPlayedStats && CAREER_TRANSACTION_PATTERNS.some((pattern) => pattern.test(combined))) {
    // Real stint with stats — keep even if the line mentions signing (team name already normalized).
    return false;
  }

  if (/^traded to\b/i.test(league)) return true;

  return false;
}

function parseCareerPct(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const parsed = Number.parseFloat(match[1]);
    if (!Number.isNaN(parsed)) return round1(parsed);
  }
  return null;
}

function leagueTagMatchesCareerLeague(
  leagueText: string,
  leagueTag: string = NCAA_USBASKET_TAG,
  memberTags: readonly string[] = NCAA_USBASKET_MEMBER_TAGS,
): boolean {
  if (isExcludedCcaaLeagueLabel(leagueText)) return false;

  const normalized = leagueText.trim().toLowerCase();
  const tags =
    leagueTag.trim().toLowerCase() === NCAA_USBASKET_TAG.toLowerCase()
      ? memberTags
      : [leagueTag];

  return tags.some((tag) => {
    const target = tag.trim().toLowerCase();
    return (
      normalized === target ||
      normalized.startsWith(`${target},`) ||
      normalized.includes(` ${target}`) ||
      normalized.includes(target)
    );
  });
}

/** Parse subscriber "Year-By-Year Career" lines on player profile pages. */
export function parseCareerYearByYearSeasons(
  html: string,
  leagueTag: string = NCAA_USBASKET_TAG,
): NcaaSeasonRow[] {
  const marker = "Year-By-Year Career";
  const start = html.indexOf(marker);
  if (start < 0) return [];

  const endCandidates = ["profile-head", "Awards/Achievements", "Awards & Achievements"];
  let end = start + 20_000;
  for (const candidate of endCandidates) {
    const idx = html.indexOf(candidate, start + marker.length);
    if (idx >= 0) end = Math.min(end, idx);
  }

  const section = html.slice(start, end);
  const rows: NcaaSeasonRow[] = [];

  for (const match of section.matchAll(/<b>(\d{4}(?:-\d{4})?):<\/b>([\s\S]*?)(?=<b>\d{4}|$)/gi)) {
    const seasonLabel = careerSeasonLabel(match[1]);
    if (!seasonLabel) continue;

    const body = normalizeCareerLineBody(stripHtmlText(truncateCareerLineHtml(match[2])));
    const meta = parseCareerLineMeta(body);
    if (!meta || !meta.teamName || !leagueTagMatchesCareerLeague(meta.leagueText, leagueTag)) continue;

    if (!careerLineHasAnyStat(meta.statsText)) {
      rows.push(createZeroStatSeasonRow(meta.teamName, seasonLabel));
      continue;
    }

    rows.push(buildCareerSeasonRow(seasonLabel, meta));
  }

  return dedupeSeasonRows(rows);
}

/** Subscriber pages duplicate a blurred/redacted career block — ignore masked text. */
export function isRedactedCareerText(text: string | null | undefined): boolean {
  const value = text?.trim();
  if (!value) return true;
  return /\*{2,}/.test(value);
}

/** Prefer the visible Career tab over the SEO "Year-By-Year Career" block (often redacted). */
function extractPlCareerSectionHtml(html: string): string | null {
  const $ = load(html);
  const candidates = $("#plCareer");
  for (let index = 0; index < candidates.length; index += 1) {
    const element = candidates.eq(index);
    const style = element.attr("style") ?? "";
    if (/blur/i.test(style)) continue;

    const sample = element.text();
    if (!/Basketball Career/i.test(sample)) continue;

    const careerCell = element.find("td.givebiggerfonts").first();
    const sampleText = careerCell.length
      ? careerCell.text()
      : (sample.split("Year-By-Year Career")[0] ?? sample);
    if (isRedactedCareerText(sampleText)) continue;

    if (careerCell.length) {
      return $.html(careerCell);
    }
    return $.html(element);
  }
  return null;
}

function splitMultiStintCareerBody(body: string): string[] {
  const normalized = body.trim();
  if (!normalized) return [];

  const parts: string[] = [];
  const splitPattern =
    /;\s*|,\s+in\s+[A-Za-z]{3,9}\.?'?\s*\d{0,2},?\s*(?:signed at|moved to)\s+/gi;
  let lastIndex = 0;

  for (const match of normalized.matchAll(splitPattern)) {
    if (match.index != null && match.index > lastIndex) {
      parts.push(normalized.slice(lastIndex, match.index).trim());
    }
    lastIndex = match.index! + match[0].length;
  }

  const tail = normalized.slice(lastIndex).trim();
  if (tail) parts.push(tail);

  return parts.length ? parts : [normalized];
}

function careerLineMetaIsUsable(meta: CareerLineMeta | null): meta is CareerLineMeta {
  if (!meta?.teamName || !meta.leagueText) return false;
  if (isRedactedCareerText(meta.teamName) || isRedactedCareerText(meta.leagueText)) {
    return false;
  }
  return true;
}

function parseCareerSeasonLinesFromSection(sectionHtml: string): CareerSeasonRow[] {
  const rows: CareerSeasonRow[] = [];

  for (const match of sectionHtml.matchAll(
    /<b>(\d{4}(?:-\d{4})?):<\/b>([\s\S]*?)(?=<b>\d{4}|Player Achievements:|$)/gi,
  )) {
    const seasonLabel = careerSeasonLabel(match[1]);
    if (!seasonLabel) continue;

    const rawBody = normalizeCareerLineBody(stripHtmlText(truncateCareerLineHtml(match[2])));
    if (!rawBody || /^retired$/i.test(rawBody)) continue;

    for (const stintBody of splitMultiStintCareerBody(rawBody)) {
      const meta = parseCareerLineMeta(stintBody);
      if (!careerLineMetaIsUsable(meta)) continue;

      if (!careerLineHasAnyStat(meta.statsText)) {
        const placeholder = {
          ...createZeroStatSeasonRow(meta.teamName, seasonLabel),
          leagueText: meta.leagueText,
        };
        if (isCareerTransactionSeason(placeholder)) continue;
        rows.push(placeholder);
        continue;
      }

      const row = { ...buildCareerSeasonRow(seasonLabel, meta), leagueText: meta.leagueText };
      if (isCareerTransactionSeason(row)) continue;
      rows.push(row);
    }
  }

  return dedupeCareerSeasonRows(rows);
}

function parseYearByYearCareerSection(html: string): CareerSeasonRow[] {
  const marker = "Year-By-Year Career";
  const start = html.indexOf(marker);
  if (start < 0) return [];

  const endCandidates = ["profile-head", "Awards/Achievements", "Awards & Achievements"];
  let end = start + 20_000;
  for (const candidate of endCandidates) {
    const idx = html.indexOf(candidate, start + marker.length);
    if (idx >= 0) end = Math.min(end, idx);
  }

  return parseCareerSeasonLinesFromSection(html.slice(start, end));
}

/** Parse every career line (no league filter) for career-hub routing. */
export function parseAllCareerYearByYearSeasons(html: string): CareerSeasonRow[] {
  const plCareerHtml = extractPlCareerSectionHtml(html);
  if (plCareerHtml) {
    const plRows = parseCareerSeasonLinesFromSection(plCareerHtml);
    if (plRows.length) return plRows;
  }

  return parseYearByYearCareerSection(html);
}

function shouldReplaceCareerSeason(
  existing: CareerSeasonRow,
  candidate: CareerSeasonRow,
): boolean {
  const existingGp = existing.gamesPlayed;
  const candidateGp = candidate.gamesPlayed;
  const existingKnown = existingGp != null && existingGp > 0;
  const candidateKnown = candidateGp != null && candidateGp > 0;

  if (candidateKnown && !existingKnown) return true;
  if (candidateKnown && existingKnown && candidateGp! > existingGp!) return true;
  return false;
}

function dedupeCareerSeasonRows(rows: CareerSeasonRow[]): CareerSeasonRow[] {
  const byKey = new Map<string, CareerSeasonRow>();
  for (const season of rows) {
    const key = `${season.seasonLabel}:${season.teamName}:${season.leagueText}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, season);
      continue;
    }
    if (shouldReplaceCareerSeason(existing, season)) {
      byKey.set(key, season);
    }
  }
  return [...byKey.values()].sort((a, b) => a.seasonLabel.localeCompare(b.seasonLabel));
}

function profileSeasonLabelFromHtml(html: string): string | null {
  const headingMatch = /Season:\s*([0-9]{4}-[0-9]{4})/i.exec(html);
  if (headingMatch) {
    return normalizeSeasonLabel(headingMatch[1]);
  }

  const currentMatch = /TMP_Curr_season:\s*(\d{4})/i.exec(html);
  if (currentMatch) {
    return seasonLabelFromYearParam(currentMatch[1]);
  }

  return null;
}

/** Profile summary lines like "most recently played at Keyano in the CCAA". */
export function parseCcaaProfileAffiliations(
  html: string,
  leagueTag: string = NCAA_USBASKET_TAG,
): NcaaSeasonRow[] {
  if (!html.toLowerCase().includes(leagueTag.toLowerCase())) return [];

  const recentMatch =
    /most recently played at\s*<a[^>]*>([^<]+)<\/a>\s*in the CCAA/i.exec(html);
  if (!recentMatch) return [];

  const teamName = stripHtmlText(recentMatch[1]);
  const seasonLabel = profileSeasonLabelFromHtml(html);
  if (!teamName || !seasonLabel) return [];

  return [createZeroStatSeasonRow(teamName, seasonLabel)];
}

function seasonLabelFromParam(param: string): string | null {
  const normalized = normalizeSeasonLabel(param);
  if (normalized) return normalized;
  if (/^\d{4}$/.test(param.trim())) {
    return seasonLabelFromYearParam(param.trim());
  }
  return null;
}

/** Fetch every matching NCAA season usbasket exposes on a player profile (index + AJAX). */
export async function collectAllNcaaSeasons(
  client: UsbasketClient,
  playerId: string,
  profileHtml: string,
): Promise<NcaaSeasonRow[]> {
  const embedded = parseSeasonRowsFromPlayerHtml(profileHtml);
  const career = parseCareerYearByYearSeasons(profileHtml);
  const affiliations = parseCcaaProfileAffiliations(profileHtml);
  const staticRows = mergeSeasonRows(affiliations, career, embedded);

  if (staticRows.some(seasonHasStats)) {
    return staticRows;
  }

  const seasonParams = listProfileStatsSeasonParams(profileHtml, playerId);
  const paramsToFetch = seasonParams.filter((seasonParam) => {
    const label = seasonLabelFromParam(seasonParam);
    if (!label) return true;
    return !staticRows.some((season) => season.seasonLabel === label && seasonHasStats(season));
  });

  if (paramsToFetch.length === 0) {
    return staticRows;
  }

  const fetched: NcaaSeasonRow[] = [];

  for (const seasonParam of paramsToFetch) {
    try {
      const fragment = await client.fetchPlayerStatsAjax(playerId, seasonParam);
      const season = parseNcaaSeasonFromStatsHtml(fragment);
      if (season) fetched.push(season);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[profile] ${playerId} season=${seasonParam}: ${message}`);
    }
  }

  return mergeSeasonRows(staticRows, fetched);
}

function parsePctCell(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace("%", "").trim();
  const parsed = Number.parseFloat(cleaned);
  return Number.isNaN(parsed) ? null : round1(parsed);
}

export function buildRecordsFromSeasonRows(
  playerId: string,
  displayName: string,
  seasons: NcaaSeasonRow[],
  playoffsBySeasonLabel?: Map<string, PlayoffStatsRow | null>,
): NcaaPlayerSeasonRecord[] {
  return seasons.map((season) =>
    buildPlayerSeasonRecord({
      externalId: playerId,
      displayName,
      teamName: season.teamName,
      teamAbbreviation: season.teamAbbreviation,
      seasonLabel: season.seasonLabel,
      stats: {
        gamesPlayed: season.gamesPlayed,
        pointsPerGame: season.pointsPerGame,
        reboundsPerGame: season.reboundsPerGame,
        assistsPerGame: season.assistsPerGame,
        stealsPerGame: season.stealsPerGame,
        blocksPerGame: season.blocksPerGame,
        fieldGoalPct: season.fieldGoalPct,
        threePointPct: season.threePointPct,
        freeThrowPct: season.freeThrowPct,
      },
      playoffs: playoffsBySeasonLabel?.get(season.seasonLabel) ?? null,
    }),
  );
}

export async function buildPlayerSeasonRecordsFromPage(
  client: UsbasketClient,
  playerId: string,
  html: string,
  displayNameFallback?: string,
): Promise<NcaaPlayerSeasonRecord[]> {
  const seasonRows = parseSeasonRowsFromPlayerHtml(html);
  const displayName =
    displayNameFallback ??
    extractDisplayNameFromHtml(html) ??
    `Player ${playerId}`;

  return buildRecordsFromSeasonRows(playerId, displayName, seasonRows);
}

function extractDisplayNameFromHtml(html: string): string | null {
  const match = /player-title[^>]*>([^<]+)/i.exec(html);
  if (!match) return null;
  const raw = match[1].replace(/basketball player profile/i, "").trim();
  if (!raw) return null;
  return raw
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function defaultSeasonLabelForYearParam(yearParam: string): string {
  return seasonLabelFromYearParam(yearParam);
}
