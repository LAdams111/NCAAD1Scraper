/** Active usbasket / Hoop Central league for this scraper build. */
export const NCAA_USBASKET_SEGMENT = "CCAA" as const;
/** Primary tag in recent profile/AJAX stat blocks. */
export const NCAA_USBASKET_TAG = "CCAA" as const;
/** Member conferences / leagues that count as CCAA for ingest. */
export const NCAA_USBASKET_MEMBER_TAGS = [
  NCAA_USBASKET_TAG,
  "ACAA",
  "AASC",
  "ACAC",
  "PacWest",
  "OCAA",
  "RSEQ",
] as const;
/** @deprecated Use NCAA_USBASKET_MEMBER_TAGS — US JUCO/NCAA tags must never match CCAA stats. */
export const NCAA_USBASKET_TAGS = NCAA_USBASKET_MEMBER_TAGS;
/** usbasket league labels that are never CCAA (US JUCO, NCAA, U Sports, pro, etc.). */
export const NCAA_USBASKET_EXCLUDED_LEAGUE_TAGS = [
  "JUCO",
  "NAIA",
  "NCAA1",
  "NCAA2",
  "NCCAA",
  "USCAA",
  "USPO",
  "U-SPORTS",
  "U SPORTS",
  "NBA",
  "EUROL",
  "EUROcup",
  "ESP-1",
  "NCAA",
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
