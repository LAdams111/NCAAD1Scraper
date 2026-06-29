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
  aliasMap: Record<string, string>;
  allTeams: Array<{
    teamName: string;
    teamAbbreviation: string;
    slug: string;
  }>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORT_PATH = resolve(__dirname, "../../ccaa-team-alias-report.json");

let cachedReport: UsportsTeamAliasReport | null = null;

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
  "chicago-r",
  "chomutov",
  "hoops",
  "jamestown-j",
  "maine-rc",
  "peja",
  "reno-b",
]);

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
  const slug = normalizeSlug(nameToSlug(cleaned));
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
