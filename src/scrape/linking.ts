import { NCAA_SOURCE } from "../types.js";
import type { HcPlayerStatus, NcaaPlayerBio } from "../types.js";
import {
  ALL_USBASKET_NCAA_SOURCES,
  siblingUsbasketSources,
} from "../utils/usbasketSources.js";
import { loadLinkCache, normalizeName, saveLinkCache } from "./linkCache.js";

export interface LinkTarget {
  source: string;
  externalId: string;
}

export interface LinkResolver {
  resolveLinkTarget(
    playerId: string,
    displayName: string,
    birthDate: string | null,
    seasonLabels?: string[],
  ): Promise<LinkTarget | null>;
  rememberLink(playerId: string, target: LinkTarget): void;
}

/** Non-usbasket sources — require exact birthDate match on the scraped player. */
export const EXTERNAL_LINK_SOURCES = ["balldontlie", "basketball-reference-gleague"] as const;

/** @deprecated Use EXTERNAL_LINK_SOURCES */
export const LINK_SOURCES = EXTERNAL_LINK_SOURCES;

/** Would this birth year plausibly play in these college season labels? */
export function isPlausibleCollegeAge(
  birthDate: string,
  seasonLabels: string[],
): boolean {
  const birthYear = Number.parseInt(birthDate.slice(0, 4), 10);
  if (Number.isNaN(birthYear)) return false;

  const seasonYears = seasonLabels
    .map((label) => Number.parseInt(label.split("-")[0], 10))
    .filter((year) => !Number.isNaN(year));
  if (!seasonYears.length) return false;

  const minSeasonYear = Math.min(...seasonYears);
  const maxSeasonYear = Math.max(...seasonYears);
  const ageAtStart = minSeasonYear - 1 - birthYear;
  const ageAtEnd = maxSeasonYear - birthYear;
  return ageAtStart >= 17 && ageAtEnd <= 32;
}

export function buildNameLookup(players: HcPlayerStatus[]): Map<string, HcPlayerStatus[]> {
  const byName = new Map<string, HcPlayerStatus[]>();

  for (const player of players) {
    const key = normalizeName(player.displayName);
    const existing = byName.get(key) ?? [];
    existing.push(player);
    byName.set(key, existing);
  }

  return byName;
}

/**
 * Match an external (non-usbasket) identity only when scraped birthDate exactly matches.
 * Never link on name alone — prevents NBA/college namesake collisions.
 */
export function matchExternalId(
  displayName: string,
  birthDate: string | null,
  byName: Map<string, HcPlayerStatus[]>,
): string | null {
  if (!birthDate) return null;

  const key = normalizeName(displayName);
  const candidates = byName.get(key);
  if (!candidates?.length) return null;

  const dobMatches = candidates.filter((c) => c.birthDate === birthDate);
  if (dobMatches.length === 1) return dobMatches[0].externalId;
  return null;
}

function findCandidate(
  byName: Map<string, HcPlayerStatus[]>,
  displayName: string,
  externalId: string,
): HcPlayerStatus | undefined {
  return (byName.get(normalizeName(displayName)) ?? []).find(
    (candidate) => candidate.externalId === externalId,
  );
}

function cachedLinkIsValid(
  target: LinkTarget,
  displayName: string,
  birthDate: string | null,
  byName: Map<string, HcPlayerStatus[]>,
): boolean {
  if (ALL_USBASKET_NCAA_SOURCES.includes(target.source as (typeof ALL_USBASKET_NCAA_SOURCES)[number])) {
    return true;
  }

  const candidate = findCandidate(byName, displayName, target.externalId);
  if (!candidate) return false;
  if (!birthDate) return false;
  return candidate.birthDate === birthDate;
}

function parseCachedLink(raw: string): LinkTarget | null {
  if (raw.includes(":")) {
    const [source, ...rest] = raw.split(":");
    const externalId = rest.join(":");
    if (source && externalId) return { source, externalId };
  }

  return { source: "balldontlie", externalId: raw };
}

