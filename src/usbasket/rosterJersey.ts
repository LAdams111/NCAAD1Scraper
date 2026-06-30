/** Resolve jersey numbers from USBasket team roster pages (public HTML). */

export function extractTeamRosterBases(html: string): string[] {
  const bases = new Set<string>();
  const pattern =
    /https?:\/\/basketball\.usbasket\.com\/team\/[^"'<\s]+\/\d+\/Roster/gi;

  for (const match of html.matchAll(pattern)) {
    bases.add(match[0].replace(/\/+$/, ""));
  }

  return [...bases];
}

export function extractSeasonLabelsFromProfile(html: string): string[] {
  const labels = new Set<string>();
  for (const match of html.matchAll(/Season:\s*([0-9]{4}-[0-9]{4})/gi)) {
    labels.add(match[1]);
  }
  return [...labels];
}

export function listProfileStatsSeasonParams(html: string, externalId: string): string[] {
  const escaped = externalId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`loadStatsData\\('${escaped}','([^']+)'\\)`, "g");
  return [...new Set([...html.matchAll(pattern)].map((match) => match[1]))];
}

/** USBasket roster URLs use several season slug formats. */
export function seasonSlugCandidates(yearParam: string): string[] {
  const trimmed = yearParam.trim();
  if (/^[0-9]{4}-[0-9]{4}$/.test(trimmed)) {
    return [trimmed];
  }

  const year = Number.parseInt(trimmed, 10);
  if (Number.isNaN(year)) return [trimmed];

  const shortNext = String((year + 1) % 100).padStart(2, "0");
  return [
    `${year - 1}-${year}`,
    `${year - 1}-${shortNext}`,
    `${year}-${year + 1}`,
    `${year}-${shortNext}`,
    trimmed,
  ];
}

export function buildRosterUrls(rosterBases: string[], seasonSlugs: string[]): string[] {
  const urls = new Set<string>();
  for (const base of rosterBases) {
    for (const slug of seasonSlugs) {
      urls.add(`${base}/${slug}`);
    }
  }
  return [...urls];
}

export function parseJerseyFromRosterHtml(html: string, externalId: string): string | null {
  const escaped = externalId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `class="ArRosterjersey[^"]*"\\s*>\\s*(\\d{1,2})\\s*</div>\\s*<div class="ArRostername[^"]*"\\s*>\\s*<a[^>]+/${escaped}(?:["'])`,
    "is",
  );
  const match = pattern.exec(html);
  return match?.[1] ?? null;
}

export async function resolveJerseyFromRosters(
  fetchHtml: (url: string) => Promise<string>,
  profileHtml: string,
  externalId: string,
  maxFetches = 4,
): Promise<string | null> {
  const rosterBases = extractTeamRosterBases(profileHtml);
  if (rosterBases.length === 0) return null;

  const seasonSlugs = new Set<string>();
  for (const label of extractSeasonLabelsFromProfile(profileHtml)) {
    seasonSlugs.add(label);
  }
  for (const param of listProfileStatsSeasonParams(profileHtml, externalId)) {
    for (const slug of seasonSlugCandidates(param)) {
      seasonSlugs.add(slug);
    }
  }

  if (seasonSlugs.size === 0) return null;

  const urls = buildRosterUrls(rosterBases, [...seasonSlugs]).slice(0, maxFetches);

  for (const url of urls) {
    try {
      const html = await fetchHtml(url);
      const jersey = parseJerseyFromRosterHtml(html, externalId);
      if (jersey) return jersey;
    } catch {
      /* try next roster season */
    }
  }

  return null;
}
