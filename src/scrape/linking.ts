import type { HcPlayerStatus, NcaaPlayerBio } from "../types.js";
import { NCAA_SOURCE } from "../types.js";
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
  ): Promise<LinkTarget | null>;
  rememberLink(playerId: string, target: LinkTarget): void;
}

export const LINK_SOURCES = ["balldontlie", "basketball-reference-gleague"] as const;

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

export function matchExternalId(
  displayName: string,
  birthDate: string | null,
  byName: Map<string, HcPlayerStatus[]>,
): string | null {
  const key = normalizeName(displayName);
  const candidates = byName.get(key);
  if (!candidates?.length) return null;

  if (birthDate) {
    const dobMatches = candidates.filter((c) => c.birthDate === birthDate);
    if (dobMatches.length === 1) return dobMatches[0].externalId;
    if (dobMatches.length > 1) return null;
  }

  if (candidates.length === 1) return candidates[0].externalId;
  return null;
}

function parseCachedLink(raw: string): LinkTarget | null {
  if (raw.includes(":")) {
    const [source, ...rest] = raw.split(":");
    const externalId = rest.join(":");
    if (source && externalId) return { source, externalId };
  }

  return { source: "balldontlie", externalId: raw };
}

export function createLinkResolver(options: {
  linkCachePath: string;
  loadCompletionStatus: (source: string) => Promise<HcPlayerStatus[]>;
}): LinkResolver {
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
    async resolveLinkTarget(playerId, displayName, birthDate) {
      const cached = linkCache.mappings[playerId];
      if (cached) return parseCachedLink(cached);

      for (const source of LINK_SOURCES) {
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
) {
  return {
    source: NCAA_SOURCE,
    externalId: bio.playerId,
    player: {
      displayName: bio.displayName,
    },
    ...(linkTo ? { linkTo } : {}),
  };
}

/** @deprecated Use buildNameLookup */
export const buildBdlLookup = buildNameLookup;

/** @deprecated Use matchExternalId */
export const matchBdlExternalId = matchExternalId;