async function findUsbasketIdentityByPlayerId(
  playerId: string,
  loadCompletionStatus: (source: string) => Promise<HcPlayerStatus[]>,
  preferSources: readonly string[],
): Promise<LinkTarget | null> {
  for (const source of preferSources) {
    const players = await loadCompletionStatus(source);
    if (players.some((player) => player.externalId === playerId)) {
      return { source, externalId: playerId };
    }
  }
  return null;
}

export function createLinkResolver(options: {
  linkCachePath: string;
  loadCompletionStatus: (source: string) => Promise<HcPlayerStatus[]>;
  source?: string;
}): LinkResolver {
  const ingestSource = options.source ?? NCAA_SOURCE;
  const linkCache = loadLinkCache(options.linkCachePath);
  const lookups = new Map<string, Map<string, HcPlayerStatus[]>>();

  async function getLookup(source: string): Promise<Map<string, HcPlayerStatus[]>> {
    const cached = lookups.get(source);
    if (cached) return cached;

    const players = await options.loadCompletionStatus(source);
    const lookup = buildNameLookup(players);
    lookups.set(source, lookup);
    return lookup;
  }

  return {
    async resolveLinkTarget(playerId, displayName, birthDate, _seasonLabels = []) {
      const cached = linkCache.mappings[playerId];
      if (cached) {
        const target = parseCachedLink(cached);
        if (target) {
          if (ALL_USBASKET_NCAA_SOURCES.includes(target.source as (typeof ALL_USBASKET_NCAA_SOURCES)[number])) {
            if (target.externalId === playerId) return target;
            delete linkCache.mappings[playerId];
            saveLinkCache(options.linkCachePath, linkCache);
          } else {
            const lookup = await getLookup(target.source);
            if (cachedLinkIsValid(target, displayName, birthDate, lookup)) {
              return target;
            }
            delete linkCache.mappings[playerId];
            saveLinkCache(options.linkCachePath, linkCache);
          }
        }
      }

      // Same usbasket numeric ID across D1/D2/etc. → one website profile.
      const usbasketHit = await findUsbasketIdentityByPlayerId(
        playerId,
        options.loadCompletionStatus,
        siblingUsbasketSources(ingestSource),
      );
      if (usbasketHit) return usbasketHit;

      if (!birthDate) return null;

      for (const source of EXTERNAL_LINK_SOURCES) {
        const lookup = await getLookup(source);
        const externalId = matchExternalId(displayName, birthDate, lookup);
        if (externalId) return { source, externalId };
      }

      return null;
    },

    rememberLink(playerId, target) {
      linkCache.mappings[playerId] = `${target.source}:${target.externalId}`;
      saveLinkCache(options.linkCachePath, linkCache);
    },
  };
}

/** Identity/link only — never sends scraped bio fields (hometown, height, etc.). */
export function buildBioPayload(
  bio: Pick<NcaaPlayerBio, "playerId" | "displayName">,
  linkTo?: LinkTarget,
  source: string = NCAA_SOURCE,
) {
  return {
    source,
    externalId: bio.playerId,
    player: {
      displayName: bio.displayName,
    },
    ...(linkTo ? { linkTo } : {}),
  };
}

/** Full scraped bio for usbasket/eurobasket-only players (no authoritative HC profile yet). */
export function buildCareerBioPayload(
  bio: NcaaPlayerBio,
  linkTo?: LinkTarget,
  source: string = NCAA_SOURCE,
) {
  return {
    source,
    externalId: bio.playerId,
    player: {
      displayName: bio.displayName,
      birthDate: bio.birthDate,
      position: bio.position,
      heightCm: bio.heightCm,
      weightKg: bio.weightKg,
      hometown: bio.hometown,
    },
    ...(linkTo ? { linkTo } : {}),
  };
}

/** @deprecated Use buildNameLookup */
export const buildBdlLookup = buildNameLookup;

/** @deprecated Use matchExternalId */
export const matchBdlExternalId = matchExternalId;
