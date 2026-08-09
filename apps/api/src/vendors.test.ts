/**
 * File header: Tests vendor notes service against a sandboxed temp directory.
 *
 * Each test sets `EE_LIBRARY_VENDOR_NOTES_ROOT` to a unique temp folder so we can
 * verify create, list, detail, slugification, upload, and per-org isolation without
 * touching the operator's home directory.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildVendorDetailResponse,
  buildVendorListResponse,
  createVendor,
  getVendorNotesRoot,
  resolveVendorCategory,
  resolveVendorFolderSection,
  resolveVendorOrgRoot,
  saveVendorFile,
  slugifyVendorName,
  VENDOR_CATEGORY_DEFINITIONS
} from "./vendors";

/** DEFAULT_ORG keeps legacy single-tenant paths at `<root>/<category>/<slug>/`. */
const DEFAULT_ORG = "org-default";

/**
 * Creates a unique sandbox root for one test and points the env var at it.
 * Returns a teardown function that restores the env var and removes the directory.
 */
async function withSandboxRoot(): Promise<{ root: string; restore: () => Promise<void> }> {
  const previous = process.env.EE_LIBRARY_VENDOR_NOTES_ROOT;
  const root = await mkdtemp(path.join(tmpdir(), "ee-vendor-notes-"));
  process.env.EE_LIBRARY_VENDOR_NOTES_ROOT = root;

  return {
    root,
    restore: async () => {
      if (previous === undefined) {
        delete process.env.EE_LIBRARY_VENDOR_NOTES_ROOT;
      } else {
        process.env.EE_LIBRARY_VENDOR_NOTES_ROOT = previous;
      }
      await rm(root, { recursive: true, force: true });
    }
  };
}

test("getVendorNotesRoot uses the default folder for empty values and off disables it", () => {
  const previous = process.env.EE_LIBRARY_VENDOR_NOTES_ROOT;
  try {
    process.env.EE_LIBRARY_VENDOR_NOTES_ROOT = "";
    assert.ok(getVendorNotesRoot()?.endsWith(path.join("EE-Library", "vendors")));
    process.env.EE_LIBRARY_VENDOR_NOTES_ROOT = "off";
    assert.equal(getVendorNotesRoot(), null);
  } finally {
    if (previous === undefined) {
      delete process.env.EE_LIBRARY_VENDOR_NOTES_ROOT;
    } else {
      process.env.EE_LIBRARY_VENDOR_NOTES_ROOT = previous;
    }
  }
});

test("resolveVendorOrgRoot keeps org-default at the legacy root and namespaces other orgs", () => {
  const root = path.join(tmpdir(), "ee-vendor-org-root");
  assert.equal(resolveVendorOrgRoot(root, DEFAULT_ORG), path.resolve(root));
  assert.equal(
    resolveVendorOrgRoot(root, "org-acme"),
    path.resolve(root, ".ee-library-tenants", "org-acme")
  );
});

test("VENDOR_CATEGORY_DEFINITIONS includes the seven canonical categories", () => {
  const categories = VENDOR_CATEGORY_DEFINITIONS.map((definition) => definition.category);
  assert.deepEqual(categories, [
    "pcb_fab",
    "sheet_metal",
    "machining",
    "finishing",
    "electronics_assembly",
    "distributor",
    "other"
  ]);
});

test("slugifyVendorName lowercases, strips diacritics, and collapses runs", () => {
  assert.equal(slugifyVendorName("JLCPCB"), "jlcpcb");
  assert.equal(slugifyVendorName("Acme Sheet Metal"), "acme-sheet-metal");
  assert.equal(slugifyVendorName("Sanmina (Premium)"), "sanmina-premium");
  assert.equal(slugifyVendorName("Élite Anodize"), "elite-anodize");
  assert.equal(slugifyVendorName("---weird---"), "weird");
  assert.equal(slugifyVendorName("   "), null);
  assert.equal(slugifyVendorName("***"), null);
});

test("resolveVendorCategory rejects unknown values", () => {
  assert.equal(resolveVendorCategory("pcb_fab"), "pcb_fab");
  assert.equal(resolveVendorCategory("distributor"), "distributor");
  assert.equal(resolveVendorCategory("vendor_x"), null);
  assert.equal(resolveVendorCategory(""), null);
});

