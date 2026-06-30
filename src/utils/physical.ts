const POSITION_MAP: Record<string, string> = {
  "POINT GUARD": "PG",
  "SHOOTING GUARD": "SG",
  "SMALL FORWARD": "SF",
  "POWER FORWARD": "PF",
  CENTER: "C",
  GUARD: "G",
  FORWARD: "F",
  "GUARD-FORWARD": "G-F",
  "FORWARD-CENTER": "F-C",
  "FORWARD-GUARD": "F-G",
  "CENTER-FORWARD": "C-F",
};

/** Normalize usbasket position text to short labels when possible. */
export function normalizePosition(position: string | null | undefined): string | null {
  if (!position?.trim()) return null;
  const trimmed = position.trim().replace(/\.$/, "");
  const upper = trimmed.toUpperCase();

  if (POSITION_MAP[upper]) return POSITION_MAP[upper];
  if (/^(PG|SG|SF|PF|C|G|F|G-F|F-G|F-C|C-F)$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const first = upper.split(/[-/]/)[0]?.trim();
  if (first && POSITION_MAP[first]) return POSITION_MAP[first];
  if (first && /^(PG|SG|SF|PF|C|G|F)$/i.test(first)) return first.toUpperCase();

  return trimmed;
}
