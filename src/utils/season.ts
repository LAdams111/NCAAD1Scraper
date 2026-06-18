export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** usbasket season label "2014-2015" or year param "2024" → Hoop Central "2014-15". */
export function normalizeSeasonLabel(raw: string): string | null {
  const trimmed = raw.trim();
  const full = /^(\d{4})-(\d{4})$/.exec(trimmed);
  if (full) {
    return `${full[1]}-${full[2].slice(-2)}`;
  }
  const short = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (short) {
    return `${short[1]}-${short[2]}`;
  }
  return null;
}

/** Index URL ?Year=2024 or ?Year=2024-2025 → season label. */
export function seasonLabelFromYearParam(yearParam: string): string {
  const normalized = normalizeSeasonLabel(
    yearParam.includes("-") && yearParam.length > 5
      ? yearParam
      : `${Number(yearParam) - 1}-${String(Number(yearParam)).slice(-2)}`,
  );
  if (!normalized) {
    throw new Error(`Invalid year param: ${yearParam}`);
  }
  return normalized;
}

/** "Acuff Darius" → "Darius Acuff" (usbasket lists Last First). */
export function formatDisplayName(playerName: string): string {
  const cleaned = playerName.replace(/&quote;/g, "'").trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length < 2) return cleaned;
  const last = parts[0];
  const rest = parts.slice(1).join(" ");
  return `${rest} ${last}`;
}

export function calcPct(made: number, attempted: number): number | null {
  if (attempted <= 0) return null;
  return round1((made / attempted) * 100);
}
