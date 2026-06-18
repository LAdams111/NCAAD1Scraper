import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function parseOptionalInt(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid integer value: ${value}`);
  }
  return parsed;
}

export interface AppConfig {
  hoopCentralApiUrl: string;
  ingestApiKey: string | null;
  usbasketEmail: string | null;
  usbasketPassword: string | null;
  usbasketCookie: string | null;
  requestDelayMs: number;
  indexDelayMs: number;
  includeFgPct: boolean;
}

export const DEFAULT_PLAYER_DELAY_MS = 12_000;
export const BACKFILL_PLAYER_DELAY_MS = 12_000;
export const BACKFILL_INDEX_DELAY_MS = 15_000;

export function loadConfig(): AppConfig {
  const hoopCentralApiUrl = normalizeBaseUrl(
    requireEnv(
      "HOOP_CENTRAL_API_URL",
      process.env.HOOP_CENTRAL_API_URL ?? process.env.HOOPCENTRAL_API_URL,
    ),
  );

  const ingestApiKey = process.env.INGEST_API_KEY?.trim() || null;
  const usbasketEmail = process.env.USBASKET_EMAIL?.trim() || null;
  const usbasketPassword = process.env.USBASKET_PASSWORD?.trim() || null;
  const usbasketCookie = process.env.USBASKET_COOKIE?.trim() || null;
  const includeFgPct = process.env.INGEST_INCLUDE_FG_PCT !== "false";

  return {
    hoopCentralApiUrl,
    ingestApiKey,
    usbasketEmail,
    usbasketPassword,
    usbasketCookie,
    requestDelayMs: parseOptionalInt(
      process.env.SCRAPE_REQUEST_DELAY_MS,
      DEFAULT_PLAYER_DELAY_MS,
    ),
    indexDelayMs: parseOptionalInt(
      process.env.SCRAPE_INDEX_DELAY_MS,
      BACKFILL_INDEX_DELAY_MS,
    ),
    includeFgPct,
  };
}
