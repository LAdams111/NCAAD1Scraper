import { load } from "cheerio";
import type { NcaaSeasonRow, UsbasketIndexRow } from "../types.js";
import {
  calcPct,
  formatDisplayName,
  normalizeSeasonLabel,
  round1,
  seasonLabelFromYearParam,
} from "../utils/season.js";
import { teamAbbreviation } from "../utils/teams.js";
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

    const season = indexRowToSeasonRow(row, label);
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

/** Parse one usbasket stats block (profile page or PlayerStatsAjax HTML). */
export function parseNcaaSeasonFromStatsHtml(html: string): NcaaSeasonRow | null {
  if (!html || html === "No Data" || !/NCAA1/i.test(html)) return null;

  const $ = load(html);
  const headingText = $("h4.plstats-head, h4").first().text();
  const seasonMatch = /Season:\s*([0-9]{4}-[0-9]{4})/i.exec(headingText);
  if (!seasonMatch) return null;

  const seasonLabel = normalizeSeasonLabel(seasonMatch[1]);
  if (!seasonLabel) return null;

  const summaryTable = $("table.my_Title").first();
  if (!summaryTable.length) return null;

  const averagesRow = summaryTable
    .find("tr")
    .filter((__, tr) => /AVERAGES?/i.test($(tr).text()))
    .first()
    .nextAll("tr.my_pStats1")
    .first();

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

/** Parse every NCAA1 season block embedded in a profile page. */
export function parseSeasonRowsFromPlayerHtml(html: string): NcaaSeasonRow[] {
  const $ = load(html);
  const rows: NcaaSeasonRow[] = [];

  $("h4.plstats-head, h4").each((_, heading) => {
    const headingText = $(heading).text();
    if (!/NCAA1/i.test(headingText)) return;

    const container = $(heading).nextAll(".dvgamesstats").first();
    const fragment =
      container.length > 0
        ? `${$.html(heading)}${$.html(container)}`
        : `${$.html(heading)}${$.html($(heading).nextAll("table.my_Title").first())}`;

    const season = parseNcaaSeasonFromStatsHtml(fragment);
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
      byKey.set(key, season);
    }
  }

  return [...byKey.values()].sort((a, b) => a.seasonLabel.localeCompare(b.seasonLabel));
}

function dedupeSeasonRows(rows: NcaaSeasonRow[]): NcaaSeasonRow[] {
  return mergeSeasonRows(rows);
}

/** Fetch every NCAA1 season usbasket exposes on a player profile (index + AJAX). */
export async function collectAllNcaaSeasons(
  client: UsbasketClient,
  playerId: string,
  profileHtml: string,
): Promise<NcaaSeasonRow[]> {
  const embedded = parseSeasonRowsFromPlayerHtml(profileHtml);
  const seasonParams = listProfileStatsSeasonParams(profileHtml, playerId);
  const fetched: NcaaSeasonRow[] = [];

  for (const seasonParam of seasonParams) {
    try {
      const fragment = await client.fetchPlayerStatsAjax(playerId, seasonParam);
      const season = parseNcaaSeasonFromStatsHtml(fragment);
      if (season) fetched.push(season);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[profile] ${playerId} season=${seasonParam}: ${message}`);
    }
  }

  return mergeSeasonRows(embedded, fetched);
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
