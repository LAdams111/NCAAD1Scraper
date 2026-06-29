import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { nameToSlug, teamAbbreviation } from "./teams.js";

export interface UsportsTeamIdentity {
  slug: string;
  name: string;
  abbreviation: string;
}

export interface UsportsTeamAliasReport {
  generatedAt: string;
  source?: string;
  aliasMap: Record<string, string>;
  allTeams: Array<{
    teamName: string;
    teamAbbreviation: string;
    slug: string;
    conference?: string;
    usbasketSlug?: string;
    fullName?: string;
  }>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORT_PATH = resolve(__dirname, "../../ccaa-team-alias-report.json");

let cachedReport: UsportsTeamAliasReport | null = null;
let cachedSchoolKeyIndex: Map<string, string> | null = null;

export function normalizeSchoolKey(name: string): string {
  return name
    .replace(/&quote;/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\b(the|of|at|in)\b/g, " ")
    .replace(/\b(university|univ|college|institute|polytechnic|cegep)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildSchoolKeyIndex(report: UsportsTeamAliasReport): Map<string, string> {
  const index = new Map<string, string>();

  const register = (label: string | undefined, canonicalSlug: string) => {
    if (!label?.trim()) return;
    const key = normalizeSchoolKey(label);
    if (!key) return;
    index.set(key, canonicalSlug);
  };

  for (const team of report.allTeams) {
    const slug = normalizeSlug(team.slug);
    register(team.teamName, slug);
    register(team.fullName, slug);
    if (team.usbasketSlug) {
      register(team.usbasketSlug.replace(/-/g, " "), slug);
    }
  }

  for (const [aliasSlug, canonicalSlug] of Object.entries(report.aliasMap)) {
    register(aliasSlug.replace(/-/g, " "), normalizeSlug(canonicalSlug));
  }

  return index;
}

function schoolKeyIndex(report: UsportsTeamAliasReport): Map<string, string> {
  if (cachedSchoolKeyIndex && report === cachedReport) {
    return cachedSchoolKeyIndex;
  }
  cachedSchoolKeyIndex = buildSchoolKeyIndex(report);
  return cachedSchoolKeyIndex;
}

function lookupCanonicalSlugBySchoolKey(
  teamName: string,
  report: UsportsTeamAliasReport,
): string | null {
  const key = normalizeSchoolKey(teamName);
  if (!key) return null;

  const index = schoolKeyIndex(report);
  const exact = index.get(key);
  if (exact) return exact;

  let best: { slug: string; score: number } | null = null;
  for (const [candidateKey, slug] of index) {
    if (key === candidateKey) return slug;

    if (key.includes(candidateKey)) {
      if (significantExtraTokens(key, candidateKey).length > 0) continue;
    } else if (candidateKey.includes(key)) {
      if (significantExtraTokens(candidateKey, key).length > 0) continue;
    } else {
      continue;
    }

    const score = Math.min(key.length, candidateKey.length);
    if (!best || score > best.score) {
      best = { slug, score };
    }
  }

  return best?.slug ?? null;
}

export function getUsportsTeamAliasReportPath(): string {
  return (
    process.env.CCAA_TEAM_ALIAS_REPORT_PATH?.trim() ||
    process.env.USPORTS_TEAM_ALIAS_REPORT_PATH?.trim() ||
    DEFAULT_REPORT_PATH
  );
}

export function loadUsportsTeamAliasReport(
  reportPath = getUsportsTeamAliasReportPath(),
): UsportsTeamAliasReport {
  if (cachedReport && reportPath === getUsportsTeamAliasReportPath()) {
    return cachedReport;
  }

  const raw = readFileSync(reportPath, "utf8");
  const parsed = JSON.parse(raw) as UsportsTeamAliasReport;
  if (reportPath === getUsportsTeamAliasReportPath()) {
    cachedReport = parsed;
    cachedSchoolKeyIndex = null;
  }
  return parsed;
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase().replace(/^-|-$/g, "");
}

function titleCaseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveCanonicalIdentity(
  canonicalSlug: string,
  report: UsportsTeamAliasReport,
): UsportsTeamIdentity {
  const canonical = normalizeSlug(canonicalSlug);
  const entry = report.allTeams.find((team) => normalizeSlug(team.slug) === canonical);
  if (entry) {
    return {
      slug: canonical,
      name: entry.teamName,
      abbreviation: entry.teamAbbreviation,
    };
  }

  const fallbackName = titleCaseName(canonical.replace(/-/g, " "));
  return {
    slug: canonical,
    name: fallbackName,
    abbreviation: teamAbbreviation(fallbackName),
  };
}

/** USBasket sometimes puts pro/overseas or US-college labels on CCAA player profiles — never ingest these. */
export const USPORTS_EXCLUDED_TEAM_SLUGS = new Set([
  "barako-bull",
  "belfast-star",
  "benedict",
  "benedict-college",
  "big-bend-cc",
  "bronx-community-college",
  "chicago-r",
  "chomutov",
  "clark-college",
  "dodge-city-community-college",
  "everett-community-college",
  "garden-city-community-college",
  "highland-community-college-illinois",
  "hoops",
  "jamestown-j",
  "labette-community-college",
  "lamar-community-college",
  "macomb-community-college",
  "maine-rc",
  "mid-michigan-community-college",
  "mohawk-valley",
  "mohawk-valley-community-college",
  "neosho-county-community-college",
  "oakland-community-college",
  "onondaga-community-college",
  "peja",
  "potomac-state-college",
  "redlands-community-college",
  "reno-b",
  "ridgewater-college",
  "sussex-county-community-college",
  "walla-walla-community-college",
  "wayne-county-community-college",
  "st-clair-co-cc",
  "st-clair-county-community-college",
]);

/** Raw usbasket labels that are US JUCO / NCAA — never map into CCAA. */
const NON_CCAA_TEAM_PATTERNS = [
  /\bcommunity college\b/i,
  /\bjuco\b/i,
  /\bmohawk valley\b/i,
  /\bonondaga\b/i,
  /\bridgewater\b/i,
  /\bclark college\b/i,
  /\bgarden city\b/i,
  /\bmacomb\b/i,
  /\bdodge city\b/i,
  /\beverett community\b/i,
  /\blabette\b/i,
  /\blamar community\b/i,
  /\boakland community\b/i,
  /\bwayne county community\b/i,
  /\bhighland community college\b/i,
  /\bwalla walla community\b/i,
  /\bblue mountain community\b/i,
  /\bbronx community\b/i,
  /\bsussex county community\b/i,
  /\bneosho county community\b/i,
  /\bredlands community\b/i,
  /\bpotomac state\b/i,
  /\bmississippi coll\b/i,
  /\bmaryville university\b/i,
  /\bw\.?\s*michigan\b/i,
  /\bclaflin\b/i,
  /\bsouthwestern christian\b/i,
  /\bco\.?\s*cc\b/i,
  /\bst\.?\s*clair co\b/i,
];

export function isNonCcaaTeamLabel(teamName: string): boolean {
  const cleaned = teamName.replace(/&quote;/g, "'").trim();
  if (!cleaned) return false;

  const slug = normalizeSlug(nameToSlug(cleaned.replace(/[''.]/g, "").replace(/,/g, " ")));
  if (USPORTS_EXCLUDED_TEAM_SLUGS.has(slug)) return true;

  return NON_CCAA_TEAM_PATTERNS.some((pattern) => pattern.test(cleaned));
}

function significantExtraTokens(longerKey: string, shorterKey: string): string[] {
  if (!longerKey.includes(shorterKey)) return [longerKey];
  const remainder = longerKey.replace(shorterKey, "").trim();
  if (!remainder) return [];
  return remainder.split(/\s+/).filter(Boolean);
}

function buildUsportsAllowlist(report: UsportsTeamAliasReport): Set<string> {
  const allowed = new Set<string>();
  for (const team of report.allTeams) {
    const slug = normalizeSlug(team.slug);
    if (!USPORTS_EXCLUDED_TEAM_SLUGS.has(slug)) {
      allowed.add(slug);
    }
  }
  return allowed;
}

export function isValidUsportsTeamName(
  teamName: string,
  report: UsportsTeamAliasReport = loadUsportsTeamAliasReport(),
): boolean {
  if (isNonCcaaTeamLabel(teamName)) return false;

  const team = normalizeUsportsTeam(teamName, report);
  if (USPORTS_EXCLUDED_TEAM_SLUGS.has(team.slug)) return false;

  const allowed = buildUsportsAllowlist(report);
  return allowed.has(team.slug);
}

export function filterValidUsportsSeasons<
  T extends { teamName: string; seasonLabel: string; teamAbbreviation?: string },
>(
  seasons: T[],
  report: UsportsTeamAliasReport = loadUsportsTeamAliasReport(),
): T[] {
  const normalized: T[] = [];

  for (const season of seasons) {
    if (!isValidUsportsTeamName(season.teamName, report)) continue;
    const identity = normalizeUsportsTeam(season.teamName, report);
    normalized.push({
      ...season,
      teamName: identity.name,
      teamAbbreviation: identity.abbreviation,
    });
  }

  return normalized;
}

/** Collapse usbasket CCAA team label variants to one canonical team. */
export function normalizeUsportsTeam(
  teamName: string,
  report: UsportsTeamAliasReport = loadUsportsTeamAliasReport(),
): UsportsTeamIdentity {
  const cleaned = teamName.replace(/&quote;/g, "'").trim();
  const slug = normalizeSlug(
    nameToSlug(cleaned.replace(/[''.]/g, "").replace(/,/g, " ")),
  );
  let canonicalSlug = normalizeSlug(report.aliasMap[slug] ?? slug);

  const allowed = buildUsportsAllowlist(report);
  if (!allowed.has(canonicalSlug) && canonicalSlug.endsWith("-college")) {
    const withoutCollege = canonicalSlug.replace(/-college$/, "");
    if (allowed.has(withoutCollege)) {
      canonicalSlug = withoutCollege;
    }
  }
  if (!allowed.has(canonicalSlug) && canonicalSlug.startsWith("college-")) {
    const withoutPrefix = canonicalSlug.slice("college-".length);
    if (allowed.has(withoutPrefix)) {
      canonicalSlug = withoutPrefix;
    }
  }
  if (!allowed.has(canonicalSlug)) {
    const fromKey = lookupCanonicalSlugBySchoolKey(cleaned, report);
    if (fromKey && allowed.has(fromKey)) {
      canonicalSlug = fromKey;
    }
  }

  const identity = resolveCanonicalIdentity(canonicalSlug, report);

  if (identity.slug === slug) {
    return {
      slug,
      name: titleCaseName(cleaned),
      abbreviation: teamAbbreviation(titleCaseName(cleaned)),
    };
  }

  return identity;
}

/** True when fuzzy school-key matching rewrote the label to a different canonical CCAA team. */
export function teamNameWasRewritten(
  teamName: string,
  report: UsportsTeamAliasReport = loadUsportsTeamAliasReport(),
): boolean {
  const cleaned = teamName.replace(/&quote;/g, "'").trim();
  const directSlug = normalizeSlug(
    nameToSlug(cleaned.replace(/[''.]/g, "").replace(/,/g, " ")),
  );
  const identity = normalizeUsportsTeam(cleaned, report);
  if (directSlug === identity.slug) return false;
  if (normalizeSlug(report.aliasMap[directSlug] ?? directSlug) === identity.slug) return false;
  return true;
}
