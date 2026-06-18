/** Match Hoop Central nameToSlug convention. */
export function nameToSlug(name: string): string {
  return name
    .trim()
    .replace(/&quote;/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function teamAbbreviation(teamName: string): string {
  const cleaned = teamName.replace(/&quote;/g, "'").trim();
  if (cleaned.length <= 6) return cleaned.toUpperCase();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) return cleaned.slice(0, 6).toUpperCase();
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, 6)
    .toUpperCase();
}
