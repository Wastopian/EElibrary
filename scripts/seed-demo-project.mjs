#!/usr/bin/env node
/**
 * File header: Idempotent local demo seed for the real engineering walkthrough.
 *
 * The fixture is intentionally small but complete enough to click through the
 * site like an electrical engineer:
 *   - catalog parts imported by `npm run ingest:local`
 *   - one active demo project with two BOM revisions
 *   - one prior project so overlap and where-used are useful
 *   - exact, weak, ambiguous, ignored, and unmatched BOM rows
 *   - confirmed usages only for exact matched rows
 *   - project evidence, follow-ups, a reusable circuit block, and an export manifest
 *   - project-file mirror content on disk when the mirror is enabled
 *
 * The script refuses non-local databases unless `--force` is supplied. It resets
 * only deterministic demo records and leaves all non-demo project data untouched.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./lib/dotenv.mjs";
import { connectClient, isLocalDatabase, requireDatabaseUrl } from "./lib/db.mjs";
import { fromRepoRoot } from "./lib/paths.mjs";

/** DEMO_UPDATED_AT_ISO keeps the fixture stable and easy to diff in local databases. */
export const DEMO_UPDATED_AT_ISO = "2026-05-16T12:00:00.000Z";

/** DEMO_PROJECT_KEY is the main project engineers open for the walkthrough. */
export const DEMO_PROJECT_KEY = "DEMO-POCKET-MCU";

/** DEMO_PROJECT_ID matches the API's deterministic project id rule for DEMO_PROJECT_KEY. */
export const DEMO_PROJECT_ID = "project-demo-pocket-mcu";

/** DEMO_REFERENCE_PROJECT_KEY is a tiny prior project that makes overlap and where-used non-empty. */
export const DEMO_REFERENCE_PROJECT_KEY = "DEMO-REFERENCE-LOGGER";

/** DEMO_REFERENCE_PROJECT_ID matches the API's deterministic project id rule for the prior project. */
export const DEMO_REFERENCE_PROJECT_ID = "project-demo-reference-logger";

/** DEMO_CIRCUIT_BLOCK_KEY identifies the reusable pattern seeded for circuit-block workspaces. */
export const DEMO_CIRCUIT_BLOCK_KEY = "DEMO-POCKET-MCU-CORE";

/** DEMO_CIRCUIT_BLOCK_ID matches the API's deterministic circuit-block id rule. */
export const DEMO_CIRCUIT_BLOCK_ID = "cblock-demo-pocket-mcu-core";

/** DEMO_CABLE_ASSEMBLY_ID identifies the seeded Area 2 cable record. */
export const DEMO_CABLE_ASSEMBLY_ID = "cable-demo-pocket-mcu-jst-power";

/** DEMO_FIXTURE_ID identifies the seeded Area 2 test fixture record. */
export const DEMO_FIXTURE_ID = "fixture-demo-pocket-mcu-bringup";

/** PART_IDS_REQUIRED must exist after `npm run ingest:local`; no catalog records are invented here. */
export const PART_IDS_REQUIRED = [
  "part-stm32g031k8t6",
  "part-tps7a02dbvr",
  "part-grm188r71c104ka01d",
  "part-ci-jst-ph-housing",
  "part-ci-jst-ph-mate"
];

/** DEMO_PARTS names the catalog rows used by BOM lines, compare links, and bundle omissions. */
const DEMO_PARTS = {
  capacitor: {
    assetTypes: ["datasheet", "footprint", "symbol"],
    manufacturer: "Murata",
    mpn: "GRM188R71C104KA01D",
    partId: "part-grm188r71c104ka01d"
  },
  connector: {
    assetTypes: ["datasheet", "footprint", "symbol", "three_d_model"],
    manufacturer: "JST",
    mpn: "JST-PH-2P-HSG",
    partId: "part-ci-jst-ph-housing"
  },
  ldo: {
    assetTypes: ["datasheet", "footprint", "symbol", "three_d_model", "mechanical_drawing"],
    manufacturer: "Texas Instruments",
    mpn: "TPS7A02DBVR",
    partId: "part-tps7a02dbvr"
  },
  mcu: {
    assetTypes: ["datasheet", "footprint", "symbol", "three_d_model"],
    manufacturer: "STMicroelectronics",
    mpn: "STM32G031K8T6",
    partId: "part-stm32g031k8t6"
  }
};

/** DEMO_REVISIONS are the two revisions used by diagnostics and revision compare. */
export const DEMO_REVISIONS = [
  {
    createdAt: "2026-05-16T10:00:00.000Z",
    id: buildRevisionId(DEMO_PROJECT_ID, "R0.1"),
    label: "R0.1",
    releasedAt: "2026-05-16T10:30:00.000Z",
    sourceReference: "demo://pocket-mcu/bom-r0.1.csv",
    status: "released",
    updatedAt: "2026-05-16T10:30:00.000Z"
  },
  {
    createdAt: "2026-05-16T11:00:00.000Z",
    id: buildRevisionId(DEMO_PROJECT_ID, "R0.2"),
    label: "R0.2",
    releasedAt: null,
    sourceReference: "demo://pocket-mcu/bom-r0.2.csv",
    status: "in_review",
    updatedAt: DEMO_UPDATED_AT_ISO
  }
];

/** DEMO_REFERENCE_REVISION gives the overlap panel a prior released project. */
const DEMO_REFERENCE_REVISION = {
  createdAt: "2026-05-16T09:00:00.000Z",
  id: buildRevisionId(DEMO_REFERENCE_PROJECT_ID, "A"),
  label: "A",
  releasedAt: "2026-05-16T09:30:00.000Z",
  sourceReference: "demo://reference-logger/bom-a.csv",
  status: "released",
  updatedAt: "2026-05-16T09:30:00.000Z"
};

