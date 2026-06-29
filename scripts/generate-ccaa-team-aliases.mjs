#!/usr/bin/env node
/**
 * Build ccaa-team-alias-report.json from the official CCAA teams page plus season cache variants.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { load } from "cheerio";
import { DEFAULT_SEASON_CACHE } from "../dist/division.js";
import { normalizeSchoolKey, USPORTS_EXCLUDED_TEAM_SLUGS } from "../dist/utils/usportsTeams.js";
import { nameToSlug, teamAbbreviation } from "../dist/utils/teams.js";

const TEAMS_URL = "https://www.usbasket.com/CCAA/teams.aspx";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function titleCaseName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function usbasketSlugToName(usbasketSlug) {
  return titleCaseName(usbasketSlug.replace(/-/g, " "));
}

function addAlias(aliasMap, fromSlug, canonicalSlug) {
  const from = fromSlug.trim().toLowerCase();
  const canonical = canonicalSlug.trim().toLowerCase();
  if (!from || !canonical || from === canonical) return;
  if (USPORTS_EXCLUDED_TEAM_SLUGS.has(from) || USPORTS_EXCLUDED_TEAM_SLUGS.has(canonical)) return;
  aliasMap[from] = canonical;
}

function parseTeamsPage(html) {
  const $ = load(html);
  const teams = [];

  $("table.CollegeTeamTable").each((_, table) => {
    const conference =
      $(table).find("thead th").first().text().replace(/\s+teams?$/i, "").trim() || "CCAA";

    $(table)
      .find("tbody tr")
      .each((__, row) => {
        const link = $(row).find("a[href*='/team/CCAA/']").first();
        const href = link.attr("href") ?? "";
        const label = link.text().trim();
        const match = /\/team\/CCAA\/([^/]+)\/\d+/i.exec(href);
        if (!match || !label) return;

        const usbasketSlug = match[1];
        const canonicalSlug = nameToSlug(label);
        if (USPORTS_EXCLUDED_TEAM_SLUGS.has(canonicalSlug)) return;

        teams.push({
          teamName: titleCaseName(label),
          teamAbbreviation: teamAbbreviation(label),
          slug: canonicalSlug,
          usbasketSlug,
          conference,
          fullName: usbasketSlugToName(usbasketSlug),
        });
      });
  });

  return teams;
}

async function fetchTeamsPage() {
  const response = await fetch(TEAMS_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch CCAA teams page (${response.status})`);
  }
  return response.text();
}

function mergeCacheVariants(allTeams, aliasMap) {
  let cache;
  try {
    cache = JSON.parse(readFileSync(DEFAULT_SEASON_CACHE, "utf8"));
  } catch {
    return;
  }

  const canonicalByKey = new Map();
  for (const team of allTeams) {
    canonicalByKey.set(normalizeSchoolKey(team.teamName), team.slug);
    canonicalByKey.set(normalizeSchoolKey(team.fullName), team.slug);
    canonicalByKey.set(normalizeSchoolKey(team.usbasketSlug.replace(/-/g, " ")), team.slug);
  }

  for (const entry of Object.values(cache.players ?? {})) {
    for (const season of entry.seasons ?? []) {
      const teamName = season.teamName.replace(/&quote;/g, "'").trim();
      if (!teamName) continue;

      const slug = nameToSlug(teamName);
      if (USPORTS_EXCLUDED_TEAM_SLUGS.has(slug)) continue;

      const key = normalizeSchoolKey(teamName);
      const canonical = canonicalByKey.get(key);
      if (canonical) {
        addAlias(aliasMap, slug, canonical);
        continue;
      }

      for (const [teamKey, teamSlug] of canonicalByKey) {
        if (key.includes(teamKey) || teamKey.includes(key)) {
          addAlias(aliasMap, slug, teamSlug);
          break;
        }
      }
    }
  }
}

const html = await fetchTeamsPage();
const parsedTeams = parseTeamsPage(html);
if (!parsedTeams.length) {
  throw new Error("No CCAA teams parsed from teams page");
}

const aliasMap = {};
const allTeams = [];

for (const team of parsedTeams) {
  allTeams.push({
    teamName: team.teamName,
    teamAbbreviation: team.teamAbbreviation,
    slug: team.slug,
    conference: team.conference,
    usbasketSlug: team.usbasketSlug,
    fullName: team.fullName,
  });

  addAlias(aliasMap, nameToSlug(team.fullName), team.slug);
  addAlias(aliasMap, nameToSlug(team.usbasketSlug.replace(/-/g, " ")), team.slug);
  addAlias(aliasMap, team.usbasketSlug.toLowerCase(), team.slug);
}

mergeCacheVariants(allTeams, aliasMap);

allTeams.sort((a, b) => a.teamName.localeCompare(b.teamName));

const report = {
  generatedAt: new Date().toISOString(),
  source: TEAMS_URL,
  aliasMap,
  allTeams,
};

writeFileSync("ccaa-team-alias-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  `Wrote ccaa-team-alias-report.json (${Object.keys(aliasMap).length} aliases, ${allTeams.length} CCAA member teams)`,
);
