import { NCAA_USBASKET_INDEX_URL } from "./division.js";
import { backoffMs, jitterMs, parseRetryAfterMs, sleep } from "./utils/rateLimiter.js";
import type { UsbasketIndexRow } from "./types.js";
import { normalizeSeasonLabel } from "./utils/season.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const LOGIN_URL = "https://www.eurobasket.com/news_system/login.aspx";
const LOGIN_POST_URL = "https://www.eurobasket.com/news_system/ndverifikacijasub.aspx";
const INDEX_BASE = NCAA_USBASKET_INDEX_URL;

function parseSetCookieHeaders(response: Response): string[] {
  const fromArray = response.headers.getSetCookie?.() ?? [];
  if (fromArray.length > 0) {
    return fromArray.map((cookie) => cookie.split(";")[0].trim()).filter(Boolean);
  }

  const raw = response.headers.get("set-cookie");
  if (!raw) return [];

  return raw
    .split(/,(?=[^;,]+=)/)
    .map((cookie) => cookie.split(";")[0].trim())
    .filter(Boolean);
}

export class UsbasketClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsbasketClientError";
  }
}

export class UsbasketRateLimitError extends UsbasketClientError {}

export function isBlockedUsbasketHtml(html: string): boolean {
  if (html.length < 500) return true;
  if (/HTTP Error 404|HTTP Error 403|Access Denied/i.test(html)) return true;
  return !/<title>/i.test(html);
}

export function parseStrDataFromHtml(html: string): UsbasketIndexRow[] | null {
  const markers = ["strData='[", 'strData="[', "strData='[", 'strData=[', "strData=["];
  let start = -1;
  for (const marker of markers) {
    const idx = html.indexOf(marker);
    if (idx >= 0) {
      start = idx;
      break;
    }
  }
  if (start < 0) return null;

  const bracketStart = html.indexOf("[", start);
  if (bracketStart < 0) return null;

  let i = bracketStart;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let quote = "";

  for (; i < html.length; i += 1) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === quote) inStr = false;
      continue;
    }
    if (c === "'" || c === '"') {
      inStr = true;
      quote = c;
      continue;
    }
    if (c === "[") depth += 1;
    if (c === "]") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }

  const raw = html
    .slice(bracketStart, i)
    .replace(/[\u0000-\u0019]+/g, "")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"');

  if (!raw.startsWith("[")) return null;

  try {
    return JSON.parse(raw) as UsbasketIndexRow[];
  } catch {
    return null;
  }
}

/** Player profile / index links → usbasket numeric IDs (men's links only). */
export function parsePlayerIdsFromIndexHtml(html: string): string[] {
  return parsePlayersFromIndexHtml(html).map((entry) => entry.playerId);
}

