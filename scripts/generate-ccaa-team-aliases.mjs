#!/usr/bin/env node
/**
 * Build ccaa-team-alias-report.json from the season cache.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  DEFAULT_SEASON_CACHE,
} from "../dist/division.js";
import {
  USPORTS_EXCLUDED_TEAM_SLUGS,
} from "../dist/utils/usportsTeams.js";
import { nameToSlug, teamAbbreviation } from "../dist/utils/teams.js";

function normalizeSchoolKey(name) {
  return name
    .replace(/&quote;/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\b(the|of|at)\b/g, " ")
    .replace(/\b(university|univ)\b/g, " ")
    .replace(/\b(college)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleCaseName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const cache = JSON.parse(readFileSync(DEFAULT_SEASON_CACHE, "utf8"));
const occurrences = [];

for (const entry of Object.values(cache.players)) {
  for (const season of entry.seasons ?? []) {
    const teamName = season.teamName.replace(/&quote;/g, "'").trim();
    if (!teamName) continue;
    const slug = nameToSlug(teamName);
    if (USPORTS_EXCLUDED_TEAM_SLUGS.has(slug)) continue;
    occurrences.push({
      teamName,
      slug: nameToSlug(teamName),
      seasonLabel: season.seasonLabel,
    });
  }
}

const byKey = new Map();
for (const row of occurrences) {
  const key = normalizeSchoolKey(row.teamName);
  if (!key) continue;
  const group = byKey.get(key) ?? { names: new Map(), slugs: new Map() };
  group.names.set(row.teamName, (group.names.get(row.teamName) ?? 0) + 1);
  group.slugs.set(row.slug, (group.slugs.get(row.slug) ?? 0) + 1);
  byKey.set(key, group);
}

const aliasMap = {};
const allTeams = [];

for (const [key, group] of byKey) {
  const canonicalName = [...group.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const canonicalSlug = nameToSlug(titleCaseName(canonicalName));
  const canonicalDisplay = titleCaseName(canonicalName);
  if (USPORTS_EXCLUDED_TEAM_SLUGS.has(canonicalSlug)) continue;

  allTeams.push({
    teamName: canonicalDisplay,
    teamAbbreviation: teamAbbreviation(canonicalDisplay),
    slug: canonicalSlug,
    seasonMin: "",
    seasonMax: "",
    seasonCount: 0,
    playerSeasonRows: [...group.names.values()].reduce((sum, count) => sum + count, 0),
  });

  for (const slug of group.slugs.keys()) {
    if (slug !== canonicalSlug) {
      aliasMap[slug] = canonicalSlug;
    }
  }
}

allTeams.sort((a, b) => a.teamName.localeCompare(b.teamName));

const report = {
  generatedAt: new Date().toISOString(),
  aliasMap,
  allTeams,
};

writeFileSync("ccaa-team-alias-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  `Wrote ccaa-team-alias-report.json (${Object.keys(aliasMap).length} aliases, ${allTeams.length} canonical teams)`,
);