/** DEMO_BOM_IMPORTS are the main project BOM uploads shown on project detail. */
export const DEMO_BOM_IMPORTS = [
  {
    id: "bom-demo-pocket-mcu-r0-1",
    importedAt: "2026-05-16T10:15:00.000Z",
    revisionId: DEMO_REVISIONS[0].id,
    revisionLabel: DEMO_REVISIONS[0].label,
    sourceFilename: "demo-pocket-mcu-r0.1.csv",
    lines: [
      buildBomLine("line-demo-pmc-r01-u1", 1, ["U1"], 1, DEMO_PARTS.mcu, "Main MCU for first bring-up.", "matched", 1),
      buildBomLine("line-demo-pmc-r01-u2", 2, ["U2"], 1, DEMO_PARTS.ldo, "1.8 V low-IQ regulator.", "matched", 1),
      buildBomLine("line-demo-pmc-r01-c1", 3, ["C1", "C2"], 2, DEMO_PARTS.capacitor, "MCU and regulator decoupling.", "matched", 1),
      buildBomLine("line-demo-pmc-r01-j1", 4, ["J1"], 1, DEMO_PARTS.connector, "Two-pin battery harness connector.", "matched", 1),
      {
        confidence: 0.6,
        designators: ["C3"],
        id: "line-demo-pmc-r01-c3-weak",
        matchStatus: "weak_match",
        matchedPartId: null,
        quantity: 1,
        rawDescription: "Generic 0.1 uF capacitor without manufacturer.",
        rawManufacturer: null,
        rawMpn: "GRM188R71C104KA01D",
        rawNotes: "Exact MPN is present, but manufacturer was omitted. Review before confirming.",
        rawSupplierReference: "BOM-CAP-ALT",
        rowNumber: 5
      },
      {
        confidence: null,
        designators: ["U3"],
        id: "line-demo-pmc-r01-u3-unmatched",
        matchStatus: "unmatched",
        matchedPartId: null,
        quantity: 1,
        rawDescription: "Placeholder PMIC row used to exercise catalog intake recovery.",
        rawManufacturer: "Demo Supplier",
        rawMpn: "FAKE-PMIC-404",
        rawNotes: "Import a real PMIC or remove this row before release.",
        rawSupplierReference: "BOM-PMIC-TBD",
        rowNumber: 6
      },
      {
        confidence: null,
        designators: [],
        id: "line-demo-pmc-r01-shield-ignored",
        matchStatus: "ignored",
        matchedPartId: null,
        quantity: null,
        rawDescription: "Optional shield can, not loaded for R0.1.",
        rawManufacturer: null,
        rawMpn: "SHIELD-OPTION",
        rawNotes: "DNP row retained as BOM hygiene context.",
        rawSupplierReference: null,
        rowNumber: 7
      }
    ]
  },
  {
    id: "bom-demo-pocket-mcu-r0-2",
    importedAt: DEMO_UPDATED_AT_ISO,
    revisionId: DEMO_REVISIONS[1].id,
    revisionLabel: DEMO_REVISIONS[1].label,
    sourceFilename: "demo-pocket-mcu-r0.2.csv",
    lines: [
      buildBomLine("line-demo-pmc-r02-u1", 1, ["U1"], 1, DEMO_PARTS.mcu, "Main MCU retained from R0.1.", "matched", 1),
      buildBomLine("line-demo-pmc-r02-u2", 2, ["U2"], 1, DEMO_PARTS.ldo, "1.8 V low-IQ regulator retained from R0.1.", "matched", 1),
      buildBomLine("line-demo-pmc-r02-c1", 3, ["C1", "C2", "C4", "C5"], 4, DEMO_PARTS.capacitor, "Extra decoupling added after first bring-up.", "matched", 1),
      buildBomLine("line-demo-pmc-r02-j1", 4, ["J1"], 1, DEMO_PARTS.connector, "Two-pin battery harness connector retained.", "matched", 1),
      {
        confidence: null,
        designators: ["RT1"],
        id: "line-demo-pmc-r02-rt1-unmatched",
        matchStatus: "unmatched",
        matchedPartId: null,
        quantity: 1,
        rawDescription: "10 k NTC sensor not yet imported.",
        rawManufacturer: "Demo Supplier",
        rawMpn: "SENSOR-NTC-10K-0603",
        rawNotes: "Use provider lookup or add an internal catalog row.",
        rawSupplierReference: "BOM-NTC-TBD",
        rowNumber: 5
      },
      {
        confidence: null,
        designators: ["C3"],
        id: "line-demo-pmc-r02-c3-ambiguous",
        matchStatus: "ambiguous",
        matchedPartId: null,
        quantity: 1,
        rawDescription: "0603 0.1 uF 16 V X7R capacitor.",
        rawManufacturer: null,
        rawMpn: "0603 0.1uF 16V",
        rawNotes: "Generic text can map to multiple passives; do not confirm without review.",
        rawSupplierReference: "BOM-CAP-GENERIC",
        rowNumber: 6
      }
    ]
  }
];

/** DEMO_REFERENCE_BOM_IMPORTS give where-used and overlap a real prior project. */
const DEMO_REFERENCE_BOM_IMPORTS = [
  {
    id: "bom-demo-reference-logger-a",
    importedAt: "2026-05-16T09:20:00.000Z",
    revisionId: DEMO_REFERENCE_REVISION.id,
    revisionLabel: DEMO_REFERENCE_REVISION.label,
    sourceFilename: "demo-reference-logger-a.csv",
    lines: [
      buildBomLine("line-demo-ref-a-u10", 1, ["U10"], 1, DEMO_PARTS.ldo, "Reference logger regulator.", "matched", 1),
      buildBomLine("line-demo-ref-a-c10", 2, ["C10", "C11"], 2, DEMO_PARTS.capacitor, "Reference logger decoupling.", "matched", 1),
      buildBomLine("line-demo-ref-a-j10", 3, ["J10"], 1, DEMO_PARTS.connector, "Reference logger battery harness.", "matched", 1)
    ]
  }
];

/** DEMO_PROJECTS keeps project metadata grouped with the revision and BOM payloads. */
const DEMO_PROJECTS = [
  {
    bomImports: DEMO_BOM_IMPORTS,
    createdAt: "2026-05-16T10:00:00.000Z",
    description:
      "Local engineering walkthrough: catalog search, BOM import, row matching, where-used, overlap, compare, evidence, follow-ups, circuit blocks, and export bundles.",
    id: DEMO_PROJECT_ID,
    name: "Demo Pocket MCU",
    owner: "demo-hardware",
    projectKey: DEMO_PROJECT_KEY,
    revisions: DEMO_REVISIONS,
    status: "prototype",
    updatedAt: DEMO_UPDATED_AT_ISO
  },
  {
    bomImports: DEMO_REFERENCE_BOM_IMPORTS,
    createdAt: "2026-05-16T09:00:00.000Z",
    description: "Prior released demo project used only to make overlap and where-used context visible.",
    id: DEMO_REFERENCE_PROJECT_ID,
    name: "Demo Reference Logger",
    owner: "demo-hardware",
    projectKey: DEMO_REFERENCE_PROJECT_KEY,
    revisions: [DEMO_REFERENCE_REVISION],
    status: "production",
    updatedAt: "2026-05-16T09:30:00.000Z"
  }
];

/** DEMO_CIRCUIT_BLOCK_PARTS are optional because linked catalog parts still have review/export gaps. */
const DEMO_CIRCUIT_BLOCK_PARTS = [
  {
    id: buildCircuitBlockPartId(DEMO_CIRCUIT_BLOCK_ID, DEMO_PARTS.mcu.partId, "Main MCU"),
    isRequired: false,
    notes: "Optional demo role: promote to required only after part approval and export readiness are complete.",
    partId: DEMO_PARTS.mcu.partId,
    quantity: 1,
    role: "Main MCU",
    substitutionPolicy: "do_not_substitute"
  },
  {
    id: buildCircuitBlockPartId(DEMO_CIRCUIT_BLOCK_ID, DEMO_PARTS.ldo.partId, "1V8 regulator"),
    isRequired: false,
    notes: "Optional demo role: regulator is useful context, but CAD/export gaps remain part-level work.",
    partId: DEMO_PARTS.ldo.partId,
    quantity: 1,
    role: "1V8 regulator",
    substitutionPolicy: "exact_required"
  },
  {
    id: buildCircuitBlockPartId(DEMO_CIRCUIT_BLOCK_ID, DEMO_PARTS.capacitor.partId, "Decoupling capacitor"),
    isRequired: false,
    notes: "Optional demo role: quantity should be reviewed per layout.",
    partId: DEMO_PARTS.capacitor.partId,
    quantity: 4,
    role: "Decoupling capacitor",
    substitutionPolicy: "equivalent_allowed"
  },
  {
    id: buildCircuitBlockPartId(DEMO_CIRCUIT_BLOCK_ID, DEMO_PARTS.connector.partId, "Battery harness"),
    isRequired: false,
    notes: "Optional demo role: connector buildability remains separate from part approval.",
    partId: DEMO_PARTS.connector.partId,
    quantity: 1,
    role: "Battery harness",
    substitutionPolicy: "approved_alternate_allowed"
  }
];

/** DEMO_INTERCONNECT_PIN_MAP_ROWS seeds enough pin data to make the Area 2 workspace useful. */
export const DEMO_INTERCONNECT_PIN_MAP_ROWS = buildDemoInterconnectPinMapRows();