test("resolveVendorFolderSection accepts only notes and files", () => {
  assert.equal(resolveVendorFolderSection("notes"), "notes");
  assert.equal(resolveVendorFolderSection("files"), "files");
  assert.equal(resolveVendorFolderSection("other"), null);
  assert.equal(resolveVendorFolderSection(""), null);
});

test("buildVendorListResponse returns not_configured when env var is off", async () => {
  const previous = process.env.EE_LIBRARY_VENDOR_NOTES_ROOT;
  process.env.EE_LIBRARY_VENDOR_NOTES_ROOT = "off";

  try {
    const response = await buildVendorListResponse(DEFAULT_ORG);
    assert.equal(response.availability, "not_configured");
    assert.deepEqual(response.vendors, []);
    assert.equal(response.rootPath, null);
  } finally {
    if (previous === undefined) {
      delete process.env.EE_LIBRARY_VENDOR_NOTES_ROOT;
    } else {
      process.env.EE_LIBRARY_VENDOR_NOTES_ROOT = previous;
    }
  }
});

test("createVendor writes vendor.json plus notes and files folders inside the sandbox", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const result = await createVendor(DEFAULT_ORG, {
      name: "JLCPCB",
      category: "pcb_fab",
      summary: "Low-cost prototype 1-4 layer."
    });

    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.vendor.slug, "jlcpcb");
    assert.equal(result.vendor.name, "JLCPCB");
    assert.equal(result.vendor.category, "pcb_fab");
    assert.equal(result.vendor.summary, "Low-cost prototype 1-4 layer.");

    const metadataPath = path.join(sandbox.root, "pcb-fab", "jlcpcb", "vendor.json");
    const stored = JSON.parse(await readFile(metadataPath, "utf8")) as { slug: string; name: string };
    assert.equal(stored.slug, "jlcpcb");
    assert.equal(stored.name, "JLCPCB");
  } finally {
    await sandbox.restore();
  }
});

test("createVendor refuses duplicate slugs across the same category", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const first = await createVendor(DEFAULT_ORG, { name: "Acme", category: "machining" });
    assert.equal(first.status, "ok");

    const second = await createVendor(DEFAULT_ORG, { name: "ACME", category: "machining" });
    assert.equal(second.status, "conflict");
  } finally {
    await sandbox.restore();
  }
});

test("createVendor rejects empty names and invalid categories", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const blank = await createVendor(DEFAULT_ORG, { name: "   ", category: "pcb_fab" });
    assert.equal(blank.status, "invalid_name");

    const symbols = await createVendor(DEFAULT_ORG, { name: "***", category: "pcb_fab" });
    assert.equal(symbols.status, "invalid_name");

    const badCategory = await createVendor(DEFAULT_ORG, { name: "Acme", category: "ghost" as never });
    assert.equal(badCategory.status, "invalid_category");
  } finally {
    await sandbox.restore();
  }
});

test("buildVendorListResponse returns created vendors with note/file counts", async () => {
  const sandbox = await withSandboxRoot();

  try {
    await createVendor(DEFAULT_ORG, { name: "Sanmina", category: "electronics_assembly", summary: "Premium EMS." });
    const ack = await createVendor(DEFAULT_ORG, { name: "Acme Sheet", category: "sheet_metal" });
    assert.equal(ack.status, "ok");
    if (ack.status !== "ok") return;

    const sheetNotes = path.join(sandbox.root, "sheet-metal", "acme-sheet", "notes");
    await mkdir(sheetNotes, { recursive: true });
    await writeFile(path.join(sheetNotes, "kickoff.md"), "# Kickoff\n\nGood quotes.");

    const sheetFiles = path.join(sandbox.root, "sheet-metal", "acme-sheet", "files");
    await mkdir(sheetFiles, { recursive: true });
    await writeFile(path.join(sheetFiles, "capability.pdf"), "%PDF-1.4");

    const response = await buildVendorListResponse(DEFAULT_ORG);
    assert.equal(response.availability, "configured");
    assert.equal(response.vendors.length, 2);

    const names = response.vendors.map((summary) => summary.vendor.name);
    assert.deepEqual(names.sort(), ["Acme Sheet", "Sanmina"]);

    const acmeSummary = response.vendors.find((entry) => entry.vendor.slug === "acme-sheet");
    assert.ok(acmeSummary);
    assert.equal(acmeSummary.noteCount, 1);
    assert.equal(acmeSummary.fileCount, 1);
  } finally {
    await sandbox.restore();
  }
});

