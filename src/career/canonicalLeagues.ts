import type { LeagueRoute } from "./leagueRoutes.js";

/**
 * USBasket sponsor renames / auto-slugs that must map to one Hoop Central league.
 * Keep in sync with Hoop Central server/src/utils/league-slug.ts INGEST_LEAGUE_SLUG_ALIASES.
 */
export const CANONICAL_LEAGUE_SLUG_ALIASES: Record<string, { slug: string; name: string }> = {
  "australia-nbl": { slug: "nbl", name: "NBL Australia" },
  proa: { slug: "lnb-pro-a", name: "LNB Pro A" },
  "jeep-elite-proa": { slug: "lnb-pro-a", name: "LNB Pro A" },
  "betclic-elite-proa": { slug: "lnb-pro-a", name: "LNB Pro A" },
  "spain-liga-endesa": { slug: "acb", name: "Liga ACB" },
  "liga-endesa": { slug: "acb", name: "Liga ACB" },
  "liga-acb": { slug: "acb", name: "Liga ACB" },
  "esp-1": { slug: "acb", name: "Liga ACB" },
};

/** Last-line defense: never ingest a deprecated auto-slug when a canonical league exists. */
export function applyCanonicalLeagueRoute(route: LeagueRoute): LeagueRoute {
  if (route.skip) return route;

  const canonical = CANONICAL_LEAGUE_SLUG_ALIASES[route.leagueSlug];
  if (!canonical) return route;

  return {
    ...route,
    leagueSlug: canonical.slug,
    leagueName: canonical.name,
  };
}
