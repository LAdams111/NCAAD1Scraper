/** Active usbasket / Hoop Central league for this scraper build. */
export const NCAA_USBASKET_SEGMENT = "CCAA" as const;
/** Primary tag in recent profile/AJAX stat blocks. */
export const NCAA_USBASKET_TAG = "CCAA" as const;
/** CCAA profile pages label seasons by conference or adjacent Canadian college tags. */
export const NCAA_USBASKET_TAGS = [
  NCAA_USBASKET_TAG,
  "NAIA",
  "NCAA2",
  "JUCO",
  "ACAC",
  "PacWest",
  "OCAA",
  "RSEQ",
] as const;
export const NCAA_USBASKET_INDEX_URL =
  `https://www.usbasket.com/${NCAA_USBASKET_SEGMENT}/basketball-Players.aspx` as const;
/** Season param used to bootstrap the index year dropdown (CCAA data is sparse on current year). */
export const NCAA_USBASKET_BOOTSTRAP_YEAR = "2023-2024" as const;

export const NCAA_SOURCE = "usbasket-ccaa" as const;
export const NCAA_LEAGUE_SLUG = "ccaa" as const;
export const NCAA_LEAGUE_NAME = "CCAA" as const;

export const DEFAULT_CHECKPOINT = "scrape-ccaa-backfill.checkpoint.json";
export const DEFAULT_LOG = "scrape-ccaa-backfill.log";
export const DEFAULT_SLUG_CACHE = "ccaa-player-slugs.cache.json";
export const DEFAULT_SEASON_CACHE = "ccaa-player-seasons.cache.json";
export const DEFAULT_LINK_CACHE = "ccaa-to-bdl.cache.json";
