import type { HoopCentralIngestPayload } from "../types.js";

export interface HoopCentralPlayerProfile {
  id: number;
  name: string;
  position: string;
  height: string;
  weight: string;
  hometown: string;
  headshotUrl: string;
  birthDate: string | null;
}

/** Parse public profile API fields back into ingest player shape (preserves existing bio). */
export function profileToIngestPlayer(
  profile: HoopCentralPlayerProfile,
): HoopCentralIngestPayload["player"] {
  const player: HoopCentralIngestPayload["player"] = {
    displayName: profile.name,
  };

  if (profile.birthDate) player.birthDate = profile.birthDate;

  const position = profile.position.trim();
  if (position && position !== "—") player.position = position;

  const heightCm = feetInchesToCm(profile.height);
  if (heightCm != null) player.heightCm = heightCm;

  const weightKg = lbsToKg(profile.weight);
  if (weightKg != null) player.weightKg = weightKg;

  const hometown = profile.hometown.trim();
  if (hometown && hometown !== "—") player.hometown = hometown;

  const headshotUrl = profile.headshotUrl.trim();
  if (headshotUrl) player.headshotUrl = headshotUrl;

  return player;
}

export function feetInchesToCm(height: string): number | null {
  const match = /^(\d+)'(\d+)"$/.exec(height.trim());
  if (!match) return null;
  const feet = Number.parseInt(match[1], 10);
  const inches = Number.parseInt(match[2], 10);
  if (Number.isNaN(feet) || Number.isNaN(inches)) return null;
  return Math.round((feet * 12 + inches) * 2.54);
}

export function lbsToKg(weight: string): number | null {
  const match = /^(\d+)\s*lbs$/i.exec(weight.trim());
  if (!match) return null;
  const lbs = Number.parseInt(match[1], 10);
  if (Number.isNaN(lbs)) return null;
  return Math.round(lbs / 2.20462);
}
