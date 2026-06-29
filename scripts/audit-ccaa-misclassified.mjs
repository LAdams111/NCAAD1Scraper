#!/usr/bin/env node
/**
 * Find CCAA cache seasons that likely came from US JUCO / wrong league data.
 *
 * Usage:
 *   node scripts/audit-ccaa-misclassified.mjs
 *   node scripts/audit-ccaa-misclassified.mjs --profiles   # verify via usbasket profile (slow)
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { DEFAULT_SEASON_CACHE } from "../dist/division.js";
import {
  isNonCcaaTeamLabel,
  isValidUsportsTeamName,
  teamNameWasRewritten,
} from "../dist/utils/usportsTeams.js";
import { normalizeSeasonLabel, seasonLabelFromYearParam } from "../dist/utils/season.js";
import { loadConfig } from "../dist/config.js";
import { UsbasketClient } from "../dist/usbasketClient.js";

function parseArgs(argv) {
  let profiles = false;
  let player;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--profiles") profiles = true;
    if (argv[i] === "--player") player = argv[++i]?.trim();
  }
  return { profiles, player };
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function seasonLabelFromCareerCell(raw) {
  const trimmed = raw.trim();
  const normalized = normalizeSeasonLabel(trimmed);
  if (normalized) return normalized;
  if (/^\d{2}-\d{2}$/.test(trimmed)) {
    const [start, end] = trimmed.split("-");
    return normalizeSeasonLabel(`20${start}-20${end}`);
  }
  if (/^\d{4}$/.test(trimmed)) {
    return seasonLabelFromYearParam(trimmed);
  }
  return null;
}

/** JUCO rows from usbasket career / ajax tables on a profile page. */
export function parseJucoSeasonFingerprints(html) {
  const rows = [];

  for (const match of html.matchAll(
    /<td[^>]*class="headcol"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>\s*JUCO\s*<\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>/gi,
  )) {
    const seasonLabel = seasonLabelFromCareerCell(match[1].replace(/<[^>]+>/g, "").trim());
    const teamName = match[2].replace(/<[^>]+>/g, "").replace(/&quote;/g, "'").trim();
    const gamesPlayed = Number.parseInt(match[3], 10);
    if (!seasonLabel || !teamName || !gamesPlayed) continue;
    rows.push({ seasonLabel, teamName, gamesPlayed, league: "JUCO" });
  }

  const headingMatch = /Season:\s*([0-9]{4}-[0-9]{4})\s*\(JUCO\)/i.exec(html);
  if (headingMatch) {
    const seasonLabel = normalizeSeasonLabel(headingMatch[1]);
    const teamMatch = /<td class="headcol">([^<]+)<\/td>\s*<td>\s*(\d+)\s*<\/td>\s*<td>[\d.]+<\/td>\s*<td>([\d.]+)<\/td>/i.exec(
      html,
    );
    if (seasonLabel && teamMatch) {
      rows.push({
        seasonLabel,
        teamName: teamMatch[1].replace(/&quote;/g, "'").trim(),
        gamesPlayed: Number.parseInt(teamMatch[2], 10),
        league: "JUCO",
      });
    }
  }

  return rows;
}

function fingerprintKey(row) {
  return `${row.seasonLabel}:${row.gamesPlayed}`;
}

function auditCacheEntry(playerId, entry) {
  const issues = [];
  for (const season of entry.seasons ?? []) {
    if (isNonCcaaTeamLabel(season.teamName)) {
      issues.push({
        playerId,
        displayName: entry.displayName,
        seasonLabel: season.seasonLabel,
        teamName: season.teamName,
        reason: "non-ccaa-team-label",
      });
      continue;
    }
    if (!isValidUsportsTeamName(season.teamName) && teamNameWasRewritten(season.teamName)) {
      issues.push({
        playerId,
        displayName: entry.displayName,
        seasonLabel: season.seasonLabel,
        teamName: season.teamName,
        reason: "ambiguous-team-rewrite",
      });
    }
  }
  return issues;
}