/**
 * Parses CLI flags for the demo seed helper.
 */
export function parseSeedDemoProjectArgs(argv) {
  const parsed = { force: false };

  for (const arg of argv) {
    if (arg === "--force") {
      parsed.force = true;
    }
  }

  return parsed;
}

/**
 * Builds a compact route list for setup output and docs.
 */
export function buildDemoRouteGuide() {
  return [
    { label: "Project walkthrough", path: `/projects/${DEMO_PROJECT_ID}` },
    { label: "Catalog search", path: "/catalog?q=TPS7A02DBVR" },
    { label: "Part detail", path: "/parts/part-tps7a02dbvr" },
    { label: "Where-used", path: "/where-used?targetType=part&q=part-tps7a02dbvr" },
    { label: "Compare project parts", path: "/compare?parts=part-stm32g031k8t6,part-tps7a02dbvr,part-grm188r71c104ka01d,part-ci-jst-ph-housing" },
    { label: "Circuit block", path: `/circuit-blocks/${DEMO_CIRCUIT_BLOCK_ID}` },
    { label: "Connector sets", path: "/connector-sets?q=JST-PH" },
    { label: "Interconnects", path: "/interconnects" },
    { label: "Evidence vault", path: `/evidence?targetType=project&q=${DEMO_PROJECT_ID}` }
  ];
}

/**
 * Builds the import summary JSON shown in project BOM import tables.
 */
export function buildDemoBomImportSummary(lines) {
  return {
    ambiguousLineCount: countLinesByStatus(lines, "ambiguous"),
    confirmedUsageLineCount: lines.filter((line) => line.matchStatus === "matched" && line.matchedPartId).length,
    demoSeed: true,
    ignoredLineCount: countLinesByStatus(lines, "ignored"),
    matchedLineCount: countLinesByStatus(lines, "matched"),
    rowCount: lines.length,
    unmatchedLineCount: countLinesByStatus(lines, "unmatched"),
    weakMatchLineCount: countLinesByStatus(lines, "weak_match")
  };
}

/**
 * Builds an honest manifest-only export bundle so the export panel has history
 * without claiming any non-existent file download.
 */
export function buildDemoExportManifest({ bundleFormat, bundleId, generatedAt, projectId, revisionLabel }) {
  const omittedParts = [DEMO_PARTS.mcu, DEMO_PARTS.ldo, DEMO_PARTS.capacitor, DEMO_PARTS.connector];
  const omissions = omittedParts.flatMap((part) =>
    part.assetTypes.map((assetType) => ({
      assetType,
      partId: part.partId,
      partMpn: part.mpn,
      reason: "not_verified_for_export"
    }))
  );
  const warnings = [
    `${omissions.length} demo asset references omitted because the local catalog has not verified file-backed export assets yet.`,
    "Use this row to inspect manifest omissions, then generate a real bundle after validating files."
  ];

  return {
    bundleFormat,
    bundleId,
    controlledAssets: [],
    controlSummary: {
      highestAccessLevel: null,
      itarControlledCount: 0,
      restrictedCount: 0
    },
    generatedAt,
    includedAssets: [],
    omissions,
    projectId,
    revisionLabel,
    warnings
  };
}

/**
 * Runs the end-to-end seed inside one transaction, then writes project mirror files.
 */
