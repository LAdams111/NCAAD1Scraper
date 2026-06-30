const INDEX_PAGE_PATH = /basketball-Players\.aspx/i;
const PAGINATION_PARAM = /^(Page|page|Pageno|PageNo|PageIndex|Start|StartRow|offset|Offset)$/i;

function normalizeIndexHref(href: string, origin: string): string | null {
  const trimmed = href.trim().replace(/&amp;/g, "&");
  if (!trimmed || trimmed.startsWith("#") || /^javascript:/i.test(trimmed)) return null;

  try {
    const url = trimmed.startsWith("http")
      ? new URL(trimmed)
      : new URL(trimmed.startsWith("/") ? trimmed : `/${trimmed}`, origin);
    if (!INDEX_PAGE_PATH.test(url.pathname)) return null;
    if (url.searchParams.get("women") === "1") return null;
    return url.href;
  } catch {
    return null;
  }
}

function isPaginationUrl(base: URL, candidate: URL): boolean {
  if (base.pathname !== candidate.pathname) return false;
  const baseYear = base.searchParams.get("Year");
  const candidateYear = candidate.searchParams.get("Year");
  if (baseYear && candidateYear && baseYear !== candidateYear) return false;

  for (const key of candidate.searchParams.keys()) {
    if (PAGINATION_PARAM.test(key)) return true;
  }
  return false;
}

/** Collect same-season index URLs that look like pagination (page 2, 3, …). */
export function listSegmentIndexPageUrls(html: string, currentUrl: string): string[] {
  const base = new URL(currentUrl);
  const urls = new Set<string>([base.href]);

  for (const match of html.matchAll(/href="([^"]+)"/gi)) {
    const resolved = normalizeIndexHref(match[1], base.origin);
    if (!resolved) continue;
    const candidate = new URL(resolved);
    if (candidate.href === base.href) continue;
    if (!isPaginationUrl(base, candidate)) continue;
    urls.add(candidate.href);
  }

  for (const match of html.matchAll(/href='([^']+)'/gi)) {
    const resolved = normalizeIndexHref(match[1], base.origin);
    if (!resolved) continue;
    const candidate = new URL(resolved);
    if (candidate.href === base.href) continue;
    if (!isPaginationUrl(base, candidate)) continue;
    urls.add(candidate.href);
  }

  return [...urls].sort((a, b) => a.localeCompare(b));
}
