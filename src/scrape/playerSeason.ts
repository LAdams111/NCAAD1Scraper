import { load } from "cheerio";
import {
  NCAA_USBASKET_EXCLUDED_LEAGUE_TAGS,
  NCAA_USBASKET_MEMBER_TAGS,
  NCAA_USBASKET_TAG,
  NCAA_USBASKET_TAGS,
} from "../division.js";
import type { NcaaSeasonRow, UsbasketIndexRow } from "../types.js";
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

    const body = stripHtmlText(truncateCareerLineHtml(match[2]));
    const metaMatch = /^(.+?)\(([^)]+)\)/i.exec(body);
    if (!metaMatch) continue;

    const teamName = metaMatch[1].replace(/&quote;/g, "'").trim();
    const leagueText = metaMatch[2].trim();
    const statsText = body.slice(metaMatch[0].length).replace(/^:\s*/, "").trim();
    if (!teamName || !leagueTagMatchesCareerLeague(leagueText, leagueTag)) continue;

    const pointsPerGame = parseCareerStatNumber(statsText, /([\d.]+)\s*ppg/i);
    const reboundsPerGame = parseCareerStatNumber(statsText, /([\d.]+)\s*rpg/i);
    const assistsPerGame = parseCareerStatNumber(statsText, /([\d.]+)\s*apg/i);

    if (
      pointsPerGame == null ||
      reboundsPerGame == null ||
      assistsPerGame == null
    ) {
      rows.push(createZeroStatSeasonRow(teamName, seasonLabel));
      continue;
    }

    const gamesMatch = /(\d+)\s+games?\b/i.exec(statsText);
    const gamesPlayed = gamesMatch ? Number.parseInt(gamesMatch[1], 10) : 1;
    if (!gamesPlayed || gamesPlayed <= 0) {
      rows.push(createZeroStatSeasonRow(teamName, seasonLabel));
      continue;
    }

    rows.push({
      seasonLabel,
      teamName,
      teamAbbreviation: teamAbbreviation(teamName),
      gamesPlayed,
      pointsPerGame: round1(pointsPerGame),
      reboundsPerGame: round1(reboundsPerGame),
      assistsPerGame: round1(assistsPerGame),
      stealsPerGame: round1(parseCareerStatNumber(statsText, /([\d.]+)\s*spg/i) ?? 0),
      blocksPerGame: round1(parseCareerStatNumber(statsText, /([\d.]+)\s*bpg/i) ?? 0),
      fieldGoalPct: parseCareerPct(statsText, [/FGP:?\s*([\d.]+)%/i, /FG:\s*([\d.]+)%/i]),
      threePointPct: parseCareerPct(statsText, [/3FGP:?\s*([\d.]+)%/i, /3PT:?\s*([\d.]+)%/i, /3Pt:?\s*([\d.]+)%/i]),
    });
  }

  return dedupeSeasonRows(rows);
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
      },
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