async function main() {
  await loadEnvFile(fromRepoRoot(".env"));
  const args = parseSeedDemoProjectArgs(process.argv.slice(2));
  const databaseUrl = requireDatabaseUrl();

  if (!isLocalDatabase(databaseUrl) && !args.force) {
    throw new Error("seed:demo-project refused: DATABASE_URL is not localhost. Re-run with -- --force if this is intentional.");
  }

  const client = await connectClient();

  try {
    await client.query("BEGIN");
    await clearDemoFixture(client);
    await assertRequiredParts(client);
    await seedProjects(client);
    await seedCircuitBlock(client);
    await seedEvidence(client);
    await seedInterconnects(client);
    await seedFollowUps(client);
    await seedExportBundle(client);
    await client.query("COMMIT");
    await seedProjectMirrorFiles();
    printSuccess();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Builds a deterministic BOM line for one exact catalog part.
 */
function buildBomLine(id, rowNumber, designators, quantity, part, rawDescription, matchStatus, confidence) {
  return {
    confidence,
    designators,
    id,
    matchStatus,
    matchedPartId: part.partId,
    quantity,
    rawDescription,
    rawManufacturer: part.manufacturer,
    rawMpn: part.mpn,
    rawNotes: "Demo fixture exact internal catalog match.",
    rawSupplierReference: `DEMO-${part.mpn}`,
    rowNumber
  };
}

/**
 * Deletes only deterministic demo rows, including older demo-seed ids from previous revisions.
 */
async function clearDemoFixture(client) {
  const projectIds = DEMO_PROJECTS.map((project) => project.id);
  const targetIds = [
    ...projectIds,
    DEMO_CIRCUIT_BLOCK_ID,
    ...allDemoBomImports().map((entry) => entry.id),
    ...allDemoBomLines().map((entry) => entry.id),
    ...allDemoBomLines().map((entry) => buildUsageId(entry.id)),
    ...DEMO_CIRCUIT_BLOCK_PARTS.map((entry) => entry.id)
  ];

  await client.query("DELETE FROM cable_pin_map_rows WHERE cable_assembly_id = $1 OR id LIKE 'pin-demo-pocket-mcu-%'", [DEMO_CABLE_ASSEMBLY_ID]);
  await client.query("DELETE FROM fixture_ports WHERE fixture_id = $1 OR cable_assembly_id = $2", [DEMO_FIXTURE_ID, DEMO_CABLE_ASSEMBLY_ID]);
  await client.query("DELETE FROM test_fixtures WHERE id = $1", [DEMO_FIXTURE_ID]);
  await client.query("DELETE FROM cable_assembly_ends WHERE cable_assembly_id = $1", [DEMO_CABLE_ASSEMBLY_ID]);
  await client.query("DELETE FROM cable_assemblies WHERE id = $1", [DEMO_CABLE_ASSEMBLY_ID]);
  await client.query("DELETE FROM project_revision_approval_gates WHERE project_id = ANY($1::text[])", [projectIds]);
  await client.query("DELETE FROM circuit_block_instantiations WHERE project_id = ANY($1::text[]) OR circuit_block_id = $2", [projectIds, DEMO_CIRCUIT_BLOCK_ID]);
  await client.query("DELETE FROM export_bundles WHERE project_id = ANY($1::text[])", [projectIds]);
  await client.query("DELETE FROM follow_up_records WHERE target_id = ANY($1::text[])", [[...projectIds, DEMO_CIRCUIT_BLOCK_ID]]);
  await client.query("DELETE FROM evidence_attachments WHERE id LIKE 'evidence-demo-%' OR target_id = ANY($1::text[])", [targetIds]);
  await client.query("DELETE FROM circuit_block_known_risks WHERE circuit_block_id = $1", [DEMO_CIRCUIT_BLOCK_ID]);
  await client.query("DELETE FROM circuit_block_parts WHERE circuit_block_id = $1", [DEMO_CIRCUIT_BLOCK_ID]);
  await client.query("DELETE FROM circuit_blocks WHERE id = $1", [DEMO_CIRCUIT_BLOCK_ID]);
  await client.query("DELETE FROM project_part_usages WHERE project_id = ANY($1::text[])", [projectIds]);
  await client.query("DELETE FROM bom_lines WHERE project_id = ANY($1::text[])", [projectIds]);
  await client.query("DELETE FROM bom_imports WHERE project_id = ANY($1::text[])", [projectIds]);
  await client.query("DELETE FROM project_revisions WHERE project_id = ANY($1::text[])", [projectIds]);
  await client.query("DELETE FROM projects WHERE id = ANY($1::text[])", [projectIds]);
}

/**
 * Verifies the local-catalog ingest has created every part used by the fixture.
 */
async function assertRequiredParts(client) {
  const result = await client.query(
    "SELECT id FROM parts WHERE id = ANY($1::text[])",
    [PART_IDS_REQUIRED]
  );
  const found = new Set(result.rows.map((row) => row.id));
  const missing = PART_IDS_REQUIRED.filter((id) => !found.has(id));

  if (missing.length > 0) {
    throw new Error(
      `seed:demo-project missing catalog part row(s): ${missing.join(", ")}\n` +
        "Run `npm run ingest:local` after migrations so local-catalog fixtures exist, then re-run this script."
    );
  }
}

/**
 * Seeds every demo project, revision, BOM import, line, and exact-match usage row.
 */
async function seedProjects(client) {
  const snapshots = await buildPartSnapshotMap(client);

  for (const project of DEMO_PROJECTS) {
    await insertProject(client, project);

    for (const revision of project.revisions) {
      await insertRevision(client, project, revision);
    }

    for (const bomImport of project.bomImports) {
      await insertBomImport(client, project, bomImport);

      for (const line of bomImport.lines) {
        await insertBomLine(client, project, bomImport, line);

        if (line.matchStatus === "matched" && line.matchedPartId) {
          await insertProjectUsage(client, project, bomImport, line, snapshots.get(line.matchedPartId));
        }
      }
    }
  }
}

/**
 * Inserts one project row with stable timestamps.
 */
async function insertProject(client, project) {
  await client.query(
    `
      INSERT INTO projects (id, project_key, name, description, owner, status, org_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'org-default', $7, $8)
    `,
    [
      project.id,
      project.projectKey,
      project.name,
      project.description,
      project.owner,
      project.status,
      new Date(project.createdAt),
      new Date(project.updatedAt)
    ]
  );
}

/**
 * Inserts one revision row for the supplied project.
 */
async function insertRevision(client, project, revision) {
  await client.query(
    `
      INSERT INTO project_revisions (
        id, project_id, revision_label, revision_status, source_reference, released_at, org_id, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'org-default', $7, $8)
    `,
    [
      revision.id,
      project.id,
      revision.label,
      revision.status,
      revision.sourceReference,
      revision.releasedAt ? new Date(revision.releasedAt) : null,
      new Date(revision.createdAt),
      new Date(revision.updatedAt)
    ]
  );
}

/**
 * Inserts one processed BOM import row.
 */
async function insertBomImport(client, project, bomImport) {
  await client.query(
    `
      INSERT INTO bom_imports (
        id, project_id, project_revision_id, source_filename, source_format, storage_key,
        import_status, column_mapping, import_summary, imported_by, org_id, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, 'csv', NULL, 'processed', $5::jsonb, $6::jsonb, 'seed-demo-project', 'org-default', $7, $7)
    `,
    [
      bomImport.id,
      project.id,
      bomImport.revisionId,
      bomImport.sourceFilename,
      JSON.stringify(buildDemoColumnMapping()),
      JSON.stringify(buildDemoBomImportSummary(bomImport.lines)),
      new Date(bomImport.importedAt)
    ]
  );
}

/**
 * Inserts one raw BOM row and preserves match status without confirming weak rows.
 */
async function insertBomLine(client, project, bomImport, line) {
  await client.query(
    `
      INSERT INTO bom_lines (
        id, bom_import_id, project_id, project_revision_id, row_number, designators, quantity,
        raw_mpn, raw_manufacturer, raw_description, raw_supplier_reference, raw_notes,
        raw_row_payload, matched_part_id, match_status, match_confidence_score, org_id, created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10, $11, $12,
        $13::jsonb, $14, $15, $16, 'org-default', $17, $17
      )
    `,
    [
      line.id,
      bomImport.id,
      project.id,
      bomImport.revisionId,
      line.rowNumber,
      line.designators,
      line.quantity,
      line.rawMpn,
      line.rawManufacturer,
      line.rawDescription,
      line.rawSupplierReference,
      line.rawNotes,
      JSON.stringify(buildRawRowPayload(bomImport, line)),
      line.matchedPartId,
      line.matchStatus,
      line.confidence,
      new Date(bomImport.importedAt)
    ]
  );
}

/**
 * Inserts one confirmed usage row only for exact matched BOM lines.
 */
async function insertProjectUsage(client, project, bomImport, line, snapshot) {
  const revision = project.revisions.find((entry) => entry.id === bomImport.revisionId);
  const status = revision?.status === "released" ? "released" : "in_review";
  const updatedAt = new Date(revision?.updatedAt ?? bomImport.importedAt);

  await client.query(
    `
      INSERT INTO project_part_usages (
        id, project_id, project_revision_id, bom_line_id, part_id, usage_context,
        designators, quantity, usage_status, approval_snapshot, readiness_snapshot, org_id, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10::jsonb, $11::jsonb, 'org-default', $12, $12)
    `,
    [
      buildUsageId(line.id),
      project.id,
      bomImport.revisionId,
      line.id,
      line.matchedPartId,
      `${project.projectKey} ${bomImport.revisionLabel} row ${line.rowNumber}: ${line.rawDescription}`,
      line.designators,
      line.quantity,
      status,
      JSON.stringify(snapshot?.approval ?? buildMissingSnapshot("part_approvals")),
      JSON.stringify(snapshot?.readiness ?? buildMissingSnapshot("part_readiness_summaries")),
      updatedAt
    ]
  );
}

/**
 * Builds approval and readiness snapshots from current catalog truth.
 */
async function buildPartSnapshotMap(client) {
  const snapshots = new Map();

  for (const partId of PART_IDS_REQUIRED) {
    const [approval, readiness] = await Promise.all([
      readApprovalSnapshot(client, partId),
      readReadinessSnapshot(client, partId)
    ]);
    snapshots.set(partId, { approval, readiness });
  }

  return snapshots;
}

/**
 * Reads one part approval row into the immutable usage snapshot shape.
 */
async function readApprovalSnapshot(client, partId) {
  const result = await client.query(
    `
      SELECT approval_status, summary, detail, evidence, decided_by, decided_at, last_updated_at
      FROM part_approvals
      WHERE part_id = $1
    `,
    [partId]
  );
  const row = result.rows[0];

  if (!row) {
    return buildMissingSnapshot("part_approvals");
  }

  return {
    approvalStatus: row.approval_status,
    capturedAt: DEMO_UPDATED_AT_ISO,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    decidedBy: row.decided_by,
    detail: row.detail,
    evidence: row.evidence ?? [],
    source: "part_approvals",
    state: "available",
    summary: row.summary,
    sourceUpdatedAt: new Date(row.last_updated_at).toISOString()
  };
}

/**
 * Reads one part readiness row into the immutable usage snapshot shape.
 */
async function readReadinessSnapshot(client, partId) {
  const result = await client.query(
    `
      SELECT readiness_status, identity_status, connector_class, blocker_count,
             blocker_summary, recommended_actions, detail, last_evaluated_at
      FROM part_readiness_summaries
      WHERE part_id = $1
    `,
    [partId]
  );
  const row = result.rows[0];

  if (!row) {
    return buildMissingSnapshot("part_readiness_summaries");
  }

  return {
    blockerCount: Number(row.blocker_count ?? 0),
    blockerSummary: row.blocker_summary ?? [],
    capturedAt: DEMO_UPDATED_AT_ISO,
    connectorClass: row.connector_class,
    detail: row.detail,
    identityStatus: row.identity_status,
    readinessStatus: row.readiness_status,
    recommendedActions: row.recommended_actions ?? [],
    source: "part_readiness_summaries",
    state: "available",
    sourceUpdatedAt: new Date(row.last_evaluated_at).toISOString()
  };
}

/**
 * Builds a snapshot that records absence instead of inventing approval or readiness.
 */
function buildMissingSnapshot(source) {
  return {
    capturedAt: DEMO_UPDATED_AT_ISO,
    source,
    state: "not_recorded"
  };
}

/**
 * Seeds the reusable circuit block library with review-boundary-safe demo roles.
 */
async function seedCircuitBlock(client) {
  const now = new Date(DEMO_UPDATED_AT_ISO);

  await client.query(
    `
      INSERT INTO circuit_blocks (
        id, block_key, name, description, block_type, owner, status, reuse_scope, constraints, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, 'mcu_support', $5, 'in_review', $6, $7::jsonb, $8, $8)
    `,
    [
      DEMO_CIRCUIT_BLOCK_ID,
      DEMO_CIRCUIT_BLOCK_KEY,
      "Demo pocket MCU core",
      "Review-safe demo pattern linking the MCU, regulator, decoupling capacitor, and battery connector used by the walkthrough project.",
      "demo-hardware",
      "Use as a starting point only after linked parts and CAD assets are reviewed.",
      JSON.stringify({
        maxBoardArea: "25mm x 35mm demo board",
        supplyRails: ["1V8"],
        trustBoundary: "Circuit-block reuse does not approve linked parts or export files."
      }),
      now
    ]
  );

  for (const part of DEMO_CIRCUIT_BLOCK_PARTS) {
    await client.query(
      `
        INSERT INTO circuit_block_parts (
          id, circuit_block_id, part_id, role, quantity, is_required, substitution_policy, notes, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      `,
      [
        part.id,
        DEMO_CIRCUIT_BLOCK_ID,
        part.partId,
        part.role,
        part.quantity,
        part.isRequired,
        part.substitutionPolicy,
        part.notes,
        now
      ]
    );
  }

  await client.query(
    `
      INSERT INTO circuit_block_known_risks (
        id, circuit_block_id, title, detail, severity, recorded_by, recorded_at, evidence_url, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, 'caution', 'seed-demo-project', $5, $6, $5, $5)
    `,
    [
      "cblock-risk-demo-pocket-mcu-layout",
      DEMO_CIRCUIT_BLOCK_ID,
      "Review decoupling placement before reuse",
      "The demo block records useful roles, but layout placement and CAD export readiness still need project-specific review.",
      now,
      "https://example.com/ee-library-demo/pocket-mcu-layout-note"
    ]
  );
}

/**
 * Seeds provenance rows for the project, one BOM line, and the circuit block.
 */
async function seedEvidence(client) {
  const now = new Date(DEMO_UPDATED_AT_ISO);
  const rows = [
    {
      evidenceType: "link",
      id: "evidence-demo-pocket-mcu-review-link",
      notes: null,
      reviewStatus: "accepted",
      sourceUrl: "https://example.com/ee-library-demo/pocket-mcu-review",
      targetId: DEMO_PROJECT_ID,
      targetType: "project",
      title: "Demo pocket MCU review checklist"
    },
    {
      evidenceType: "note",
      id: "evidence-demo-pocket-mcu-ntc-note",
      notes: "RT1 is intentionally unmatched so engineers can run catalog intake and follow-up flow without risking a false match.",
      reviewStatus: "unreviewed",
      sourceUrl: null,
      targetId: "line-demo-pmc-r02-rt1-unmatched",
      targetType: "bom_line",
      title: "RT1 unmatched row review note"
    },
    {
      evidenceType: "link",
      id: "evidence-demo-pocket-mcu-core-block",
      notes: null,
      reviewStatus: "unreviewed",
      sourceUrl: "https://example.com/ee-library-demo/pocket-mcu-core",
      targetId: DEMO_CIRCUIT_BLOCK_ID,
      targetType: "circuit_block",
      title: "Demo pocket MCU core reuse note"
    }
  ];

  for (const row of rows) {
    await client.query(
      `
        INSERT INTO evidence_attachments (
          id, target_type, target_id, evidence_type, title, source_url, notes,
          provenance, review_status, uploaded_by, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual_internal', $8, 'seed-demo-project', $9, $9)
      `,
      [
        row.id,
        row.targetType,
        row.targetId,
        row.evidenceType,
        row.title,
        row.sourceUrl,
        row.notes,
        row.reviewStatus,
        now
      ]
    );
  }
}

/**
 * Seeds the Area 2 cable, fixture, and pin-map walkthrough rows.
 */
async function seedInterconnects(client) {
  const now = new Date(DEMO_UPDATED_AT_ISO);
  const cableEndAId = `${DEMO_CABLE_ASSEMBLY_ID}-end-a`;
  const cableEndBId = `${DEMO_CABLE_ASSEMBLY_ID}-end-b`;
  const fixturePortJ201Id = `${DEMO_FIXTURE_ID}-port-j201`;
  const fixturePortJ202Id = `${DEMO_FIXTURE_ID}-port-j202`;

  await client.query(
    `
      INSERT INTO cable_assemblies (
        id, cable_key, revision_label, assembly_status, project_id, project_revision_id,
        owner, description, source_document_ref, provenance, org_id, created_at, updated_at
      )
      VALUES ($1, $2, 'R0.2', 'in_review', $3, $4, $5, $6, $7, 'project_file', 'org-default', $8, $8)
    `,
    [
      DEMO_CABLE_ASSEMBLY_ID,
      "CAB-DEMO-PMC-JST-PWR",
      DEMO_PROJECT_ID,
      DEMO_REVISIONS[1].id,
      "demo-hardware",
      "Demo battery harness from the JST-PH connector set to fixture port J202. Pin rows are recorded for lookup only; bench reuse still needs review.",
      "demo-cable-cab-demo-pmc-jst-pwr-r0.2.csv",
      now
    ]
  );

  await client.query(
    `
      INSERT INTO cable_assembly_ends (
        id, cable_assembly_id, end_label, connector_ref, connector_part_id, mate_part_id, backshell_part_id,
        notes, org_id, created_at, updated_at
      )
      VALUES
        ($1, $2, 'A', 'J1', $3, $4, NULL, $5, 'org-default', $7, $7),
        ($6, $2, 'B', 'J202', NULL, NULL, NULL, $8, 'org-default', $7, $7)
    `,
    [
      cableEndAId,
      DEMO_CABLE_ASSEMBLY_ID,
      DEMO_PARTS.connector.partId,
      "part-ci-jst-ph-mate",
      "Catalog-matched JST-PH housing end used on the demo board.",
      cableEndBId,
      now,
      "Fixture-facing J202 end copied from the bring-up cable spreadsheet."
    ]
  );

  await client.query(
    `
      INSERT INTO test_fixtures (
        id, fixture_key, revision_label, fixture_status, project_id, owner, purpose,
        source_document_ref, provenance, org_id, created_at, updated_at
      )
      VALUES ($1, 'TFX-DEMO-PMC-BRINGUP', 'B', 'restricted', $2, 'demo-lab', $3, $4, 'project_file', 'org-default', $5, $5)
    `,
    [
      DEMO_FIXTURE_ID,
      DEMO_PROJECT_ID,
      "Demo bring-up fixture with J201 SWD/programming and J202 battery-harness ports.",
      "demo-fixture-tfx-demo-pmc-bringup-ports.md",
      now
    ]
  );

  await client.query(
    `
      INSERT INTO fixture_ports (
        id, fixture_id, connector_ref, connector_part_id, mate_part_id, cable_assembly_id,
        port_role, notes, org_id, created_at, updated_at
      )
      VALUES
        ($1, $2, 'J201', NULL, NULL, NULL, 'SWD/programming header', 'Fixture-side programming port. No catalog part matched yet.', 'org-default', $5, $5),
        ($3, $2, 'J202', NULL, NULL, $4, 'Battery harness input', 'Use only with the seeded R0.2 cable until bench review is complete.', 'org-default', $5, $5)
    `,
    [
      fixturePortJ201Id,
      DEMO_FIXTURE_ID,
      fixturePortJ202Id,
      DEMO_CABLE_ASSEMBLY_ID,
      now
    ]
  );

  for (const row of DEMO_INTERCONNECT_PIN_MAP_ROWS) {
    await client.query(
      `
        INSERT INTO cable_pin_map_rows (
          id, cable_assembly_id, cable_end_id, fixture_port_id, end_label, connector_ref,
          pin_number, signal_name, wire_color, wire_gauge, destination_connector_ref,
          destination_pin_number, confidence_score, evidence_attachment_id, source_document_ref,
          notes, org_id, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, 'B', 'J202',
          $5, $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, 'org-default', $15, $15
        )
      `,
      [
        row.id,
        DEMO_CABLE_ASSEMBLY_ID,
        cableEndBId,
        fixturePortJ202Id,
        row.pinNumber,
        row.signalName,
        row.wireColor,
        row.wireGauge,
        row.destinationConnectorRef,
        row.destinationPinNumber,
        row.confidenceScore,
        row.evidenceAttachmentId,
        row.sourceDocumentRef,
        row.notes,
        now
      ]
    );
  }
}

/**
 * Seeds assignable work rows that mirror the kinds of gaps BOM health will compute.
 */
async function seedFollowUps(client) {
  const now = new Date(DEMO_UPDATED_AT_ISO);
  const rows = [
    {
      assignedTo: "demo-hardware",
      detail: "R0.2 contains RT1 with MPN SENSOR-NTC-10K-0603, which is not in the catalog.",
      id: buildFollowUpId("project", DEMO_PROJECT_ID, "bom_health", "demo-unmatched-sensor"),
      nextAction: "Run provider lookup for the sensor or replace the BOM row with an approved internal part.",
      severity: "review",
      sourceFindingId: "demo-unmatched-sensor",
      sourceInputs: ["line-demo-pmc-r02-rt1-unmatched", "SENSOR-NTC-10K-0603"],
      status: "open",
      title: "Resolve unmatched NTC sensor row"
    },
    {
      assignedTo: "demo-library",
      detail: "The matched project parts still have missing or review-required CAD/export assets.",
      id: buildFollowUpId("project", DEMO_PROJECT_ID, "bom_health", "demo-export-assets"),
      nextAction: "Review asset cards on part detail, validate file-backed CAD, then generate a real export bundle.",
      severity: "danger",
      sourceFindingId: "demo-export-assets",
      sourceInputs: PART_IDS_REQUIRED,
      status: "in_progress",
      title: "Close CAD/export gaps before release"
    }
  ];

  for (const row of rows) {
    await client.query(
      `
        INSERT INTO follow_up_records (
          id, target_type, target_id, source_type, source_finding_id, title, detail,
          next_action, severity, status, assigned_to, source_inputs, evidence_attachment_ids,
          created_at, updated_at
        )
        VALUES (
          $1, 'project', $2, 'bom_health', $3, $4, $5,
          $6, $7, $8, $9, $10::jsonb, '[]'::jsonb,
          $11, $11
        )
      `,
      [
        row.id,
        DEMO_PROJECT_ID,
        row.sourceFindingId,
        row.title,
        row.detail,
        row.nextAction,
        row.severity,
        row.status,
        row.assignedTo,
        JSON.stringify(row.sourceInputs),
        now
      ]
    );
  }
}

/**
 * Seeds one manifest-only export bundle that honestly lists omitted assets.
 */
async function seedExportBundle(client) {
  const bundleId = "ebundle-demo-pocket-mcu-r0-2-neutral";
  const generatedAt = "2026-05-16T12:05:00.000Z";
  const manifest = buildDemoExportManifest({
    bundleFormat: "neutral",
    bundleId,
    generatedAt,
    projectId: DEMO_PROJECT_ID,
    revisionLabel: "R0.2"
  });

  await client.query(
    `
      INSERT INTO export_bundles (
        id, project_id, revision_label, bundle_format, storage_key, archive_storage_key,
        manifest, part_count, included_asset_count, omitted_asset_count, warning_count,
        assembly_status, assembly_error, assembly_completed_at, assembly_attempt_count,
        archive_sha256, manifest_sha256, signature_status, signature_algorithm,
        signature_public_key_fingerprint, signature_storage_key, signature_signed_at,
        created_by, created_at
      )
      VALUES (
        $1, $2, 'R0.2', 'neutral', NULL, NULL,
        $3::jsonb, 4, 0, $4, $5,
        'not_required', NULL, NULL, 0,
        NULL, NULL, 'unsigned', NULL,
        NULL, NULL, NULL,
        'seed-demo-project', $6
      )
    `,
    [
      bundleId,
      DEMO_PROJECT_ID,
      JSON.stringify(manifest),
      manifest.omissions.length,
      manifest.warnings.length,
      new Date(generatedAt)
    ]
  );
}

/**
 * Writes small real files to the project mirror so the file panel is not empty.
 */
async function seedProjectMirrorFiles() {
  const mirrorRoot = resolveProjectFilesRoot();

  if (!mirrorRoot) {
    return;
  }

  const projectRoot = safeJoin(mirrorRoot, sanitizeProjectKey(DEMO_PROJECT_KEY));
  const folders = {
    datasheets: join(projectRoot, "datasheets"),
    hardware: join(projectRoot, "hardware"),
    models: join(projectRoot, "models"),
    notes: join(projectRoot, "notes"),
    partsList: join(projectRoot, "parts-list")
  };

  await Promise.all(Object.values(folders).map((folder) => mkdir(folder, { recursive: true })));
  await writeFile(join(folders.partsList, "demo-pocket-mcu-r0.1.csv"), buildCsvForImport(DEMO_BOM_IMPORTS[0]), "utf8");
  await writeFile(join(folders.partsList, "demo-pocket-mcu-r0.2.csv"), buildCsvForImport(DEMO_BOM_IMPORTS[1]), "utf8");
  await writeFile(join(folders.partsList, "demo-custom-hardware.csv"), buildDemoCustomHardwareReferenceCsv(), "utf8");
  await writeFile(join(folders.notes, "bringup-review.md"), buildBringupReviewNote(), "utf8");
  const demoHardwareFolder = join(folders.hardware, "PTA-1001");
  await mkdir(demoHardwareFolder, { recursive: true });
  await writeFile(join(demoHardwareFolder, "README.md"), buildDemoCustomHardwareNote(), "utf8");
  const cableHardwareFolder = join(folders.hardware, "CAB-DEMO-PMC-JST-PWR");
  await mkdir(cableHardwareFolder, { recursive: true });
  await writeFile(join(cableHardwareFolder, "demo-cable-cab-demo-pmc-jst-pwr-r0.2.csv"), buildDemoInterconnectCableCsv(), "utf8");
  const fixtureHardwareFolder = join(folders.hardware, "TFX-DEMO-PMC-BRINGUP");
  await mkdir(fixtureHardwareFolder, { recursive: true });
  await writeFile(join(fixtureHardwareFolder, "demo-fixture-tfx-demo-pmc-bringup-ports.md"), buildDemoFixturePortNote(), "utf8");
  await writeFile(
    join(folders.datasheets, "README.txt"),
    "Drop reviewed datasheets here. The seeded catalog records are references only until files are captured and reviewed.\n",
    "utf8"
  );
  await writeFile(
    join(folders.models, "README.txt"),
    "Drop verified STEP or native CAD files here. The demo seed does not invent export-ready model files.\n",
    "utf8"
  );

  const messyTestFolder = join(projectRoot, "Bob-drop", "old-tests");
  await mkdir(messyTestFolder, { recursive: true });
  await writeFile(join(messyTestFolder, "J202-test-procedure-rev-d.md"), buildDemoMessyTestProcedureNote(), "utf8");
  await writeFile(join(messyTestFolder, "J202-atp-run-sheet-rev-d.txt"), buildDemoMessyAtpRunSheet(), "utf8");

  const networkDumpFolder = join(projectRoot, "network-drive-dump", "rev-c");
  await mkdir(networkDumpFolder, { recursive: true });
  await writeFile(join(networkDumpFolder, "PMC-requirements-rev-c.txt"), buildDemoMessyRequirementsNote(), "utf8");
  await writeFile(join(networkDumpFolder, "J202-cable-pinout-rev-c.csv"), buildDemoMessyRevCPinoutCsv(), "utf8");
}

/**
 * Builds a tiny parts-list sidecar that exercises custom-hardware scanning without changing the
 * persisted demo BOM imports or confirmed usage counts.
 */
function buildDemoCustomHardwareReferenceCsv() {
  const rows = [
    ["Reference", "MPN", "Notes"],
    ["JIG1", "PTA-1001", "Folder-backed bring-up adapter"],
    ["JIG2", "PCA-1002", "Parts-list reference waiting on a hardware folder"]
  ];

  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n") + "\n";
}

/**
 * Builds the demo hardware note read by the project file mirror custom-hardware scanner.
 */
function buildDemoCustomHardwareNote() {
  return [
    "# PTA-1001",
    "",
    "Connects to: Pocket MCU SWD pogo header and JST-PH battery harness",
    "Tests: MCU programming, battery rail bring-up, and smoke-test current draw",
    "Project: DEMO-POCKET-MCU bring-up kit",
    "Notes: Internal fixture; keep with the demo project's bench hardware.",
    ""
  ].join("\n");
}

/**
 * Builds the deterministic pin-map rows used by the interconnect demo.
 */
function buildDemoInterconnectPinMapRows() {
  const rows = [
    ["1", "VBAT_IN", "red", 24, "J1", "1", 0.94, "Main battery input copied from the Rev R0.2 cable sheet."],
    ["2", "VBAT_RETURN", "black", 24, "J1", "2", 0.94, "Battery return copied from the Rev R0.2 cable sheet."],
    ["3", "SWDIO", "green", 28, "J201", "2", 0.9, "Programming signal routed through the bring-up fixture."],
    ["4", "SWCLK", "white", 28, "J201", "4", 0.9, "Programming clock routed through the bring-up fixture."],
    ["5", "NRST", "yellow", 28, "J201", "6", 0.86, "Reset line verified against the fixture port list."],
    ["6", "3V3_SENSE", "orange", 28, "J201", "8", 0.84, "Voltage sense lead; check before powering a real board."],
    ["7", "UART_TX", "blue", 28, "J201", "10", 0.88, "Serial debug transmit from the DUT."],
    ["8", "UART_RX", "violet", 28, "J201", "12", 0.88, "Serial debug receive into the DUT."],
    ["9", "I2C_SCL", "brown", 28, "J201", "14", 0.82, "Optional sensor bus line on the fixture."],
    ["10", "I2C_SDA", "gray", 28, "J201", "16", 0.82, "Optional sensor bus line on the fixture."],
    ["11", "GPIO_BOOT0", "white/blue", 30, "J201", "18", 0.78, "Boot strap line from the fixture switch bank."],
    ["12", "GPIO_WAKE", "white/green", 30, "J201", "20", 0.78, "Wake input used during low-power testing."],
    ["13", "ADC_BAT_DIV", "white/orange", 30, "J201", "22", 0.8, "Battery-divider sense path."],
    ["14", "CURRENT_MON", "white/brown", 30, "J201", "24", 0.8, "Current monitor output from the fixture shunt."],
    ["15", "DUT_PRESENT", "white/gray", 30, "J201", "26", 0.76, "Fixture detect line; confirm before relying on automation."],
    ["16", "LED_TEST", "pink", 30, "J201", "28", 0.76, "Panel LED exercise line."],
    ["17", "SPARE_1", "tan", 30, null, null, 0.72, "Spare pin label came from an older drawing; needs another check."],
    ["18", "SPARE_2", "tan/black", 30, null, null, 0.72, "Spare pin label came from an older drawing; needs another check."],
    ["19", "GND_SHIELD", "drain", 24, "J201", "30", 0.91, "Shield drain tied at fixture side only."],
    ["20", "CHASSIS_REF", "green/yellow", 24, "J201", "32", 0.91, "Chassis reference line for the test setup."],
    ["21", "NTC_EXCITE", "white/red", 30, "J201", "34", 0.7, "Sensor excitation row kept low-confidence until RT1 is resolved."],
    ["22", "NTC_RETURN", "white/black", 30, "J201", "36", 0.7, "Sensor return row kept low-confidence until RT1 is resolved."],
    ["47", "RS422_TX+", "blue/white", 26, "J201", "47", 0.62, "Known review item: Rev C and Rev D disagree on this pair."],
    ["48", "RS422_TX-", "blue/black", 26, "J201", "48", 0.62, "Known review item: Rev C and Rev D disagree on this pair."]
  ];

  return rows.map(([pinNumber, signalName, wireColor, wireGauge, destinationConnectorRef, destinationPinNumber, confidenceScore, notes]) => ({
    confidenceScore,
    destinationConnectorRef,
    destinationPinNumber,
    evidenceAttachmentId: pinNumber === "47" || pinNumber === "48" ? "evidence-demo-pocket-mcu-review-link" : null,
    id: `pin-demo-pocket-mcu-j202-${slugify(pinNumber)}`,
    notes,
    pinNumber,
    signalName,
    sourceDocumentRef: "demo-cable-cab-demo-pmc-jst-pwr-r0.2.csv",
    wireColor,
    wireGauge
  }));
}

/**
 * Builds the cable pin-map CSV written beside the seeded project files.
 */
function buildDemoInterconnectCableCsv() {
  const header = ["Cable", "Revision", "End", "Connector Ref", "Pin", "Signal", "Wire Color", "Wire Gauge", "Destination Connector", "Destination Pin", "Confidence", "Notes"];
  const rows = DEMO_INTERCONNECT_PIN_MAP_ROWS.map((row) => [
    "CAB-DEMO-PMC-JST-PWR",
    "R0.2",
    "B",
    "J202",
    row.pinNumber,
    row.signalName,
    row.wireColor ?? "",
    row.wireGauge ?? "",
    row.destinationConnectorRef ?? "",
    row.destinationPinNumber ?? "",
    row.confidenceScore,
    row.notes
  ]);

  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n") + "\n";
}

/**
 * Builds the fixture port note written beside the seeded project files.
 */
function buildDemoFixturePortNote() {
  return [
    "# TFX-DEMO-PMC-BRINGUP ports",
    "",
    "- J201: SWD/programming header. No catalog part matched yet.",
    "- J202: Battery harness input. Seeded cable CAB-DEMO-PMC-JST-PWR plugs in here.",
    "- Restriction: use only with R0.2 demo cable until the J202 pin 47/48 disagreement is checked.",
    ""
  ].join("\n");
}

/**
 * Builds the same column names used by the seeded CSV files.
 */
function buildDemoColumnMapping() {
  return {
    designators: "Designator",
    description: "Description",
    manufacturer: "Manufacturer",
    mpn: "MPN",
    notes: "Notes",
    quantity: "Qty",
    supplierReference: "Supplier Ref"
  };
}

/**
 * Builds the raw payload preserved on each BOM line.
 */
function buildRawRowPayload(bomImport, line) {
  return {
    demoSeed: true,
    designator: line.designators.join(","),
    importId: bomImport.id,
    manufacturer: line.rawManufacturer,
    mpn: line.rawMpn,
    notes: line.rawNotes,
    quantity: line.quantity,
    rowNumber: line.rowNumber,
    supplierReference: line.rawSupplierReference
  };
}

/**
 * Builds a CSV file that mirrors the rows inserted into the database.
 */
function buildCsvForImport(bomImport) {
  const header = ["Designator", "Qty", "MPN", "Manufacturer", "Description", "Supplier Ref", "Notes"];
  const rows = bomImport.lines.map((line) => [
    line.designators.join(","),
    line.quantity ?? "",
    line.rawMpn ?? "",
    line.rawManufacturer ?? "",
    line.rawDescription ?? "",
    line.rawSupplierReference ?? "",
    line.rawNotes ?? ""
  ]);
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n") + "\n";
}

/**
 * Builds a small Markdown note for the project-files panel.
 */
function buildBringupReviewNote() {
  return [
    "# Demo Pocket MCU Bring-up Review",
    "",
    "- Start at the project page and inspect confirmed usage first.",
    "- Open BOM diagnostics to see exact, weak, ambiguous, ignored, and unmatched rows.",
    "- Use where-used on TPS7A02DBVR to see the prior reference logger project.",
    "- Export bundle history is manifest-only until CAD assets are verified and saved files are present.",
    ""
  ].join("\n");
}

/**
 * Builds a deliberately misplaced test-procedure note for the Area 1 document map demo.
 */
function buildDemoMessyTestProcedureNote() {
  return [
    "# J202 Bring-up Test Procedure",
    "",
    "Revision: Rev D",
    "Fixture: TFX-DEMO-PMC-BRINGUP",
    "Cable: CAB-DEMO-PMC-JST-PWR",
    "Connector J202 pin 47 carries RS422_TX+ in the old procedure.",
    "Action: compare this against the R0.2 pin map before reuse.",
    ""
  ].join("\n");
}

/**
 * Builds a second misplaced test file so the document map can show a real folder trend.
 */
function buildDemoMessyAtpRunSheet() {
  return [
    "J202 acceptance test run sheet",
    "",
    "Revision: Rev D",
    "Procedure: verify connector J202 pin 48 before powering the RS422_TX- pair.",
    "Fixture: TFX-DEMO-PMC-BRINGUP",
    ""
  ].join("\n");
}

/**
 * Builds a deliberately misplaced requirements note for the Area 1 document map demo.
 */
function buildDemoMessyRequirementsNote() {
  return [
    "Pocket MCU requirements Rev C",
    "",
    "The unit shall keep startup current below 500 mA during bring-up.",
    "The unit shall log brownout events before reset.",
    "The bench setup shall be reviewed before reuse.",
    ""
  ].join("\n");
}

/**
 * Builds a misplaced Rev C cable pinout so the network-drive dump looks mixed on purpose.
 */
function buildDemoMessyRevCPinoutCsv() {
  const rows = [
    ["Cable", "Revision", "Connector Ref", "Pin", "Signal", "Note"],
    ["CAB-DEMO-PMC-JST-PWR", "Rev C", "J202", "47", "RS422_TX+", "Old network-drive copy; compare against R0.2."],
    ["CAB-DEMO-PMC-JST-PWR", "Rev C", "J202", "48", "RS422_TX-", "Old network-drive copy; compare against R0.2."]
  ];

  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n") + "\n";
}

/**
 * Counts BOM lines with one match state.
 */
function countLinesByStatus(lines, status) {
  return lines.filter((line) => line.matchStatus === status).length;
}

/**
 * Returns every demo BOM import across all demo projects.
 */
function allDemoBomImports() {
  return DEMO_PROJECTS.flatMap((project) => project.bomImports);
}

/**
 * Returns every demo BOM line across all demo projects.
 */
function allDemoBomLines() {
  return allDemoBomImports().flatMap((bomImport) => bomImport.lines);
}

/**
 * Builds a deterministic project revision id matching the API helper.
 */
function buildRevisionId(projectId, revisionLabel) {
  return `rev-${slugify(projectId)}-${slugify(revisionLabel)}`;
}

/**
 * Builds a deterministic circuit-block role id matching the API helper.
 */
function buildCircuitBlockPartId(circuitBlockId, partId, role) {
  return `cbpart-${slugify(circuitBlockId)}-${slugify(partId)}-${slugify(role)}`;
}

/**
 * Builds a deterministic usage id from a BOM line id.
 */
function buildUsageId(bomLineId) {
  return `usage-${slugify(bomLineId)}`;
}

/**
 * Builds a deterministic follow-up id from source identity.
 */
function buildFollowUpId(targetType, targetId, sourceType, sourceFindingId) {
  return `followup-${slugify(targetType)}-${slugify(targetId)}-${slugify(sourceType)}-${slugify(sourceFindingId)}`;
}

/**
 * Converts labels into stable lowercase id segments.
 */
function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "") || "item";
}

