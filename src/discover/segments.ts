export type DiscoverHost = "usbasket" | "eurobasket";

export interface DiscoverSegment {
  id: string;
  host: DiscoverHost;
  label: string;
}

/** Men's league segments on usbasket.com (from site navigation). */
export const USBASKET_MENS_SEGMENTS: readonly DiscoverSegment[] = [
  { id: "NBA", host: "usbasket", label: "NBA" },
  { id: "NBA-G-League", host: "usbasket", label: "NBA G League" },
  { id: "NCAA1", host: "usbasket", label: "NCAA Division I" },
  { id: "NCAA2", host: "usbasket", label: "NCAA Division II" },
  { id: "NCAA3", host: "usbasket", label: "NCAA Division III" },
  { id: "NAIA", host: "usbasket", label: "NAIA" },
  { id: "JUCO", host: "usbasket", label: "JUCO" },
  { id: "USCAA-NCCAA", host: "usbasket", label: "USCAA / NCCAA" },
  { id: "High-Schools", host: "usbasket", label: "High Schools" },
  { id: "ABA", host: "usbasket", label: "ABA" },
  { id: "Big3", host: "usbasket", label: "Big3" },
  { id: "ECBL", host: "usbasket", label: "ECBL" },
  { id: "FBA", host: "usbasket", label: "FBA" },
  { id: "MABA", host: "usbasket", label: "MABA" },
  { id: "MBL", host: "usbasket", label: "MBL" },
  { id: "NBL-US", host: "usbasket", label: "NBL US" },
  { id: "OTE", host: "usbasket", label: "OTE" },
  { id: "PG-League", host: "usbasket", label: "PGL" },
  { id: "SEBL", host: "usbasket", label: "SEBL" },
  { id: "TBA", host: "usbasket", label: "TBA" },
  { id: "TBL", host: "usbasket", label: "TBL" },
  { id: "TBT", host: "usbasket", label: "TBT" },
  { id: "UBA", host: "usbasket", label: "UBA" },
  { id: "USBL", host: "usbasket", label: "USBL" },
  { id: "The-V-League", host: "usbasket", label: "V League" },
  { id: "BSL", host: "usbasket", label: "BSL" },
  { id: "NBLCanada", host: "usbasket", label: "NBL Canada" },
  { id: "CEBL", host: "usbasket", label: "CEBL" },
  { id: "U-Sports", host: "usbasket", label: "U Sports" },
  { id: "CCAA", host: "usbasket", label: "CCAA" },
] as const;

/** Fallback season params when a segment page has no year dropdown. */
export const FALLBACK_YEAR_PARAMS = [
  "2008",
  "2009",
  "2010",
  "2011",
  "2012",
  "2013",
  "2014",
  "2015",
  "2016",
  "2017",
  "2018",
  "2019",
  "2020",
  "2021",
  "2022",
  "2023",
  "2024",
  "2025",
  "2022-2023",
  "2023-2024",
  "2024-2025",
  "2025-2026",
] as const;

const EUROBASKET_COUNTRY_PATTERN =
  /href="https:\/\/www\.eurobasket\.com\/([^"/]+)\/basketball\.aspx"/gi;

/** Parse country segments from any eurobasket.com navigation page. */
export function parseEurobasketCountriesFromHtml(html: string): DiscoverSegment[] {
  const seen = new Set<string>();
  const segments: DiscoverSegment[] = [];

  for (const match of html.matchAll(EUROBASKET_COUNTRY_PATTERN)) {
    const id = match[1]?.trim();
    if (!id || seen.has(id)) continue;
    if (/news_system|service|images|javascript/i.test(id)) continue;
    seen.add(id);
    segments.push({
      id,
      host: "eurobasket",
      label: id.replace(/-/g, " "),
    });
  }

  return segments.sort((a, b) => a.id.localeCompare(b.id));
}

export function segmentKey(segment: DiscoverSegment, women: boolean): string {
  return `${segment.host}:${segment.id}${women ? ":women" : ""}`;
}

export function taskKey(segment: DiscoverSegment, yearParam: string, women: boolean): string {
  return `${segmentKey(segment, women)}:${yearParam}`;
}

/** Checkpoint marker for the extra index-page supplement pass (page 2+). */
export function taskSupplementKey(taskKeyValue: string): string {
  return `${taskKeyValue}:pages-supplement`;
}

export function resolveDiscoverSegments(options: {
  includeEurobasket: boolean;
  eurobasketCountries?: DiscoverSegment[];
  segmentFilter?: string;
}): DiscoverSegment[] {
  const segments: DiscoverSegment[] = [...USBASKET_MENS_SEGMENTS];
  if (options.includeEurobasket && options.eurobasketCountries?.length) {
    segments.push(...options.eurobasketCountries);
  }

  if (!options.segmentFilter?.trim()) {
    return segments;
  }

  const needle = options.segmentFilter.trim();
  const exact = segments.filter(
    (segment) => segment.id.toLowerCase() === needle.toLowerCase(),
  );
  if (exact.length) return exact;

  const lower = needle.toLowerCase();
  return segments.filter(
    (segment) =>
      segment.label.toLowerCase().includes(lower) ||
      segmentKey(segment, false).toLowerCase().includes(lower),
  );
}
