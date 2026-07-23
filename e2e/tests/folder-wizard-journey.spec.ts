/**
 * File header: The whole-library backfill wizard journey through the running team stack, in a
 * real browser: drop a project folder into the mirror -> scan -> add it to the library ->
 * confirm the disclosed rename, project creation, BOM import, and match outcome render.
 *
 * The dropped folder deliberately uses a lowercase, space-separated name so the journey
 * exercises the onboarding rename to project-key form on a case-sensitive filesystem — the
 * exact behavior a Windows dev workstation cannot verify. The BOM references the seeded
 * TPS7A02DBVR part (npm run ingest:local), so matching is deterministic and no external
 * supplier is contacted.
 *
 * Onboarding mutates disk (the rename) and the database (the project) irreversibly, so the
 * folder name is made unique per attempt (run stamp + Playwright retry index): a CI retry gets
 * a brand-new folder and rename target rather than colliding with the first attempt's result.
 *
 * Requires EE_E2E_PROJECT_FILES_DIR: the host path of the stack's project-files bind mount
 * (compose.team.yaml default ./team-data/project-files).
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const adminEmail = process.env.EE_SMOKE_ADMIN_EMAIL ?? "";
const adminPassword = process.env.EE_SMOKE_ADMIN_PASSWORD ?? "";
const projectFilesDir = process.env.EE_E2E_PROJECT_FILES_DIR ?? "";

// Stable per process; the per-attempt suffix is appended inside the test from testInfo.retry.
const runStamp = Date.now().toString(36);

test.beforeAll(() => {
  if (!adminEmail || !adminPassword) {
    throw new Error("Set EE_SMOKE_ADMIN_EMAIL and EE_SMOKE_ADMIN_PASSWORD to a seeded admin account.");
  }

  if (!projectFilesDir) {
    throw new Error("Set EE_E2E_PROJECT_FILES_DIR to the host path of the stack's project-files bind mount.");
  }
});

// Sign in for each attempt; the journey steps share the authenticated browser context.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/u);

  await page.fill("#email", adminEmail);
  await page.fill("#password", adminPassword);
  await page.click('button[type="submit"]');

  await expect(page).not.toHaveURL(/\/sign-in/u);
});

test("engineer drops a folder, scans, adds it to the library, and sees the honest outcome", async ({ page }, testInfo) => {
  // Unique per attempt so an automatic retry never inherits the first attempt's rename/project.
  const uniqueStamp = `${runStamp}-${testInfo.retry}`;
  const droppedFolderName = `e2e wizard ${uniqueStamp}`;
  const renamedFolderName = `E2E-WIZARD-${uniqueStamp.toUpperCase()}`;
  const droppedFolderPath = path.join(projectFilesDir, droppedFolderName);

  // Drop one "old project" folder into the mirror exactly as an engineer would: as-is, messy
  // name and all, with a parts list whose MPN column is recognizable.
  await mkdir(droppedFolderPath, { recursive: true });
  await writeFile(
    path.join(droppedFolderPath, "wizard-journey-bom.csv"),
    "MPN,Manufacturer,Qty,RefDes\nTPS7A02DBVR,Texas Instruments,1,U1\n",
    "utf8"
  );

  try {
    // --- Scan the project files root from /projects -----------------------------------------
    await page.goto("/projects");
    await page.getByRole("button", { name: "Scan for project folders" }).click();

    // The dropped folder appears in the scan table with its parts list and the disclosed rename.
    const scanTable = page.locator(".project-folder-scan__table");
    const folderRow = scanTable.locator("tr", { hasText: droppedFolderName });
    await expect(folderRow).toBeVisible();
    await expect(folderRow).toContainText("wizard-journey-bom.csv");
    await expect(folderRow).toContainText("Will be renamed to");
    await expect(folderRow).toContainText(renamedFolderName);

    // --- Onboard it -------------------------------------------------------------------------
    await folderRow.getByRole("button", { name: "Add to library" }).click();

    // The per-folder report renders the whole chain's outcome: project created, the seeded
    // TPS7A02DBVR row matched, nothing left missing (so no supplier search was needed).
    await expect(folderRow.getByText("Project created")).toBeVisible();
    await expect(folderRow.getByText("1 matched / 0 missing")).toBeVisible();

    // --- Open the created project and confirm it renders ------------------------------------
    // Navigate via the outcome link's href rather than a client-side click so the assertion
    // stays deterministic regardless of hydration timing inside the results table.
    const projectLink = folderRow.getByRole("link", { name: `Open ${droppedFolderName}` });
    const projectHref = await projectLink.getAttribute("href");
    expect(projectHref).toMatch(/^\/projects\/.+/u);
    await page.goto(projectHref ?? "/projects");
    await expect(page.getByRole("heading", { level: 1, name: droppedFolderName })).toBeVisible();

    // --- Rescan: the folder is now claimed and no longer offered in the scan table ----------
    // Scoped to the scan table on purpose: the created project also appears in the projects
    // list above, so a page-wide row match would (correctly) still find its key.
    await page.goto("/projects");
    await page.getByRole("button", { name: "Scan for project folders" }).click();
    await expect(page.locator(".project-folder-scan__results, .project-folder-scan > p").first()).toBeVisible();
    await expect(page.locator(".project-folder-scan__table tr", { hasText: renamedFolderName })).toHaveCount(0);
  } finally {
    // Onboarding renamed the folder, so clean up whichever name is present.
    await rm(droppedFolderPath, { force: true, recursive: true });
    await rm(path.join(projectFilesDir, renamedFolderName), { force: true, recursive: true });
  }
});
