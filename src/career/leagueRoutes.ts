import { nameToSlug, teamAbbreviation } from "../utils/teams.js";
import {
  isValidUsportsTeamName,
  normalizeUsportsTeam,
} from "../utils/usportsTeams.js";

export interface LeagueRoute {
  source: typeof import("../types.js").CAREER_SOURCE;
  leagueSlug: string;
  leagueName: string;
  skip: boolean;
  skipReason?: string;
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function tagIncludes(leagueText: string, needles: readonly string[]): boolean {
  const normalized = normalizeTag(leagueText);
  return needles.some((needle) => {
    const target = normalizeTag(needle);
    return (
      normalized === target ||
      normalized.startsWith(`${target},`) ||
      normalized.includes(` ${target}`) ||
      normalized.includes(target)
    );
  });
}

function slugFromTag(leagueText: string): string {
  return nameToSlug(
    leagueText
      .split(",")[0]
      ?.replace(/[^a-z0-9]+/gi, " ")
      .trim() ?? leagueText,
  );
}

function displayNameFromTag(leagueText: string): string {
  const primary = leagueText.split(",")[0]?.trim() ?? leagueText;
  return primary
    .replace(/\b([a-z])/g, (match, letter: string) => letter.toUpperCase())
    .replace(/\bNcaa\b/i, "NCAA")
    .replace(/\bNba\b/i, "NBA");
}

/** True only for USBasket tags that clearly mean Australia's NBL. */
function isAustralianNblTag(leagueText: string): boolean {
  return tagIncludes(leagueText, [
    "AUSTRALIA-NBL",
    "AUSTRALIA NBL",
    "NBL AUSTRALIA",
    "AUS-NBL",
  ]);
}

function isLnbProATag(leagueText: string): boolean {
  if (/\bU21\b/i.test(leagueText)) return false;

  const primary = normalizeTag((leagueText.split(",")[0] ?? leagueText).trim());
  if (primary === "proa") return true;

  return tagIncludes(leagueText, [
    "JEEP ELITE",
    "BETCLIC ELITE",
    "ELITE PROA",
    "FRENCH LEAGUE",
  ]);
}

function isLnbU21Tag(leagueText: string): boolean {
  return tagIncludes(leagueText, ["LNB U21", "LNB YOUTH"]) || /\bU21\b/i.test(leagueText);
}

/** Spanish top division — USBasket uses ACB, Liga Endesa, and Spain-Liga Endesa interchangeably. */
function isLigaAcbTag(leagueText: string): boolean {
  if (tagIncludes(leagueText, ["ESP-1", "ACB", "LIGA ACB"])) return true;
  if (/\bLIGA\s+ENDESA\b/i.test(leagueText)) return true;
  if (/\bSPAIN[\s-]*LIGA\s+ENDESA\b/i.test(leagueText)) return true;
  return false;
}

/** Map usbasket Year-By-Year league tags to Hoop Central leagues. */
export function routeLeagueTag(
  leagueText: string,
  options: { skipAuthoritativeSources?: boolean } = {},
): LeagueRoute {
  const skipAuth = options.skipAuthoritativeSources !== false;

  if (skipAuth && tagIncludes(leagueText, ["NBA", "WNBA"])) {
    return {
      source: "usbasket-profile",
      leagueSlug: "nba",
      leagueName: "NBA",
      skip: true,
      skipReason: "authoritative-nba",
    };
  }

  if (
    skipAuth &&
    tagIncludes(leagueText, ["G-LEAGUE", "G LEAGUE", "NBAGL", "NBA G", "G-League"])
  ) {
    return {
      source: "usbasket-profile",
      leagueSlug: "g-league",
      leagueName: "NBA G League",
      skip: true,
      skipReason: "authoritative-g-league",
    };
  }

  if (tagIncludes(leagueText, ["NCAA2", "DIVISION II", " D2"])) {
    return {
      source: "usbasket-profile",
      leagueSlug: "ncaa-d2",
      leagueName: "NCAA Division II",
      skip: false,
    };
  }

  if (tagIncludes(leagueText, ["NCAA3", "DIVISION III", " D3"])) {
    return {
      source: "usbasket-profile",
      leagueSlug: "ncaa-d3",
      leagueName: "NCAA Division III",
      skip: false,
    };
  }

  if (tagIncludes(leagueText, ["NCAA1", "NCAA D1", "DIVISION I"])) {
    return {
      source: "usbasket-profile",
      leagueSlug: "ncaa",
      leagueName: "NCAA Division I",
      skip: false,
    };
  }

  if (tagIncludes(leagueText, ["NCAA"])) {
    return {
      source: "usbasket-profile",
      leagueSlug: "ncaa",
      leagueName: "NCAA Division I",
      skip: false,
    };
  }

  if (
    tagIncludes(leagueText, [
      "CCAA",
      "ACAA",
      "AASC",
      "ACAC",
      "PACWEST",
      "OCAA",
      "RSEQ",
    ])
  ) {
    return {
      source: "usbasket-profile",
      leagueSlug: "ccaa",
      leagueName: "CCAA",
      skip: false,
    };
  }

  if (tagIncludes(leagueText, ["U-SPORTS", "U SPORTS", "CIS"])) {
    return {
      source: "usbasket-profile",
      leagueSlug: "u-sports",
      leagueName: "U Sports",
      skip: false,
    };
  }

  if (tagIncludes(leagueText, ["HIGH SCHOOL", "HIGH-SCHOOL", "HS", "PREP"])) {
    return {
      source: "usbasket-profile",
      leagueSlug: "high-school",
      leagueName: "High School",
      skip: false,
    };
  }

  if (tagIncludes(leagueText, ["AAU"])) {
    return {
      source: "usbasket-profile",
      leagueSlug: "aau",
      leagueName: "AAU",
      skip: false,
    };
  }

  if (tagIncludes(leagueText, ["NAIA"])) {
    return {
      source: "usbasket-profile",
      leagueSlug: "naia",
      leagueName: "NAIA",
      skip: false,
    };
  }

  if (tagIncludes(leagueText, ["JUCO", "NJCAA"])) {
    return {
      source: "usbasket-profile",
      leagueSlug: "juco",
      leagueName: "JUCO",
      skip: false,
    };
  }

  if (tagIncludes(leagueText, ["OTE", "OVERTIME ELITE"])) {
    return {
      source: "usbasket-profile",
      leagueSlug: "ote",
      leagueName: "Overtime Elite (OTE)",
      skip: false,
    };
  }

  if (tagIncludes(leagueText, ["EUROL", "EUROLEAGUE"])) {
    return {
      source: "usbasket-profile",
      leagueSlug: "euroleague",
      leagueName: "EuroLeague",
      skip: false,
    };
  }

  if (isLigaAcbTag(leagueText)) {
    return {
      source: "usbasket-profile",
      leagueSlug: "acb",
      leagueName: "Liga ACB",
      skip: false,
    };
  }

  if (isAustralianNblTag(leagueText)) {
    return {
      source: "usbasket-profile",
      leagueSlug: "nbl",
      leagueName: "NBL Australia",
      skip: false,
    };
  }

  if (
    tagIncludes(leagueText, ["BAL", "BASKETBALL AFRICA LEAGUE", "BASKETBALL AFRICA"])
  ) {
    return {
      source: "usbasket-profile",
      leagueSlug: "bal",
      leagueName: "Basketball Africa League",
      skip: false,
    };
  }

  if (tagIncludes(leagueText, ["CBA", "CHINESE BASKETBALL"])) {
    return {
      source: "usbasket-profile",
      leagueSlug: "cba",
      leagueName: "Chinese Basketball Association",
      skip: false,
    };
  }

  if (tagIncludes(leagueText, ["B-LEAGUE", "B.LEAGUE", "JAPAN B LEAGUE"])) {
    return {
      source: "usbasket-profile",
      leagueSlug: "b-league",
      leagueName: "B.League (Japan)",
      skip: false,
    };
  }

  if (isLnbU21Tag(leagueText)) {
    return {
      source: "usbasket-profile",
      leagueSlug: "lnb-u21",
      leagueName: "LNB Pro A U21",
      skip: false,
    };
  }

  if (isLnbProATag(leagueText)) {
    return {
      source: "usbasket-profile",
      leagueSlug: "lnb-pro-a",
      leagueName: "LNB Pro A",
      skip: false,
    };
  }

  const slug = slugFromTag(leagueText);
  if (slug === "nbl" && !isAustralianNblTag(leagueText)) {
    const primary = leagueText.split(",")[0]?.trim() ?? leagueText;
    const distinctSlug = nameToSlug(primary);
    return {
      source: "usbasket-profile",
      leagueSlug: distinctSlug === "nbl" ? "nbl-other" : distinctSlug,
      leagueName: displayNameFromTag(leagueText),
      skip: false,
    };
  }

  return {
    source: "usbasket-profile",
    leagueSlug: slug || "unknown",
    leagueName: displayNameFromTag(leagueText),
    skip: false,
  };
}

export function normalizeCareerTeam(
  teamName: string,
  leagueSlug: string,
): { slug: string; name: string; abbreviation: string } {
  const cleaned = teamName.replace(/&quote;/g, "'").trim();

  if (leagueSlug === "ccaa" || leagueSlug === "u-sports") {
    if (isValidUsportsTeamName(cleaned)) {
      const team = normalizeUsportsTeam(cleaned);
      return team;
    }
  }

  const slug = nameToSlug(cleaned);
  return {
    slug: slug || "unknown-team",
    name: cleaned,
    abbreviation: teamAbbreviation(cleaned),
  };
}