/** Player IDs and raw link labels from usbasket index HTML (men's links only). */
export function parsePlayersFromIndexHtml(
  html: string,
): Array<{ playerId: string; playerName: string }> {
  const byId = new Map<string, string>();

  for (const match of html.matchAll(
    /href="https?:\/\/basketball\.usbasket\.com\/player\/([^"'?\s]+)\/(\d+)"[^>]*>([^<]*)</gi,
  )) {
    const start = match.index ?? 0;
    const tail = html.slice(start, start + match[0].length + 12);
    if (/Women=1/i.test(tail)) continue;

    const playerId = match[2];
    const linkText = match[3].trim();
    const slugName = match[1].replace(/-/g, " ").trim();
    const playerName = linkText || slugName;
    if (!playerName || byId.has(playerId)) continue;
    byId.set(playerId, playerName);
  }

  for (const match of html.matchAll(/\/player\/[^"'?\s]+\/(\d+)/gi)) {
    const start = match.index ?? 0;
    const tail = html.slice(start, start + match[0].length + 12);
    if (/Women=1/i.test(tail)) continue;
    if (!byId.has(match[1])) {
      byId.set(match[1], "");
    }
  }

  return [...byId.entries()]
    .map(([playerId, playerName]) => ({ playerId, playerName }))
    .sort((a, b) => a.playerId.localeCompare(b.playerId, undefined, { numeric: true }));
}

export function listSeasonYearParams(html: string): string[] {
  const matches = [
    ...html.matchAll(/basketball-Players\.aspx\?Year=([0-9]{4}(?:-[0-9]{4})?)/g),
  ];
  const years = [...new Set(matches.map((m) => m[1]))];
  return years.sort((a, b) => {
    const ay = Number(a.slice(0, 4));
    const by = Number(b.slice(0, 4));
    return ay - by;
  });
}

export function playerUrl(playerId: string, playerName: string): string {
  const slug = playerName
    .trim()
    .replace(/&quote;/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^0-9a-z-]/gi, "-")
    .replace(/-+$/, "")
    .replace(/^-+/, "");
  return `https://basketball.usbasket.com/player/${slug}/${playerId}`;
}

export class UsbasketClient {
  private cookieHeader: string | null;
  private lastRequestAt = 0;
  private cooldownUntil = 0;
  private penaltyDelayMs = 0;
  private loggedIn = false;

  constructor(
    private readonly requestDelayMs: number,
    private readonly indexDelayMs = 15_000,
    cookieHeader: string | null = null,
  ) {
    this.cookieHeader = cookieHeader;
  }

  async ensureLoggedIn(email: string | null, password: string | null): Promise<void> {
    if (this.loggedIn || this.cookieHeader) return;
    if (!email || !password) {
      console.warn("[usbasket] No login credentials — using unauthenticated requests.");
      return;
    }

    const loginPage = await fetch(LOGIN_URL, {
      headers: { "User-Agent": USER_AGENT },
    });
    const initialCookies = parseSetCookieHeaders(loginPage);
    await loginPage.text();

    const body = new URLSearchParams({
      Referal: "",
      email,
      pwd: password,
      B1: "Login",
    });

    const loginRes = await fetch(LOGIN_POST_URL, {
      method: "POST",
      redirect: "manual",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: LOGIN_URL,
        Origin: "https://www.eurobasket.com",
        ...(initialCookies.length ? { Cookie: initialCookies.join("; ") } : {}),
      },
      body: body.toString(),
    });

    const authCookies = [
      ...initialCookies,
      ...parseSetCookieHeaders(loginRes),
    ].filter(Boolean);

    const location = loginRes.headers.get("location") ?? "";
    const deviceLimitWarning = location.includes("erroruser.aspx");

    if (deviceLimitWarning) {
      try {
        const errorUrl = location.startsWith("http")
          ? location
          : `https://www.eurobasket.com${location.startsWith("/") ? location : `/news_system/${location}`}`;
        const errorPage = await fetch(errorUrl, {
          headers: {
            "User-Agent": USER_AGENT,
            Cookie: authCookies.join("; "),
          },
        });
        authCookies.push(...parseSetCookieHeaders(errorPage));
        await errorPage.text();
      } catch {
        // ignore — cookie may still be supplied via USBASKET_COOKIE
      }
    }

    const hasAuthCookie = authCookies.some((c) => c.startsWith("EAlfaID="));

    if (hasAuthCookie) {
      this.cookieHeader = [...new Set(authCookies)].join("; ");
      this.loggedIn = true;
      if (deviceLimitWarning) {
        console.log(
          "[usbasket] Logged in despite device-limit warning (err=9) — session cookies active.",
        );
      } else {
        console.log("[usbasket] Logged in successfully.");
      }
      return;
    }

    if (deviceLimitWarning) {
      console.warn(
        "[usbasket] Device-limit warning (err=9). Close the error tab and retry in browser, " +
          "then paste USBASKET_COOKIE into .env — or continue without auth.",
      );
      return;
    }

    console.warn(
      "[usbasket] Login failed — continuing without auth. Public pages may still work.",
    );
  }

  private effectiveDelay(minDelayMs: number): number {
    const jitterCap = Math.min(800, Math.max(50, Math.floor(minDelayMs * 0.2)));
    return minDelayMs + this.penaltyDelayMs + jitterMs(jitterCap);
  }

  private decayPenalty(): void {
    if (this.penaltyDelayMs > 0) {
      this.penaltyDelayMs = Math.max(0, this.penaltyDelayMs - 500);
    }
  }

  private async throttle(minDelayMs = this.requestDelayMs): Promise<void> {
    const now = Date.now();
    if (now < this.cooldownUntil) {
      await sleep(this.cooldownUntil - now);
    }

    const targetDelay = this.effectiveDelay(minDelayMs);
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < targetDelay) {
      await sleep(targetDelay - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  private async applyRateLimitCooldown(response: Response | null, attempt: number): Promise<void> {
    const retryAfterMs = response
      ? parseRetryAfterMs(response.headers.get("Retry-After"))
      : null;
    const waitMs = retryAfterMs ?? backoffMs(attempt, 8000);
    this.cooldownUntil = Date.now() + waitMs;
    this.penaltyDelayMs = Math.min(20_000, this.penaltyDelayMs + 4000);
    const status = response?.status ?? "blocked";
    console.error(
      `[usbasket] rate limited (${status}), waiting ${Math.round(waitMs / 1000)}s ` +
        `(penalty delay now +${this.penaltyDelayMs}ms)...`,
    );
    await sleep(waitMs);
  }

  async fetchHtml(url: string, retries = 8, indexRequest = false): Promise<string> {
    const minDelay = indexRequest ? this.indexDelayMs : this.requestDelayMs;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      await this.throttle(minDelay);

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml",
            ...(this.cookieHeader ? { Cookie: this.cookieHeader } : {}),
          },
        });
      } catch (error) {
        if (attempt === retries) {
          const message = error instanceof Error ? error.message : String(error);
          throw new UsbasketClientError(message);
        }
        await sleep(backoffMs(attempt, 2000));
        continue;
      }

      if (response.status === 429 || response.status === 503) {
        if (attempt < retries) {
          await this.applyRateLimitCooldown(response, attempt);
          continue;
        }
        throw new UsbasketRateLimitError(`usbasket rate limited (${response.status}): ${url}`);
      }

      if (response.status >= 500) {
        if (attempt < retries) {
          await sleep(backoffMs(attempt, 3000));
          continue;
        }
      }

      if (!response.ok) {
        throw new UsbasketClientError(`usbasket fetch failed (${response.status}): ${url}`);
      }

      const html = await response.text();
      if (isBlockedUsbasketHtml(html)) {
        if (attempt < retries) {
          console.error(
            `[usbasket] empty/blocked response (${html.length} bytes) for ${url}, retrying...`,
          );
          await this.applyRateLimitCooldown(null, attempt);
          continue;
        }
        throw new UsbasketRateLimitError(`usbasket blocked/empty response: ${url}`);
      }

      this.decayPenalty();
      return html;
    }

    throw new UsbasketRateLimitError(`usbasket fetch failed after retries: ${url}`);
  }

  indexUrl(yearParam: string): string {
    return `${INDEX_BASE}?Year=${encodeURIComponent(yearParam)}`;
  }

  async fetchSeasonIndex(
    yearParam: string,
  ): Promise<{ html: string; rows: UsbasketIndexRow[] | null }> {
    const html = await this.fetchHtml(this.indexUrl(yearParam), 8, true);
    const rows = parseStrDataFromHtml(html);
    return { html, rows };
  }

  async fetchPlayerStatsAjax(playerId: string, seasonParam: string): Promise<string> {
    await this.throttle(this.requestDelayMs);

    const response = await fetch(
      "https://basketball.usbasket.com/PlayerDetailsAjax.aspx/PlayerStatsAjax",
      {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/json; charset=utf-8",
          ...(this.cookieHeader ? { Cookie: this.cookieHeader } : {}),
        },
        body: JSON.stringify({ PlayerId: playerId, Season: seasonParam }),
      },
    );

    if (!response.ok) {
      throw new UsbasketClientError(
        `PlayerStatsAjax failed (${response.status}) for ${playerId} season=${seasonParam}`,
      );
    }

    const payload = (await response.json()) as { d?: string };
    return payload.d ?? "";
  }

  seasonLabelFromRow(row: UsbasketIndexRow, fallbackLabel: string): string {
    if (row.Season) {
      const label = normalizeSeasonLabel(row.Season);
      if (label) return label;
    }
    return fallbackLabel;
  }
}
