/**
 * File header: Computes how a past circuit-block instantiation compares with the
 * current reusable circuit-block pattern.
 */

import type {
  BomLine,
  CircuitBlockInstantiationPatternDrift,
  CircuitBlockInstantiationPatternDriftItem,
  CircuitBlockPartRecord
} from "./types";

/** CircuitBlockInstantiationPatternDriftInput is the pure input needed to compare one reuse event. */
export interface CircuitBlockInstantiationPatternDriftInput {
  /** Current block part roles, with linked current part identity. */
  currentPartRoles: CircuitBlockPartRecord[];
  /** BOM lines still tied to the historical instantiation's generated BOM import. */
  instantiatedBomLines: BomLine[];
  /** Original instantiation scope: optional roles were included only when this is true. */
  includeOptional: boolean;
}

/**
 * Builds a review-oriented drift summary for one historical block instantiation.
 *
 * The result is intentionally a signal, not a gate: it never changes part approval,
 * validation, readiness, or export state. It only tells an engineer whether a project
 * that reused this block should be compared against the block as it exists today.
 */
export function buildCircuitBlockInstantiationPatternDrift({
  currentPartRoles,
  includeOptional,
  instantiatedBomLines
}: CircuitBlockInstantiationPatternDriftInput): CircuitBlockInstantiationPatternDrift {
  const expectedRoles = currentPartRoles
    .filter((record) => record.blockPart.isRequired || includeOptional)
    .sort(compareCurrentRoles);
  const linesByRoleId = groupInstantiatedLinesByRoleId(instantiatedBomLines);
  const items: CircuitBlockInstantiationPatternDriftItem[] = [];
  const expectedRoleIds = new Set(expectedRoles.map((record) => record.blockPart.id));

  for (const roleRecord of expectedRoles) {
    const roleLines = linesByRoleId.get(roleRecord.blockPart.id) ?? [];

    if (roleLines.length === 0) {
      items.push(buildMissingCurrentRoleItem(roleRecord));
      continue;
    }

    if (roleLines.length > 1) {
      items.push(buildDuplicateRoleItem(roleRecord, roleLines));
    }

    items.push(...compareExpectedRoleWithInstantiatedLine(roleRecord, roleLines[0]!));
  }

  for (const line of instantiatedBomLines) {
    const roleId = line.instantiatedFromCircuitBlockPartId;

    if (!roleId || !expectedRoleIds.has(roleId)) {
      const currentRole = roleId ? currentPartRoles.find((record) => record.blockPart.id === roleId) ?? null : null;
      items.push(buildExtraInstantiatedRoleItem(line, currentRole, includeOptional));
    }
  }

  const status = items.some((item) => item.severity === "drift")
    ? "drifted"
    : items.length > 0 ? "needs_review" : "matches_current_pattern";

  return {
    currentRoleCount: expectedRoles.length,
    instantiatedRoleCount: instantiatedBomLines.length,
    items,
    status
  };
}

/**
 * Groups generated BOM lines by the circuit-block part-role id saved on the line.
 */
function groupInstantiatedLinesByRoleId(lines: BomLine[]): Map<string, BomLine[]> {
  const byRoleId = new Map<string, BomLine[]>();

  for (const line of lines) {
    const roleId = line.instantiatedFromCircuitBlockPartId;

    if (!roleId) {
      continue;
    }

    byRoleId.set(roleId, [...(byRoleId.get(roleId) ?? []), line]);
  }

  return byRoleId;
}

/**
 * Compares current roles in the same stable order used by circuit-block detail reads.
 */
function compareCurrentRoles(left: CircuitBlockPartRecord, right: CircuitBlockPartRecord): number {
  if (left.blockPart.isRequired !== right.blockPart.isRequired) {
    return left.blockPart.isRequired ? -1 : 1;
  }

  return left.blockPart.role.localeCompare(right.blockPart.role) ||
    left.part.mpn.localeCompare(right.part.mpn) ||
    left.blockPart.id.localeCompare(right.blockPart.id);
}

/**
 * Compares one current expected role with the single generated BOM line for that role.
 */
function compareExpectedRoleWithInstantiatedLine(
  roleRecord: CircuitBlockPartRecord,
  line: BomLine
): CircuitBlockInstantiationPatternDriftItem[] {
  const items: CircuitBlockInstantiationPatternDriftItem[] = [];
  const payload = readInstantiatedRolePayload(line);

  if (line.matchStatus !== "matched" || line.matchedPartId === null) {
    items.push(buildRoleLineItem({
      detail: `${roleRecord.blockPart.role} is no longer a confirmed matched BOM line in the project.`,
      kind: "line_match_changed",
      line,
      roleRecord,
      severity: "drift"
    }));
  } else if (line.matchedPartId !== roleRecord.blockPart.partId) {
    items.push(buildRoleLineItem({
      detail: `${roleRecord.blockPart.role} now points at ${roleRecord.part.mpn}, but the project BOM line is matched to ${line.rawMpn ?? line.matchedPartId}.`,
      kind: "part_changed",
      line,
      roleRecord,
      severity: "drift"
    }));
  }

  if (!quantitiesMatch(roleRecord.blockPart.quantity, line.quantity)) {
    items.push(buildRoleLineItem({
      detail: `${roleRecord.blockPart.role} quantity is ${formatQuantity(roleRecord.blockPart.quantity)} in the current pattern and ${formatQuantity(line.quantity)} in this project BOM.`,
      kind: "quantity_changed",
      line,
      roleRecord,
      severity: "drift"
    }));
  }

  if (payload.role && payload.role !== roleRecord.blockPart.role) {
    items.push(buildRoleLineItem({
      detail: `Role label changed from ${payload.role} to ${roleRecord.blockPart.role}.`,
      kind: "role_label_changed",
      line,
      roleRecord,
      severity: "review"
    }));
  }

  if (payload.isRequired !== null && payload.isRequired !== roleRecord.blockPart.isRequired) {
    items.push(buildRoleLineItem({
      detail: `${roleRecord.blockPart.role} was ${payload.isRequired ? "required" : "optional"} when instantiated and is now ${roleRecord.blockPart.isRequired ? "required" : "optional"}.`,
      kind: "requirement_changed",
      line,
      roleRecord,
      severity: "review"
    }));
  }

  return items;
}