test("buildVendorDetailResponse returns vendor null when slug does not exist", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const response = await buildVendorDetailResponse(DEFAULT_ORG, "does-not-exist");
    assert.equal(response.availability, "configured");
    assert.equal(response.vendor, null);
    assert.deepEqual(response.notes, []);
    assert.deepEqual(response.files, []);
  } finally {
    await sandbox.restore();
  }
});

test("metadata-less vendor folders can be opened and receive uploads", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const vendorRoot = path.join(sandbox.root, "machining", "legacy-shop");
    await mkdir(path.join(vendorRoot, "notes"), { recursive: true });
    await mkdir(path.join(vendorRoot, "files"), { recursive: true });

    const detail = await buildVendorDetailResponse(DEFAULT_ORG, "legacy-shop");
    assert.equal(detail.availability, "configured");
    assert.equal(detail.vendor?.slug, "legacy-shop");
    assert.equal(detail.vendor?.category, "machining");

    const written = await saveVendorFile(DEFAULT_ORG, "legacy-shop", "notes", {
      filename: "first note.md",
      content: "Legacy folder was imported from shared drive."
    });
    assert.equal(written.status, "ok");
    if (written.status !== "ok") return;

    const onDisk = await readFile(written.absolutePath, "utf8");
    assert.match(onDisk, /shared drive/u);
  } finally {
    await sandbox.restore();
  }
});

test("buildVendorDetailResponse returns notes and files for an existing vendor", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const created = await createVendor(DEFAULT_ORG, { name: "Anodyne", category: "finishing" });
    assert.equal(created.status, "ok");
    if (created.status !== "ok") return;

    const detail = await buildVendorDetailResponse(DEFAULT_ORG, "anodyne");
    assert.equal(detail.availability, "configured");
    assert.ok(detail.vendor);
    assert.equal(detail.vendor.slug, "anodyne");
    assert.deepEqual(detail.notes, []);
    assert.deepEqual(detail.files, []);
    assert.ok(detail.notesPath?.includes(path.join("finishing", "anodyne", "notes")));
    assert.ok(detail.filesPath?.includes(path.join("finishing", "anodyne", "files")));
  } finally {
    await sandbox.restore();
  }
});

test("saveVendorFile writes UTF-8 notes and updates the vendor metadata timestamp", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const created = await createVendor(DEFAULT_ORG, { name: "JLCPCB", category: "pcb_fab" });
    assert.equal(created.status, "ok");

    const written = await saveVendorFile(DEFAULT_ORG, "jlcpcb", "notes", {
      filename: "Lead time observations.md",
      content: "# Lead times\n\n5 business days standard for HASL 4-layer."
    });
    assert.equal(written.status, "ok");
    if (written.status !== "ok") return;
    assert.equal(written.entry.name, "Lead-time-observations.md");

    const onDisk = await readFile(written.absolutePath, "utf8");
    assert.match(onDisk, /Lead times/);

    const metadataPath = path.join(sandbox.root, "pcb-fab", "jlcpcb", "vendor.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { createdAt: string; updatedAt: string };
    assert.notEqual(metadata.updatedAt, "");
    assert.ok(metadata.updatedAt >= metadata.createdAt);
  } finally {
    await sandbox.restore();
  }
});

test("saveVendorFile writes base64 binary content to the files folder", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const created = await createVendor(DEFAULT_ORG, { name: "Acme", category: "machining" });
    assert.equal(created.status, "ok");

    const result = await saveVendorFile(DEFAULT_ORG, "acme", "files", {
      filename: "capability.pdf",
      contentBase64: Buffer.from("%PDF-1.4 demo", "utf8").toString("base64")
    });

    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.ok(result.absolutePath.endsWith(path.join("acme", "files", "capability.pdf")));
    const onDisk = await readFile(result.absolutePath, "utf8");
    assert.equal(onDisk, "%PDF-1.4 demo");
  } finally {
    await sandbox.restore();
  }
});

test("saveVendorFile returns not_found for unknown vendors", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const result = await saveVendorFile(DEFAULT_ORG, "ghost", "notes", { filename: "x.md", content: "x" });
    assert.equal(result.status, "not_found");
  } finally {
    await sandbox.restore();
  }
});

