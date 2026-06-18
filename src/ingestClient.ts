import type {
  HcPlayerStatus,
  HoopCentralBioPayload,
  HoopCentralBioResponse,
  HoopCentralIngestPayload,
  HoopCentralIngestResponse,
} from "./types.js";
import type { HoopCentralPlayerProfile } from "./utils/profile.js";

export class IngestClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "IngestClientError";
  }
}

function formatIngestError(body: unknown, text: string, statusText: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const obj = err as { message?: unknown; code?: unknown };
      if (typeof obj.message === "string") {
        return typeof obj.code === "string" ? `${obj.code}: ${obj.message}` : obj.message;
      }
      return JSON.stringify(err);
    }
  }
  return text || statusText;
}

export class IngestClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | null,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...extra,
    };
    if (this.apiKey) headers["x-ingest-api-key"] = this.apiKey;
    return headers;
  }

  private static readonly RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async healthCheck(): Promise<{ ok: boolean; status: number }> {
    const url = `${this.baseUrl}/api/health`;
    let response: Response;
    try {
      response = await fetch(url, { headers: this.headers() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new IngestClientError(`Health check failed: ${message}`);
    }
    return { ok: response.ok, status: response.status };
  }

  async getCompletionStatus(source = "balldontlie"): Promise<{
    source: string;
    players: HcPlayerStatus[];
  }> {
    const url = `${this.baseUrl}/api/ingest/completion-status?source=${encodeURIComponent(source)}`;
    const response = await fetch(url, { headers: this.headers() });
    const text = await response.text();

    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        throw new IngestClientError(
          `Invalid JSON from Hoop Central (${response.status})`,
          response.status,
          text,
        );
      }
    }

    if (!response.ok) {
      throw new IngestClientError(
        `Completion status failed (${response.status}): ${formatIngestError(body, text, response.statusText)}`,
        response.status,
        body,
      );
    }

    return body as { source: string; players: HcPlayerStatus[] };
  }

  async getPlayerProfile(playerId: number): Promise<HoopCentralPlayerProfile> {
    const url = `${this.baseUrl}/api/players/${playerId}`;
    const response = await fetch(url, { headers: this.headers() });
    const text = await response.text();

    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        throw new IngestClientError(
          `Invalid JSON from Hoop Central (${response.status})`,
          response.status,
          text,
        );
      }
    }

    if (!response.ok) {
      throw new IngestClientError(
        `Player profile fetch failed (${response.status}): ${formatIngestError(body, text, response.statusText)}`,
        response.status,
        body,
      );
    }

    return body as HoopCentralPlayerProfile;
  }

  async sendPlayerBio(payload: HoopCentralBioPayload): Promise<HoopCentralBioResponse> {
    const url = `${this.baseUrl}/api/ingest/player-bio`;
    return this.postWithRetry(url, payload) as Promise<HoopCentralBioResponse>;
  }

  async sendPlayerSeason(payload: HoopCentralIngestPayload): Promise<HoopCentralIngestResponse> {
    const url = `${this.baseUrl}/api/ingest/player-season`;
    return this.postWithRetry(url, payload) as Promise<HoopCentralIngestResponse>;
  }

  private async postWithRetry(url: string, payload: unknown): Promise<unknown> {
    const maxAttempts = 5;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: this.headers({ "Content-Type": "application/json" }),
          body: JSON.stringify(payload),
        });
      } catch (error) {
        if (attempt < maxAttempts) {
          await this.sleep(500 * attempt);
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new IngestClientError(`Network error posting ingest payload: ${message}`);
      }

      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader
        ? Math.max(1000, Number.parseInt(retryAfterHeader, 10) * 1000 || 2000)
        : 500 * attempt;

      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          if (
            IngestClient.RETRYABLE_STATUSES.has(response.status) &&
            attempt < maxAttempts
          ) {
            await this.sleep(retryAfterMs);
            continue;
          }
          throw new IngestClientError(
            `Invalid JSON from Hoop Central (${response.status})`,
            response.status,
            text,
          );
        }
      }

      if (!response.ok) {
        if (
          IngestClient.RETRYABLE_STATUSES.has(response.status) &&
          attempt < maxAttempts
        ) {
          await this.sleep(retryAfterMs);
          continue;
        }
        throw new IngestClientError(
          `Ingest failed (${response.status}): ${formatIngestError(body, text, response.statusText)}`,
          response.status,
          body,
        );
      }

      return body;
    }

    throw new IngestClientError("Ingest failed after retries");
  }
}
