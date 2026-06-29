import {
  NCAA_LEAGUE_NAME,
  NCAA_LEAGUE_SLUG,
  NCAA_SOURCE,
} from "./division.js";

export { NCAA_SOURCE };

export interface UsbasketIndexRow {
  PLAYERID: string;
  PLAYERNAME: string;
  TEAMNAME: string;
  TEAMNO?: string;
  POSITION?: string;
  Games: string;
  PTS: string;
  REBT: string;
  AS: string;
  ST: string;
  BS: string;
  FGPM2: string;
  FGPA2: string;
  FGPM3: string;
  FGPA3: string;
  Season?: string;
}

export interface NcaaSeasonRow {
  seasonLabel: string;
  teamName: string;
  teamAbbreviation: string;
  gamesPlayed: number;
  pointsPerGame: number;
  reboundsPerGame: number;
  assistsPerGame: number;
  stealsPerGame: number;
  blocksPerGame: number;
  fieldGoalPct: number | null;
  threePointPct: number | null;
}

export interface NcaaPlayerBio {
  playerId: string;
  displayName: string;
  birthDate: string | null;
  position: string | null;
  heightCm: number | null;
  weightKg: number | null;
  hometown: string | null;
}

export interface HoopCentralBioPayload {
  source: typeof NCAA_SOURCE;
  externalId: string;
  player: {
    displayName: string;
    birthDate?: string | null;
    position?: string | null;
    heightCm?: number | null;
    weightKg?: number | null;
    hometown?: string | null;
    headshotUrl?: string | null;
  };
  linkTo?: {
    source: string;
    externalId: string;
  };
}

export interface HoopCentralBioResponse {
  ok: true;
  playerId: number;
  created: {
    player: boolean;
    identity: boolean;
  };
  linkedVia: "linkTo" | "identity" | "fuzzy" | "created";
}

export interface HcPlayerStatus {
  playerId: number;
  externalId: string;
  displayName: string;
  birthDate: string | null;
  seasons: Array<{
    seasonLabel: string;
    gamesPlayed: number;
    pointsPerGame: number;
    reboundsPerGame: number;
    assistsPerGame: number;
  }>;
}

export interface NcaaPlayerMeta {
  playerId: string;
  displayName: string;
  position: string | null;
}

export interface NcaaPlayerSeasonRecord {
  source: typeof NCAA_SOURCE;
  externalId: string;
  displayName: string;
  leagueSlug: typeof NCAA_LEAGUE_SLUG;
  leagueName: typeof NCAA_LEAGUE_NAME;
  teamSlug: string;
  teamName: string;
  teamAbbreviation: string;
  seasonLabel: string;
  stats: {
    gamesPlayed: number;
    pointsPerGame: number;
    reboundsPerGame: number;
    assistsPerGame: number;
    stealsPerGame: number;
    blocksPerGame: number;
    fieldGoalPct?: number | null;
    threePointPct?: number | null;
  };
}

export interface HoopCentralIngestPayload {
  source: typeof NCAA_SOURCE;
  externalId: string;
  player: {
    displayName: string;
    birthDate?: string | null;
    position?: string | null;
    heightCm?: number | null;
    weightKg?: number | null;
    hometown?: string | null;
    headshotUrl?: string | null;
  };
  league: {
    slug: typeof NCAA_LEAGUE_SLUG;
    name: typeof NCAA_LEAGUE_NAME;
  };
  team: {
    slug: string;
    name: string;
    abbreviation: string;
  };
  season: {
    label: string;
  };
  stats: {
    gamesPlayed: number;
    pointsPerGame: number;
    reboundsPerGame: number;
    assistsPerGame: number;
    stealsPerGame?: number | null;
    blocksPerGame?: number | null;
    fieldGoalPct?: number | null;
    threePointPct?: number | null;
  };
}

export interface HoopCentralIngestResponse {
  ok: true;
  playerId: number;
  created: {
    player: boolean;
    league: boolean;
    team: boolean;
    season: boolean;
    stint: boolean;
    stats: boolean;
  };
}

export interface ScrapeOptions {
  backfill: boolean;
  dryRun: boolean;
  resume: boolean;
  useFixtures: boolean;
  limit?: number;
  playerSlug?: string;
  requestDelayMs: number;
  indexDelayMs: number;
  checkpointPath: string;
  logPath: string;
  slugCachePath: string;
  seasonCachePath: string;
  teamCachePath: string;
  linkCachePath: string;
  shardIndex: number;
  shardCount: number;
  rediscover?: boolean;
  discoverOnly?: boolean;
}

export interface ScrapeSummary {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  linked: number;
  seasonRows: number;
}

export interface CachedPlayerSeasons {
  version: 1;
  players: Record<
    string,
    {
      displayName: string;
      position: string | null;
      seasons: NcaaSeasonRow[];
    }
  >;
  updatedAt: string;
}
