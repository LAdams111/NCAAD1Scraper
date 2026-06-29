import type {
  HoopCentralIngestPayload,
  HoopCentralIngestResponse,
  NcaaPlayerSeasonRecord,
} from "./types.js";
import { NCAA_LEAGUE_NAME, NCAA_LEAGUE_SLUG } from "./division.js";
import { NCAA_SOURCE } from "./types.js";
import { normalizeUsportsTeam } from "./utils/usportsTeams.js";

export function toIngestPayload(
  record: NcaaPlayerSeasonRecord,
  playerOverride?: HoopCentralIngestPayload["player"],
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
  }

  return {
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
}

export function buildPlayerSeasonRecord(input: {
  externalId: string;
  displayName: string;
  teamName: string;
  teamAbbreviation?: string;
  seasonLabel: string;
  stats: NcaaPlayerSeasonRecord["stats"];
}): NcaaPlayerSeasonRecord {
  const rawTeamName = input.teamName.replace(/&quote;/g, "'");
  const team = normalizeUsportsTeam(rawTeamName);
  const abbrev = input.teamAbbreviation ?? team.abbreviation;
  return {
    source: NCAA_SOURCE,
    externalId: input.externalId,
    displayName: input.displayName,
    leagueSlug: NCAA_LEAGUE_SLUG,
    leagueName: NCAA_LEAGUE_NAME,
    teamSlug: team.slug,
    teamName: team.name,
    teamAbbreviation: abbrev,
    seasonLabel: input.seasonLabel,
    stats: input.stats,
  };
}