test("saveVendorFile rejects unsupported sections", async () => {
  const sandbox = await withSandboxRoot();

  try {
    await createVendor(DEFAULT_ORG, { name: "Acme", category: "machining" });
    const result = await saveVendorFile(DEFAULT_ORG, "acme", "evidence" as never, { filename: "x.md", content: "x" });
    assert.equal(result.status, "invalid_section");
  } finally {
    await sandbox.restore();
  }
});

test("saveVendorFile keeps writes inside the vendor folder even with traversal-prone names", async () => {
  const sandbox = await withSandboxRoot();

  try {
    await createVendor(DEFAULT_ORG, { name: "Acme", category: "machining" });
    const result = await saveVendorFile(DEFAULT_ORG, "acme", "files", {
      filename: "../../escape.pdf",
      content: "x"
    });

    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.entry.name, "escape.pdf");
    assert.ok(result.absolutePath.startsWith(sandbox.root));
    assert.ok(result.absolutePath.includes(path.join("acme", "files")));
  } finally {
    await sandbox.restore();
  }
});

test("non-default org vendor notes are isolated from org-default and sibling tenants", async () => {
  const sandbox = await withSandboxRoot();

  try {
    const acmeCreate = await createVendor("org-acme", {
      name: "Acme Fab",
      category: "pcb_fab",
      summary: "Confidential Acme process notes."
    });
    assert.equal(acmeCreate.status, "ok");

    const acmeUpload = await saveVendorFile("org-acme", "acme-fab", "notes", {
      filename: "nda-pricing.md",
      content: "Do not share outside Acme."
    });
    assert.equal(acmeUpload.status, "ok");
    if (acmeUpload.status !== "ok") return;
    assert.ok(acmeUpload.absolutePath.includes(path.join(".ee-library-tenants", "org-acme")));

    const defaultList = await buildVendorListResponse(DEFAULT_ORG);
    assert.equal(defaultList.availability, "configured");
    assert.equal(defaultList.vendors.length, 0);

    const defaultDetail = await buildVendorDetailResponse(DEFAULT_ORG, "acme-fab");
    assert.equal(defaultDetail.vendor, null);

    const betaList = await buildVendorListResponse("org-beta");
    assert.equal(betaList.vendors.length, 0);
    const betaDetail = await buildVendorDetailResponse("org-beta", "acme-fab");
    assert.equal(betaDetail.vendor, null);

    const acmeList = await buildVendorListResponse("org-acme");
    assert.equal(acmeList.vendors.length, 1);
    assert.equal(acmeList.vendors[0]?.vendor.slug, "acme-fab");
    assert.equal(acmeList.vendors[0]?.noteCount, 1);
    assert.ok(acmeList.rootPath?.endsWith(path.join(".ee-library-tenants", "org-acme")));

    const sameSlugDefault = await createVendor(DEFAULT_ORG, {
      name: "Acme Fab",
      category: "pcb_fab",
      summary: "Default-org shop with the same display name."
    });
    assert.equal(sameSlugDefault.status, "ok");
    const defaultMetadata = path.join(sandbox.root, "pcb-fab", "acme-fab", "vendor.json");
    const acmeMetadata = path.join(
      sandbox.root,
      ".ee-library-tenants",
      "org-acme",
      "pcb-fab",
      "acme-fab",
      "vendor.json"
    );
    assert.equal(
      (JSON.parse(await readFile(defaultMetadata, "utf8")) as { summary: string }).summary,
      "Default-org shop with the same display name."
    );
    assert.equal(
      (JSON.parse(await readFile(acmeMetadata, "utf8")) as { summary: string }).summary,
      "Confidential Acme process notes."
    );

    const foreignUpload = await saveVendorFile(DEFAULT_ORG, "acme-fab", "notes", {
      filename: "should-not-touch-acme.md",
      content: "Written under org-default."
    });
    assert.equal(foreignUpload.status, "ok");
    if (foreignUpload.status !== "ok") return;
    assert.ok(!foreignUpload.absolutePath.includes(".ee-library-tenants"));

    const acmeDetailAfter = await buildVendorDetailResponse("org-acme", "acme-fab");
    assert.equal(acmeDetailAfter.notes.length, 1);
    assert.equal(acmeDetailAfter.notes[0]?.name, "nda-pricing.md");
  } finally {
    await sandbox.restore();
  }
});
