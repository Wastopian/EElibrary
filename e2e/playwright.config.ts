/**
 * File header: Playwright config for the EE Library team-stack browser journey.
 *
 * Targets a running team stack through its published web port (the same address an engineer
 * uses), so it exercises real client-side rendering, the session middleware, and the
 * /api-proxy chain against the production Docker images. Point it elsewhere with
 * PLAYWRIGHT_BASE_URL. Credentials come from EE_SMOKE_ADMIN_EMAIL / EE_SMOKE_ADMIN_PASSWORD.
 */

import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // First request to a cold Next.js production server can compile/stream slowly.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
