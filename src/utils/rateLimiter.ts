export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseRetryAfterMs(header: string | null, maxMs = 180_000): number | null {
  if (!header?.trim()) return null;

  const seconds = Number.parseInt(header.trim(), 10);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, maxMs);
  }

  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    const wait = dateMs - Date.now();
    if (wait > 0) return Math.min(wait, maxMs);
    return null;
  }

  return null;
}

export function backoffMs(attempt: number, baseMs = 5000, maxMs = 120_000): number {
  return Math.min(maxMs, baseMs * 2 ** (attempt - 1));
}

export function jitterMs(maxMs = 2500): number {
  return Math.floor(Math.random() * maxMs);
}