/**
 * Reads the original role label and requirement flag saved on generated BOM lines.
 */
function readInstantiatedRolePayload(line: BomLine): { isRequired: boolean | null; role: string | null } {
  const role = typeof line.rawRowPayload.circuitBlockPartRole === "string" ? line.rawRowPayload.circuitBlockPartRole : null;
  const isRequired = typeof line.rawRowPayload.isRequired === "boolean" ? line.rawRowPayload.isRequired : null;

  return { isRequired, role };
}

/**
 * Creates the item shown when the current pattern expects a role but the project no longer has it.
 */
function buildMissingCurrentRoleItem(roleRecord: CircuitBlockPartRecord): CircuitBlockInstantiationPatternDriftItem {
  return {
    currentCircuitBlockPartId: roleRecord.blockPart.id,
    currentPartId: roleRecord.blockPart.partId,
    currentPartMpn: roleRecord.part.mpn,
    detail: `${roleRecord.blockPart.role} (${roleRecord.part.mpn}) is in the current pattern but not in this project instantiation.`,
    instantiatedBomLineId: null,
    instantiatedPartId: null,
    instantiatedPartMpn: null,
    kind: "missing_current_role",
    role: roleRecord.blockPart.role,
    severity: "drift"
  };
}

/**
 * Creates the item shown when more than one generated BOM line points at the same role.
 */
function buildDuplicateRoleItem(
  roleRecord: CircuitBlockPartRecord,
  lines: BomLine[]
): CircuitBlockInstantiationPatternDriftItem {
  return {
    currentCircuitBlockPartId: roleRecord.blockPart.id,
    currentPartId: roleRecord.blockPart.partId,
    currentPartMpn: roleRecord.part.mpn,
    detail: `${roleRecord.blockPart.role} has ${lines.length} generated BOM lines in this project; the current pattern expects one line for this role.`,
    instantiatedBomLineId: lines[0]?.id ?? null,
    instantiatedPartId: lines[0]?.matchedPartId ?? null,
    instantiatedPartMpn: lines[0]?.rawMpn ?? null,
    kind: "duplicate_instantiated_role",
    role: roleRecord.blockPart.role,
    severity: "drift"
  };
}

/**
 * Creates the item shown when a generated BOM line no longer belongs to the current scope.
 */
function buildExtraInstantiatedRoleItem(
  line: BomLine,
  currentRole: CircuitBlockPartRecord | null,
  includeOptional: boolean
): CircuitBlockInstantiationPatternDriftItem {
  const payload = readInstantiatedRolePayload(line);
  const role = currentRole?.blockPart.role ?? payload.role ?? line.instantiatedFromCircuitBlockPartId ?? "Unknown role";
  const currentScopeDetail = currentRole
    ? `${role} is now optional, but this instantiation was created with optional roles ${includeOptional ? "included" : "excluded"}.`
    : `${role} no longer exists in the current circuit-block pattern.`;

  return {
    currentCircuitBlockPartId: currentRole?.blockPart.id ?? null,
    currentPartId: currentRole?.blockPart.partId ?? null,
    currentPartMpn: currentRole?.part.mpn ?? null,
    detail: `${currentScopeDetail} The project still has generated line ${line.rowNumber}.`,
    instantiatedBomLineId: line.id,
    instantiatedPartId: line.matchedPartId,
    instantiatedPartMpn: line.rawMpn,
    kind: "extra_instantiated_role",
    role,
    severity: currentRole ? "review" : "drift"
  };
}

/**
 * Creates a drift item for a difference that has both current-role and generated-line context.
 */
function buildRoleLineItem({
  detail,
  kind,
  line,
  roleRecord,
  severity
}: {
  detail: string;
  kind: CircuitBlockInstantiationPatternDriftItem["kind"];
  line: BomLine;
  roleRecord: CircuitBlockPartRecord;
  severity: CircuitBlockInstantiationPatternDriftItem["severity"];
}): CircuitBlockInstantiationPatternDriftItem {
  return {
    currentCircuitBlockPartId: roleRecord.blockPart.id,
    currentPartId: roleRecord.blockPart.partId,
    currentPartMpn: roleRecord.part.mpn,
    detail,
    instantiatedBomLineId: line.id,
    instantiatedPartId: line.matchedPartId,
    instantiatedPartMpn: line.rawMpn,
    kind,
    role: roleRecord.blockPart.role,
    severity
  };
}

/**
 * Compares nullable numeric quantities while treating null as its own meaningful value.
 */
function quantitiesMatch(currentQuantity: number | null, instantiatedQuantity: number | null): boolean {
  if (currentQuantity === null || instantiatedQuantity === null) {
    return currentQuantity === instantiatedQuantity;
  }

  return currentQuantity === instantiatedQuantity;
}

/**
 * Formats a nullable quantity for operator-facing drift copy.
 */
function formatQuantity(quantity: number | null): string {
  return quantity === null ? "unspecified" : String(quantity);
}
