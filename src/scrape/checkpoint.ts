import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const DEFAULT_CHECKPOINT = "scrape-ncaa-backfill.checkpoint.json";
export const DEFAULT_LOG = "scrape-ncaa-backfill.log";

export interface NcaaCheckpoint {
  version: 1;
  completedSlugs: string[];
  allSlugs?: string[];
  updatedAt: string;
}

export function loadCheckpoint(path: string): NcaaCheckpoint | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as NcaaCheckpoint;
    if (raw.version !== 1 || !Array.isArray(raw.completedSlugs)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveCheckpoint(path: string, checkpoint: NcaaCheckpoint): void {
  writeFileSync(path, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

export function ensureCheckpoint(checkpoint: NcaaCheckpoint | null): NcaaCheckpoint {
  return (
    checkpoint ?? {
      version: 1,
      completedSlugs: [],
      updatedAt: new Date().toISOString(),
    }
  );
}

export function saveCheckpointSlugs(
  checkpoint: NcaaCheckpoint,
  allSlugs: string[],
  path: string,
): NcaaCheckpoint {
  checkpoint.allSlugs = allSlugs;
  checkpoint.updatedAt = new Date().toISOString();
  saveCheckpoint(path, checkpoint);
  return checkpoint;
}

export function markSlugComplete(
  checkpoint: NcaaCheckpoint,
  slug: string,
  path: string,
): NcaaCheckpoint {
  if (!checkpoint.completedSlugs.includes(slug)) {
    checkpoint.completedSlugs.push(slug);
  }
  checkpoint.updatedAt = new Date().toISOString();
  saveCheckpoint(path, checkpoint);
  return checkpoint;
}

export function appendLog(path: string, line: string): void {
  writeFileSync(path, `${line}\n`, { flag: "a" });
}
