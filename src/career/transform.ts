import type { CareerPlayerSeasonRecord, CareerSeasonRow, HoopCentralIngestPayload, PlayoffStatsRow } from "../types.js";
import { CAREER_SOURCE } from "../types.js";
import { normalizeCareerTeam, routeLeagueTag } from "./leagueRoutes.js";

export function buildCareerSeasonRecords(
  playerId: string,
  displayName: string,
  seasons: CareerSeasonRow[],
  options: {
    skipAuthoritativeSources?: boolean;
    playoffsBySeasonLabel?: Map<string, PlayoffStatsRow>;
  } = {},
): { records: CareerPlayerSeasonRecord[]; skipped: number } {
  const records: CareerPlayerSeasonRecord[] = [];
  let skipped = 0;

  for (const season of seasons) {
    const route = routeLeagueTag(season.leagueText, options);
    if (route.skip) {
      skipped += 1;
      continue;
    }

    const team = normalizeCareerTeam(season.teamName, route.leagueSlug);

    records.push({
      source: CAREER_SOURCE,
      externalId: playerId,
      displayName,
      leagueSlug: route.leagueSlug,
      leagueName: route.leagueName,
      leagueText: season.leagueText,
      teamSlug: team.slug,
      teamName: team.name,
      teamAbbreviation: season.teamAbbreviation || team.abbreviation,
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
      playoffs: options.playoffsBySeasonLabel?.get(season.seasonLabel) ?? null,
    });
  }

  return { records, skipped };
}

export function toCareerIngestPayload(
  record: CareerPlayerSeasonRecord,
  playerOverride?: { displayName: string },
  includeFgPct = true,
): HoopCentralIngestPayload {
  const stats: HoopCentralIngestPayload["stats"] = {
    gamesPlayed: record.stats.gamesPlayed,
    pointsPerGame: record.stats.pointsPerGame,
    reboundsPerGame: record.stats.reboundsPerGame,
    assistsPerGame: record.stats.assistsPerGame,
    stealsPerGame: record.stats.stealsPerGame,
    blocksPerGame: record.stats.blocksPerGame,
  };

  if (includeFgPct) {
    if (record.stats.fieldGoalPct != null) stats.fieldGoalPct = record.stats.fieldGoalPct;
    if (record.stats.threePointPct != null) stats.threePointPct = record.stats.threePointPct;
    if (record.stats.freeThrowPct != null) stats.freeThrowPct = record.stats.freeThrowPct;
  }

  const payload: HoopCentralIngestPayload = {
    source: record.source,
    externalId: record.externalId,
    player: playerOverride ?? { displayName: record.displayName },
    league: {
      slug: record.leagueSlug,
      name: record.leagueName,
    },
    team: {
      slug: record.teamSlug,
      name: record.teamName,
      abbreviation: record.teamAbbreviation,
    },
    season: {
      label: record.seasonLabel,
    },
    stats,
  };

  if (record.playoffs) {
    payload.playoffs = record.playoffs;
  }

  return payload;
}
