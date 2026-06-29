/** All Hoop Central ingest sources backed by usbasket.com player IDs. */
export const ALL_USBASKET_NCAA_SOURCES = [
  "usbasket-ncaa-d1",
  "usbasket-ncaa-d2",
  "usbasket-u-sports",
  "usbasket-ccaa",
] as const;

export type UsbasketNcaaSource = (typeof ALL_USBASKET_NCAA_SOURCES)[number];

/** Other usbasket NCAA sources (same numeric ID = same person). */
export function siblingUsbasketSources(currentSource: string): UsbasketNcaaSource[] {
  return ALL_USBASKET_NCAA_SOURCES.filter((source) => source !== currentSource);
}
