import { load } from "cheerio";
import type { NcaaPlayerBio } from "../types.js";

const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

/** "Nov.16, 2006" / "November 16 2006" → "2006-11-16" */
export function parseUsbasketBirthDate(raw: string): string | null {
  const match = /([A-Za-z]+)\.?\s*(\d{1,2}),?\s+(\d{4})/.exec(raw.trim());
  if (!match) return null;

  const monthKey = match[1].toLowerCase().replace(/\./g, "");
  const month = MONTHS[monthKey];
  if (!month) return null;

  const day = match[2].padStart(2, "0");
  const year = match[3];
  return `${year}-${month}-${day}`;
}

function extractBirthDateFromText(text: string): string | null {
  const bornOn = /born on\s+([A-Za-z]+\.?\s*\d{1,2},?\s*\d{4})/i.exec(text);
  if (bornOn) return parseUsbasketBirthDate(bornOn[1]);

  const faqBorn = /was born on\s+([A-Za-z]+\.?\s*\d{1,2},?\s*\d{4})/i.exec(text);
  if (faqBorn) return parseUsbasketBirthDate(faqBorn[1]);

  return null;
}

/** Authenticated usbasket pages redact DOB in cheerio body text but leave it in raw HTML. */
function extractBirthDateFromHtml(html: string): string | null {
  const profileLine =
    /([A-Za-z]+\.?\s*\d{1,2},\s*\d{4})\s*<br\s*\/?>\s*[\r\n]*\s*Full name:/i.exec(html);
  if (profileLine) {
    const parsed = parseUsbasketBirthDate(profileLine[1]);
    if (parsed) return parsed;
  }

  const anchorDob = />([A-Za-z]+\.?\s*\d{1,2},\s*\d{4})<\/a>\s*<span class="testdv">\s*in/i.exec(
    html,
  );
  if (anchorDob) {
    const parsed = parseUsbasketBirthDate(anchorDob[1]);
    if (parsed) return parsed;
  }

  return extractBirthDateFromText(html);
}

function normalizeHometown(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Reject redacted profile text and career-table junk mistaken for a city. */
export function isPlausibleHometown(value: string | null | undefined): boolean {
  const hometown = value?.trim();
  if (!hometown || hometown.length > 80) return false;
  if (/\*{2,}/.test(hometown)) return false;
  if (/full name|year-by-year|starting five|\bgames:/i.test(hometown)) return false;
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(hometown)) return false;
  return true;
}

function sanitizeHometown(value: string | null | undefined): string | null {
  if (!value) return null;
  const hometown = normalizeHometown(value);
  return isPlausibleHometown(hometown) ? hometown : null;
}

/** Birth city from the structured Born: … in City link (works when body text is redacted). */
function extractHometownFromHtml(html: string): string | null {
  const structured = /<span class="testdv">\s*in\s*<a[^>]*>\s*([^<]+?)\s*<\/a>/i.exec(html);
  if (structured) {
    const parsed = sanitizeHometown(structured[1]);
    if (parsed) return parsed;
  }

  return null;
}

function extractHometownFromText(text: string): string | null {
  const bornIn = /born in\s+([^.<]+?)(?:\.|\s+He\s|\s+She\s|$)/i.exec(text);
  if (bornIn) {
    const parsed = sanitizeHometown(bornIn[1]);
    if (parsed) return parsed;
  }

  const faq = /Where was [^?]+\?<\/h3><p>[^<]+ was born in\s+([^.<]+)/i.exec(text);
  if (faq) {
    const parsed = sanitizeHometown(faq[1]);
    if (parsed) return parsed;
  }

  return null;
}

function extractHeightCm(text: string): number | null {
  const cm = /(\d{3})\s*cm/i.exec(text);
  if (cm) {
    const parsed = Number.parseInt(cm[1], 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const feet = /(\d)'(\d{1,2})/.exec(text);
  if (feet) {
    const totalInches = Number.parseInt(feet[1], 10) * 12 + Number.parseInt(feet[2], 10);
    return Math.round(totalInches * 2.54);
  }

  return null;
}

function extractWeightKg(text: string): number | null {
  const kg = /(\d{2,3})\s*kg/i.exec(text);
  if (kg) {
    const parsed = Number.parseInt(kg[1], 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const lbs = /(\d{2,3})\s*lbs/i.exec(text);
  if (lbs) {
    const parsed = Number.parseInt(lbs[1], 10);
    return Number.isNaN(parsed) ? null : Math.round(parsed / 2.20462);
  }

  return null;
}

function titleCaseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isPlaceholderDisplayName(name: string | null | undefined): boolean {
  if (!name?.trim()) return true;
  return /^Player[- ]\d+$/i.test(name.trim());
}

function extractDisplayName(html: string, playerId: string, fallback?: string): string {
  const titleMatch = /<h1[^>]*class="[^"]*player-title[^"]*"[^>]*>([^<]+)/i.exec(html);
  if (titleMatch) {
    const raw = titleMatch[1].replace(/basketball player profile/i, "").trim();
    if (raw) return titleCaseName(raw);
  }

  if (fallback?.trim() && !isPlaceholderDisplayName(fallback)) {
    return fallback.trim();
  }

  return `Player ${playerId}`;
}

export function parsePlayerBioFromHtml(
  html: string,
  playerId: string,
  fallbackDisplayName?: string,
  fallbackPosition?: string | null,
): NcaaPlayerBio {
  const $ = load(html);
  const bodyText = $("body").text();
  const faqHtml = $("#div_faq").html() ?? "";
  const combined = `${bodyText} ${faqHtml}`;

  const displayName = extractDisplayName(html, playerId, fallbackDisplayName);

  let position = fallbackPosition ?? null;
  const positionMatch = /What position did[^?]+\?<\/h3><p>([^.<]+)/i.exec(html);
  if (positionMatch) {
    position = positionMatch[1].trim() || position;
  }

  return {
    playerId,
    displayName,
    birthDate: extractBirthDateFromHtml(html) ?? extractBirthDateFromText(combined),
    position,
    heightCm: extractHeightCm(combined),
    weightKg: extractWeightKg(combined),
    hometown:
      extractHometownFromHtml(html) ?? extractHometownFromText(combined),
  };
}