/**
 * Resolves the project-file mirror root using the same documented env behavior as the API.
 */
function resolveProjectFilesRoot() {
  const raw = process.env.EE_LIBRARY_PROJECT_FILES_ROOT;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.toLowerCase() === "off") {
      return null;
    }
    if (trimmed.length > 0) {
      return isAbsolute(trimmed) ? trimmed : resolve(trimmed);
    }
  }

  return resolve(homedir(), "EE-Library", "projects");
}

/**
 * Sanitizes a project key into a safe directory segment.
 */
function sanitizeProjectKey(rawKey) {
  const filtered = rawKey
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "");

  return filtered.length > 0 ? filtered : "project";
}

/**
 * Joins a child path under a root and refuses path traversal.
 */
function safeJoin(root, child) {
  const candidate = resolve(root, child);
  const normalizedRoot = resolve(root);
  const childRelativePath = relative(normalizedRoot, candidate);

  if (childRelativePath.startsWith("..") || isAbsolute(childRelativePath)) {
    throw new Error(`Resolved project mirror path escapes root: ${candidate}`);
  }

  return candidate;
}

/**
 * Escapes one value for the seeded CSV files.
 */
function escapeCsvCell(value) {
  const text = String(value ?? "");

  if (/[",\n\r]/u.test(text)) {
    return `"${text.replace(/"/gu, '""')}"`;
  }

  return text;
}

/**
 * Prints a compact route guide after the seed succeeds.
 */
function printSuccess() {
  console.log(`seed:demo-project ok - project ${DEMO_PROJECT_KEY} (${DEMO_PROJECT_ID})`);
  console.log("  Walkthrough routes:");

  for (const route of buildDemoRouteGuide()) {
    console.log(`    ${route.label}: ${route.path}`);
  }
}

/**
 * Checks whether Node executed this file directly instead of importing helper exports.
 */
function isDirectRun(moduleUrl, argvPath) {
  return Boolean(argvPath) && fileURLToPath(moduleUrl) === resolve(argvPath);
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error("seed:demo-project failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
