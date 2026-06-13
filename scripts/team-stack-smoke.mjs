#!/usr/bin/env node
/**
 * File header: End-to-end smoke for a running team stack (the production Docker images from
 * compose.team.yaml), exercised the way a real engineer's browser does — through the published
 * web port only. Signs in with the NextAuth credentials flow, then asserts the full request
 * chain works: server-rendered workspace (web -> api -> db) and the same-origin browser API
 * proxy (/api-proxy -> api), plus that the proxy is closed to unauthenticated callers.
 *
 * Unlike `scripts/smoke-local.mjs` (which probes the API service directly), this only ever
 * talks to the web origin, so it validates the proxy, the session middleware, and the
 * production images together. It is what the `docker-stack` CI job runs.
 *
 * Usage:
 *   EE_SMOKE_ADMIN_EMAIL=admin@team.local EE_SMOKE_ADMIN_PASSWORD=... \
 *     node scripts/team-stack-smoke.mjs [webBaseUrl]
 *
 * Env:
 *   EE_LIBRARY_WEB_BASE_URL   web origin (default http://localhost:8080; arg overrides)
 *   EE_SMOKE_ADMIN_EMAIL      seeded admin email to sign in with (required)
 *   EE_SMOKE_ADMIN_PASSWORD   that admin's password (required)
 *   EE_SMOKE_PART_MPN         MPN expected to be present from the demo seed (default TPS7A02)
 *
 * Exits 0 when every check passes, 1 otherwise.
 */

const baseUrl = (process.argv[2] ?? process.env.EE_LIBRARY_WEB_BASE_URL ?? "http://localhost:8080").replace(/\/$/u, "");
const adminEmail = process.env.EE_SMOKE_ADMIN_EMAIL ?? "";
const adminPassword = process.env.EE_SMOKE_ADMIN_PASSWORD ?? "";
const partMpn = process.env.EE_SMOKE_PART_MPN ?? "TPS7A02";

if (!adminEmail || !adminPassword) {
  console.error("team-stack-smoke: set EE_SMOKE_ADMIN_EMAIL and EE_SMOKE_ADMIN_PASSWORD to a seeded admin account.");
  process.exit(2);
}

/** jar is a minimal cookie store; fetch does not manage cookies on its own. */
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function absorbCookies(response) {
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const splitAt = pair.indexOf("=");
    if (splitAt > 0) {
      jar.set(pair.slice(0, splitAt).trim(), pair.slice(splitAt + 1));
    }
  }
}

const results = [];

async function check(name, run) {
  try {
    const detail = await run();
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}: ${detail}`);
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

async function main() {
  console.log(`team-stack-smoke: probing ${baseUrl} as ${adminEmail}`);

  let csrfToken = "";

  await check("GET /api/auth/csrf", async () => {
    const response = await fetch(`${baseUrl}/api/auth/csrf`, { headers: { cookie: cookieHeader() } });
    absorbCookies(response);
    const body = await response.json();
    if (!body?.csrfToken) throw new Error(`no csrfToken (status ${response.status})`);
    csrfToken = body.csrfToken;
    return `csrfToken received`;
  });

  await check("POST credentials sign-in", async () => {
    const form = new URLSearchParams({
      csrfToken,
      email: adminEmail,
      password: adminPassword,
      callbackUrl: `${baseUrl}/`,
      json: "true"
    });
    const response = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
      body: form,
      redirect: "manual"
    });
    absorbCookies(response);
    if (![...jar.keys()].some((name) => name.includes("session-token"))) {
      throw new Error(`no session cookie set (status ${response.status}); check the admin password and AUTH_TRUST_HOST`);
    }
    return `session established (status ${response.status})`;
  });

  await check("GET /catalog authenticated (server render: web -> api -> db)", async () => {
    const response = await fetch(`${baseUrl}/catalog?q=${encodeURIComponent(partMpn)}`, {
      headers: { cookie: cookieHeader() },
      redirect: "manual"
    });
    if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
    const html = await response.text();
    if (!new RegExp(partMpn, "iu").test(html)) {
      throw new Error(`seeded part ${partMpn} not found in rendered catalog (is the demo data seeded?)`);
    }
    return `catalog rendered with seeded part ${partMpn}`;
  });

  await check("GET /api-proxy/parts authenticated (browser proxy -> api)", async () => {
    const response = await fetch(`${baseUrl}/api-proxy/parts?q=${encodeURIComponent(partMpn)}`, {
      headers: { cookie: cookieHeader() },
      redirect: "manual"
    });
    if (response.status !== 200) throw new Error(`expected 200, got ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body?.data)) throw new Error("proxy did not return an API parts envelope");
    return `proxy returned ${body.data.length} parts (source=${body.source})`;
  });

  await check("GET /api-proxy/parts unauthenticated is blocked", async () => {
    const response = await fetch(`${baseUrl}/api-proxy/parts?q=${encodeURIComponent(partMpn)}`, { redirect: "manual" });
    if (response.status === 200) throw new Error("proxy served data without a session");
    return `blocked as expected (status ${response.status})`;
  });

  const failed = results.filter((entry) => !entry.ok);
  console.log("");
  console.log(`team-stack-smoke: ${results.length - failed.length} pass, ${failed.length} fail`);
  if (failed.length > 0) {
    console.log("team-stack-smoke: FAILED");
    process.exit(1);
  }
  console.log("team-stack-smoke: PASSED");
  process.exit(0);
}

main().catch((error) => {
  console.error("team-stack-smoke crashed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
