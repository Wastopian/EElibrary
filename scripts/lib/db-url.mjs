/**
 * File header: Pure helpers for inspecting DATABASE_URL without depending on pg.
 */

/**
 * Returns the configured DATABASE_URL or throws a clear error.
 */
export function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;

  if (!url || url.trim() === "") {
    throw new Error(
      "DATABASE_URL is not set. Run `npm run setup:dev` or copy .env.example to .env first."
    );
  }

  return url;
}

/**
 * Returns true when the DATABASE_URL targets a localhost-style host.
 * Used by db:reset as a safety guard before destructive operations.
 */
export function isLocalDatabase(url) {
  try {
    const parsed = new URL(url);
    // The WHATWG URL parser returns IPv6 hosts wrapped in brackets, strip them for comparison.
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
  } catch {
    return false;
  }
}
