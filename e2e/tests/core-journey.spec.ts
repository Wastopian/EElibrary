/**
 * File header: The core engineer journey through the running team stack, in a real browser:
 * sign in -> search a part -> open its detail page -> open the demo project and see the
 * prior-project overlap panel. This covers the client-side rendering and interaction the
 * HTTP smokes (scripts/smoke-local.mjs, scripts/team-stack-smoke.mjs) cannot see.
 *
 * Relies on the demo seed (npm run seed:demo-project): MPN TPS7A02DBVR / part-tps7a02dbvr
 * and project-demo-pocket-mcu.
 */

import { expect, test } from "@playwright/test";

const adminEmail = process.env.EE_SMOKE_ADMIN_EMAIL ?? "";
const adminPassword = process.env.EE_SMOKE_ADMIN_PASSWORD ?? "";

const DEMO_MPN = "TPS7A02DBVR";
const DEMO_PART_ID = "part-tps7a02dbvr";
const DEMO_PROJECT_ID = "project-demo-pocket-mcu";

test.beforeAll(() => {
  if (!adminEmail || !adminPassword) {
    throw new Error("Set EE_SMOKE_ADMIN_EMAIL and EE_SMOKE_ADMIN_PASSWORD to a seeded admin account.");
  }
});

// Sign in once; the journey steps share the authenticated browser context.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // The middleware sends an unauthenticated visitor to the sign-in page.
  await expect(page).toHaveURL(/\/sign-in/u);

  await page.fill("#email", adminEmail);
  await page.fill("#password", adminPassword);
  await page.click('button[type="submit"]');

  // A successful sign-in returns to the workspace; a failed one stays on /sign-in.
  await expect(page).not.toHaveURL(/\/sign-in/u);
});

test("engineer signs in, searches a part, opens its detail, and sees project overlap", async ({ page }) => {
  // --- Search from the workspace sidebar ---------------------------------------------------
  await page.fill("#sidebar-search", "TPS7A02");
  await page.press("#sidebar-search", "Enter");

  await expect(page).toHaveURL(/\/catalog\?.*q=TPS7A02/u);
  const partLink = page.locator(`a[href*="/parts/${DEMO_PART_ID}"]`).first();
  await expect(partLink).toBeVisible();

  // --- Open the part detail page -----------------------------------------------------------
  await partLink.click();
  await expect(page).toHaveURL(new RegExp(`/parts/${DEMO_PART_ID}`, "u"));
  // The detail hero renders the MPN as the page heading.
  await expect(page.locator("h1.ui-mono")).toContainText(DEMO_MPN);

  // --- Open the demo project and confirm the prior-project overlap panel renders -----------
  await page.goto(`/projects/${DEMO_PROJECT_ID}`);
  await expect(page).toHaveURL(new RegExp(`/projects/${DEMO_PROJECT_ID}`, "u"));
  await expect(page.getByRole("heading", { name: "Prior project overlap" })).toBeVisible();
});