function parseLogHeuristicIssues(logText) {
  const issues = [];
  const blocks = logText.split(/\[\d+\/\d+\]/);
  for (const block of blocks) {
    const idMatch = /\((\d+)\)/.exec(block);
    if (!idMatch) continue;
    const playerId = idMatch[1];
    const nameMatch = /\]\s+([^(]+)\(\d+\)/.exec(`]${block}`);
    const displayName = nameMatch?.[1]?.trim() ?? playerId;
    const hadUsJucoSkip = /\[skip-team\][^\n]*Community College|\[skip-team\][^\n]*Ridgewater|\[skip-team\][^\n]*Mohawk Valley|\[skip-team\][^\n]*US\/other league/i.test(
      block,
    );
    if (!hadUsJucoSkip) continue;

    for (const seasonMatch of block.matchAll(/\[season\]\s+\d+\s+(\S+)\s+(\S+)\s+→/g)) {
      const seasonLabel = seasonMatch[1];
      const abbrev = seasonMatch[2];
      if (abbrev === "MOHAWK" && /^201[6-9]-/.test(seasonLabel)) {
        issues.push({
          playerId,
          displayName,
          seasonLabel,
          teamName: "Mohawk",
          reason: "log-heuristic-juco-mohawk",
        });
      }
    }
  }
  return issues;
}

const { profiles, player } = parseArgs(process.argv.slice(2));
const cache = loadJson(DEFAULT_SEASON_CACHE);
const issues = [];

for (const [playerId, entry] of Object.entries(cache.players)) {
  if (player && playerId !== player) continue;
  issues.push(...auditCacheEntry(playerId, entry));
}

for (const file of readdirSync(".").filter((name) => name.startsWith("scrape-ccaa-backfill") && name.endsWith(".log"))) {
  issues.push(...parseLogHeuristicIssues(readFileSync(file, "utf8")));
}

if (profiles) {
  const config = loadConfig();
  const client = new UsbasketClient(2000, 2000, config.usbasketCookie);
  await client.ensureLoggedIn(config.usbasketEmail, config.usbasketPassword);

  const candidates = new Set(issues.map((row) => row.playerId));
  for (const [playerId, entry] of Object.entries(cache.players)) {
    if (player && playerId !== player) continue;
    if ((entry.seasons ?? []).some((season) => season.gamesPlayed > 0)) {
      candidates.add(playerId);
    }
  }
  if (player) candidates.add(player);

  console.log(`Profile audit: checking ${candidates.size} player(s) with stat seasons…`);

  for (const playerId of candidates) {
    const entry = cache.players[playerId];
    if (!entry) continue;
    const html = await client.fetchHtml(
      `https://basketball.usbasket.com/player/Player-${playerId}/${playerId}`,
    );
    const jucoRows = parseJucoSeasonFingerprints(html);
    const jucoKeys = new Set(jucoRows.map(fingerprintKey));

    for (const season of entry.seasons ?? []) {
      if (!season.gamesPlayed) continue;
      const key = fingerprintKey(season);
      if (!jucoKeys.has(key)) continue;
      const juco = jucoRows.find((row) => fingerprintKey(row) === key);
      if (juco && isValidUsportsTeamName(season.teamName)) {
        issues.push({
          playerId,
          displayName: entry.displayName,
          seasonLabel: season.seasonLabel,
          teamName: season.teamName,
          jucoTeamName: juco.teamName,
          gamesPlayed: season.gamesPlayed,
          reason: "profile-juco-fingerprint-match",
        });
      }
    }
  }
}

const deduped = [...new Map(issues.map((row) => [
  `${row.playerId}:${row.seasonLabel}:${row.teamName}:${row.reason}`,
  row,
])).values()];

const outPath = "ccaa-misclassified-report.json";
writeFileSync(outPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), issues: deduped }, null, 2)}\n`);

console.log(`Found ${deduped.length} suspicious season(s). Report: ${outPath}`);
for (const row of deduped.slice(0, 30)) {
  console.log(
    `- ${row.playerId} ${row.displayName}: ${row.seasonLabel} @ ${row.teamName} (${row.reason})`,
  );
}
if (deduped.length > 30) console.log(`… and ${deduped.length - 30} more`);
