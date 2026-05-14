/**
 * File header: Provides seed-free connector intelligence projection helpers.
 */

import type {
  AccessoryRequirement,
  BuildableMatingSet,
  CableCompatibility,
  ConnectorCableAssumption,
  ConnectorCableAssumptionType,
  ConnectorConfidenceBreakdown,
  ConnectorEvidenceKind,
  ConnectorFamilyConflict,
  ConnectorSetBuildabilityState,
  ConnectorSetIntentCandidate,
  ConnectorSetIntentInput,
  ConnectorSetIntentResolution,
  ConnectorSetResolvedPartSummary,
  ConnectorSetResolvedRelation,
  ConnectorRelationCompatibilityStatus,
  ConnectorWarning,
  PartSearchRecord,
  MateRelation
} from "./types";

/** Connector intent resolver boundary copy shown by API and UI callers. */
export const CONNECTOR_SET_INTENT_RESOLVER_BOUNDARY =
  "Connector intent resolution ranks stored connector relationships only. Confidence, warnings, and pending accessory coverage must stay visible until engineering review confirms the physical build.";

/**
 * Builds a deterministic buildable mating set from typed connector relationship rows.
 */
export function buildBuildableMatingSet(
  partMateRelations: MateRelation[],
  partAccessories: AccessoryRequirement[],
  partCables: CableCompatibility[],
  connectorFamilyConflicts: ConnectorFamilyConflict[] = []
): BuildableMatingSet {
  const bestMates = sortRelationsByConfidence(partMateRelations.filter((relation) => relation.relationshipType === "best_mate"));
  const alternateMates = sortRelationsByConfidence(partMateRelations.filter((relation) => relation.relationshipType === "alternate_mate"));
  const requiredAccessories = sortRelationsByConfidence(partAccessories.filter((requirement) => requirement.relationshipType === "requires_accessory"));
  const optionalAccessories = sortRelationsByConfidence(partAccessories.filter((requirement) => requirement.relationshipType === "optional_accessory"));
  const toolingRequirements = sortRelationsByConfidence(partAccessories.filter((requirement) => requirement.relationshipType === "tooling_requirement"));
  const cableOptions = sortRelationsByConfidence(partCables);
  const familyConflicts = sortRelationsByConfidence(connectorFamilyConflicts);
  const bestMate = bestMates[0] ?? null;
  const confidenceBreakdown = buildConfidenceBreakdown(bestMate, requiredAccessories, optionalAccessories, toolingRequirements, cableOptions);
  const cableAssumptions = buildCableAssumptions(cableOptions);
  const warningDetails = buildConnectorWarnings({
    alternateMates,
    bestMate,
    cableOptions,
    familyConflicts,
    optionalAccessories,
    requiredAccessories,
    toolingRequirements
  });
  const warnings = warningDetails.map((warning) => warning.summary);

  return {
    alternateMates,
    bestMate,
    cableAssumptions,
    cableOptions,
    confidenceBreakdown,
    confidenceScore: confidenceBreakdown.overallScore,
    familyConflicts,
    optionalAccessories,
    requiredAccessories,
    toolingRequirements,
    warningDetails,
    warnings
  };
}

/**
 * Resolves free-text or structured connector intent against already-normalized catalog records.
 */
export function resolveConnectorSetIntent(
  intent: ConnectorSetIntentInput,
  records: PartSearchRecord[]
): ConnectorSetIntentResolution {
  const normalizedIntent = normalizeConnectorSetIntent(intent);
  const partById = new Map(records.map((record) => [record.part.id, record]));
  const candidates = records
    .filter((record) => record.readinessSummary.connectorClass === "connector")
    .map((record) => buildConnectorIntentCandidate(record, partById, normalizedIntent))
    .filter((candidate): candidate is ConnectorSetIntentCandidate => candidate !== null)
    .sort((left, right) => right.confidenceScore - left.confidenceScore || left.connector.mpn.localeCompare(right.connector.mpn))
    .slice(0, 8);

  return {
    boundary: CONNECTOR_SET_INTENT_RESOLVER_BOUNDARY,
    candidates,
    intent: normalizedIntent,
    state: candidates.length > 0 ? "available" : "empty"
  };
}

/**
 * Parses one engineer-entered connector intent phrase into structured resolver fields.
 */
export function parseConnectorSetIntentText(text: string): ConnectorSetIntentInput | null {
  const normalizedText = text.trim();

  if (normalizedText.length === 0) {
    return null;
  }

  const cableGauge = readFirstIntegerMatch(normalizedText, /\b(\d{1,2})\s*(?:awg|ga|gauge)\b/iu);
  const pinCount =
    readFirstIntegerMatch(normalizedText, /\b(\d{1,3})\s*(?:pin|pins|pos|position|positions|ckt|circuit|circuits)\b/iu) ??
    readFirstIntegerMatch(normalizedText, /\b(\d{1,3})p\b/iu);
  const sealing = parseSealingIntent(normalizedText);
  const connectorClass = removeParsedIntentTerms(normalizedText);

  return {
    cableGauge,
    class: connectorClass.length > 0 ? connectorClass : normalizedText,
    pinCount,
    query: normalizedText,
    sealing
  };
}

/**
 * Normalizes optional resolver fields without inventing missing intent.
 */
function normalizeConnectorSetIntent(intent: ConnectorSetIntentInput): ConnectorSetIntentInput {
  const rawClass = intent.class.trim();
  const rawQuery = intent.query?.trim() ?? "";
  const parsedIntent = parseConnectorSetIntentText(rawQuery || rawClass);
  const explicitClass = rawQuery.length > 0 && rawClass === rawQuery && parsedIntent ? parsedIntent.class : rawClass;

  return {
    cableGauge: normalizeOptionalInteger(intent.cableGauge) ?? parsedIntent?.cableGauge ?? null,
    class: explicitClass.length > 0 ? explicitClass : parsedIntent?.class ?? rawClass,
    pinCount: normalizeOptionalInteger(intent.pinCount) ?? parsedIntent?.pinCount ?? null,
    query: rawQuery || parsedIntent?.query || null,
    sealing: intent.sealing?.trim() || parsedIntent?.sealing || null
  };
}

/**
 * Reads the first positive integer captured by a regular expression.
 */
function readFirstIntegerMatch(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  const value = match?.[1] ? Number(match[1]) : Number.NaN;

  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Extracts sealing intent while preserving uncertainty as plain text.
 */
function parseSealingIntent(text: string): string | null {
  const normalizedText = text.toLowerCase();

  if (/\b(?:unsealed|nonsealed|non-sealed)\b/u.test(normalizedText)) {
    return "unsealed";
  }

  const ipMatch = /\bip6[5789]k?\b/iu.exec(text);

  if (ipMatch) {
    return ipMatch[0].toUpperCase();
  }

  if (/\b(?:sealed|waterproof|weatherproof|environmental)\b/u.test(normalizedText)) {
    return "sealed";
  }

  return null;
}

/**
 * Removes constraint words from free text so matching focuses on the connector family or series.
 */
function removeParsedIntentTerms(text: string): string {
  return text
    .replace(/\b\d{1,2}\s*(?:awg|ga|gauge)\b/giu, " ")
    .replace(/\b\d{1,3}\s*(?:pin|pins|pos|position|positions|ckt|circuit|circuits)\b/giu, " ")
    .replace(/\b\d{1,3}p\b/giu, " ")
    .replace(/\b(?:sealed|unsealed|nonsealed|non-sealed|waterproof|weatherproof|environmental|ip6[5789]k?)\b/giu, " ")
    .replace(/\b(?:connector|connectors|housing|header|receptacle|mate|mating|set|buildable|cable|wire|wires|for|with|and)\b/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Builds one resolver candidate when the connector satisfies enough requested intent.
 */
function buildConnectorIntentCandidate(
  record: PartSearchRecord,
  partById: Map<string, PartSearchRecord>,
  intent: ConnectorSetIntentInput
): ConnectorSetIntentCandidate | null {
  const matchScore = scoreConnectorIntentMatch(record, intent);

  if (matchScore <= 0) {
    return null;
  }

  const buildableMatingSet = record.buildableMatingSet;
  const mate = buildableMatingSet.bestMate ? summarizeMateRelation(buildableMatingSet.bestMate, partById) : null;
  const requiredAccessories = buildableMatingSet.requiredAccessories.flatMap((relation) => summarizeAccessoryRelation(relation, partById));
  const optionalAccessories = buildableMatingSet.optionalAccessories.flatMap((relation) => summarizeAccessoryRelation(relation, partById));
  const tooling = buildableMatingSet.toolingRequirements.flatMap((relation) => summarizeAccessoryRelation(relation, partById));
  const cableOption = selectCableOption(buildableMatingSet.cableOptions, intent.cableGauge, partById);
  const familyConfusionWarnings = buildableMatingSet.warningDetails.filter((warning) => warning.code === "family_confusion" || warning.code === "near_match_alternates");
  const buildabilityState = resolveBuildabilityState({
    cableGauge: intent.cableGauge,
    cableOption,
    mate,
    requiredAccessoryCount: requiredAccessories.length,
    storedRequiredAccessoryCount: buildableMatingSet.requiredAccessories.length
  });
  const confidenceScore = combineIntentAndBuildabilityConfidence(matchScore, buildableMatingSet.confidenceScore, buildabilityState);

  return {
    buildabilityState,
    cableOption,
    confidenceScore,
    connector: summarizePartRecord(record),
    familyConfusionWarnings,
    mate,
    optionalAccessories,
    requiredAccessories,
    tooling,
    warnings: buildableMatingSet.warningDetails
  };
}

/**
 * Scores one connector against family, free-text, pin-count, sealing, and cable intent.
 */
function scoreConnectorIntentMatch(record: PartSearchRecord, intent: ConnectorSetIntentInput): number {
  const haystack = normalizeSearchText([
    record.part.mpn,
    record.part.description,
    record.manufacturer.name,
    record.package.packageName,
    record.connectorFamily?.name,
    record.connectorFamily?.series,
    record.connectorFamily?.description
  ]);
  const classScore = scoreTextNeedle(haystack, intent.class);
  const queryScore = intent.query ? scoreTextNeedle(haystack, intent.query) : 0;
  const pinScore = intent.pinCount === null || intent.pinCount === undefined
    ? 0
    : record.package.pinCount === intent.pinCount
      ? 0.22
      : -0.35;
  const sealingScore = intent.sealing ? scoreTextNeedle(haystack, intent.sealing) * 0.7 : 0;
  const cableScore = intent.cableGauge === null || intent.cableGauge === undefined
    ? 0
    : record.buildableMatingSet.cableOptions.some((option) => cableGaugeMatches(option, intent.cableGauge ?? null))
      ? 0.12
      : -0.08;
  const score = classScore + queryScore * 0.7 + pinScore + sealingScore + cableScore;

  return Math.max(0, Math.min(1, score));
}

/**
 * Creates searchable lowercase text from nullable identity fields.
 */
function normalizeSearchText(values: Array<string | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(" ").toLowerCase();
}

/**
 * Scores all terms in one user-provided phrase against a pre-normalized search string.
 */
function scoreTextNeedle(haystack: string, needle: string): number {
  const terms = needle.toLowerCase().split(/[^a-z0-9.]+/u).filter(Boolean);

  if (terms.length === 0) {
    return 0;
  }

  const matched = terms.filter((term) => haystack.includes(term)).length;

  return matched === 0 ? 0 : 0.18 + (matched / terms.length) * 0.42;
}

/**
 * Selects the best cable option that matches the requested AWG when provided.
 */
function selectCableOption(
  cableOptions: CableCompatibility[],
  cableGauge: number | null | undefined,
  partById: Map<string, PartSearchRecord>
): ConnectorSetResolvedRelation | null {
  const candidates = cableGauge === null || cableGauge === undefined
    ? cableOptions
    : cableOptions.filter((option) => cableGaugeMatches(option, cableGauge));
  const selected = sortRelationsByConfidence(candidates)[0];

  return selected ? summarizeCableRelation(selected, partById) : null;
}

/**
 * Checks whether a cable compatibility row can satisfy a requested AWG.
 */
function cableGaugeMatches(option: CableCompatibility, cableGauge: number | null): boolean {
  if (cableGauge === null) {
    return true;
  }

  const aboveMin = option.wireGaugeMin === null || cableGauge >= option.wireGaugeMin;
  const belowMax = option.wireGaugeMax === null || cableGauge <= option.wireGaugeMax;

  return aboveMin && belowMax && option.compatibilityStatus !== "rejected";
}

/**
 * Resolves candidate state while keeping missing accessory coverage visible as pending.
 */
function resolveBuildabilityState(input: {
  cableGauge: number | null | undefined;
  cableOption: ConnectorSetResolvedRelation | null;
  mate: ConnectorSetResolvedRelation | null;
  requiredAccessoryCount: number;
  storedRequiredAccessoryCount: number;
}): ConnectorSetBuildabilityState {
  if (!input.mate) {
    return "not_buildable";
  }

  if (input.storedRequiredAccessoryCount === 0 || input.requiredAccessoryCount !== input.storedRequiredAccessoryCount) {
    return "pending";
  }

  if (input.cableGauge !== null && input.cableGauge !== undefined && !input.cableOption) {
    return "pending";
  }

  return "buildable";
}

/**
 * Blends intent match and stored relationship confidence without letting missing coverage look complete.
 */
function combineIntentAndBuildabilityConfidence(
  matchScore: number,
  buildableConfidence: number | null,
  buildabilityState: ConnectorSetBuildabilityState
): number {
  const base = matchScore * 0.45 + (buildableConfidence ?? 0.35) * 0.55;
  const stateWeight = buildabilityState === "buildable" ? 1 : buildabilityState === "pending" ? 0.78 : 0.45;

  return Number(Math.max(0, Math.min(1, base * stateWeight)).toFixed(3));
}

/**
 * Summarizes one catalog record for resolver output.
 */
function summarizePartRecord(record: PartSearchRecord): ConnectorSetResolvedPartSummary {
  return {
    connectorClass: record.readinessSummary.connectorClass,
    connectorFamilyName: record.connectorFamily?.name ?? null,
    lifecycleStatus: record.part.lifecycleStatus,
    manufacturerName: record.manufacturer.name,
    mpn: record.part.mpn,
    packagePinCount: record.package.pinCount,
    partId: record.part.id
  };
}

/**
 * Summarizes a mate relation when the target part is present in the resolver source set.
 */
function summarizeMateRelation(
  relation: MateRelation,
  partById: Map<string, PartSearchRecord>
): ConnectorSetResolvedRelation | null {
  const part = partById.get(relation.matePartId);

  return part
    ? {
        compatibilityStatus: relation.compatibilityStatus,
        confidenceScore: getConnectorRelationEffectiveConfidence(relation),
        evidenceKind: relation.evidenceKind,
        notes: relation.notes,
        part: summarizePartRecord(part)
      }
    : null;
}

/**
 * Summarizes an accessory or tooling relation when the target part is present.
 */
function summarizeAccessoryRelation(
  relation: AccessoryRequirement,
  partById: Map<string, PartSearchRecord>
): ConnectorSetResolvedRelation[] {
  const part = partById.get(relation.accessoryPartId);

  return part
    ? [
        {
          compatibilityStatus: relation.compatibilityStatus,
          confidenceScore: getConnectorRelationEffectiveConfidence(relation),
          evidenceKind: relation.evidenceKind,
          notes: relation.notes,
          part: summarizePartRecord(part)
        }
      ]
    : [];
}

/**
 * Summarizes a cable compatibility relation when the target cable part is present.
 */
function summarizeCableRelation(
  relation: CableCompatibility,
  partById: Map<string, PartSearchRecord>
): ConnectorSetResolvedRelation | null {
  const part = partById.get(relation.cablePartId);

  return part
    ? {
        compatibilityStatus: relation.compatibilityStatus,
        confidenceScore: relation.confidenceScore,
        evidenceKind: "cable_compatibility",
        notes: relation.notes,
        part: summarizePartRecord(part)
      }
    : null;
}

/**
 * Normalizes optional numeric intent while dropping unsafe values.
 */
function normalizeOptionalInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

/**
 * Sorts relationship-like objects by effective confidence and stable identifier.
 */
function sortRelationsByConfidence<
  TValue extends {
    confidenceScore: number;
    id: string;
    compatibilityStatus?: ConnectorRelationCompatibilityStatus;
    evidenceKind?: ConnectorEvidenceKind;
  }
>(values: TValue[]): TValue[] {
  return [...values].sort((left, right) => {
    const effectiveDelta = getConnectorRelationEffectiveConfidence(right) - getConnectorRelationEffectiveConfidence(left);

    if (effectiveDelta !== 0) {
      return effectiveDelta;
    }

    return right.confidenceScore - left.confidenceScore || left.id.localeCompare(right.id);
  });
}

/**
 * Converts relation compatibility status into a conservative weighting factor.
 */
export function getConnectorCompatibilityStatusWeight(status: ConnectorRelationCompatibilityStatus | undefined): number {
  switch (status) {
    case undefined:
      return 1;
    case "verified":
      return 1;
    case "probable":
      return 0.92;
    case "uncertain":
      return 0.68;
    case "rejected":
      return 0.4;
  }
}

/**
 * Converts evidence kind into a weighting factor that prefers direct provider or reviewed evidence.
 */
export function getConnectorEvidenceKindWeight(kind: ConnectorEvidenceKind | undefined): number {
  switch (kind) {
    case undefined:
      return 1;
    case "manual_review":
      return 1;
    case "provider_direct":
      return 0.97;
    case "datasheet_reference":
      return 0.93;
    case "catalog_fixture":
      return 0.9;
    case "family_inference":
      return 0.72;
  }
}

/**
 * Calculates one effective confidence score without pretending inferred evidence is equal to direct evidence.
 */
export function getConnectorRelationEffectiveConfidence<
  TValue extends {
    confidenceScore: number;
    compatibilityStatus?: ConnectorRelationCompatibilityStatus;
    evidenceKind?: ConnectorEvidenceKind;
  }
>(value: TValue): number {
  const weightedScore = value.confidenceScore * getConnectorCompatibilityStatusWeight(value.compatibilityStatus) * getConnectorEvidenceKindWeight(value.evidenceKind);

  return Math.max(0, Math.min(1, weightedScore));
}

/**
 * Builds group-by-group confidence so detail and readiness surfaces can explain why the overall score exists.
 */
function buildConfidenceBreakdown(
  bestMate: MateRelation | null,
  requiredAccessories: AccessoryRequirement[],
  optionalAccessories: AccessoryRequirement[],
  toolingRequirements: AccessoryRequirement[],
  cableOptions: CableCompatibility[]
): ConnectorConfidenceBreakdown {
  const relationEvidence = [bestMate, ...requiredAccessories, ...optionalAccessories, ...toolingRequirements].filter(
    (value): value is MateRelation | AccessoryRequirement => Boolean(value)
  );
  const bestMateScore = bestMate ? getConnectorRelationEffectiveConfidence(bestMate) : null;
  const requiredAccessoryScore = averageEffectiveConfidence(requiredAccessories);
  const optionalAccessoryScore = averageEffectiveConfidence(optionalAccessories);
  const toolingScore = averageEffectiveConfidence(toolingRequirements);
  const cableScore = averageConfidence(cableOptions);
  const weightedScores = [
    { score: bestMateScore, weight: 0.45 },
    { score: requiredAccessoryScore, weight: 0.2 },
    { score: optionalAccessoryScore, weight: 0.05 },
    { score: toolingScore, weight: 0.15 },
    { score: cableScore, weight: 0.15 }
  ].filter((entry): entry is { score: number; weight: number } => entry.score !== null);
  const weightTotal = weightedScores.reduce((total, entry) => total + entry.weight, 0);
  const overallScore =
    weightTotal > 0 ? weightedScores.reduce((total, entry) => total + entry.score * entry.weight, 0) / weightTotal : null;

  return {
    bestMateScore,
    cableScore,
    directEvidenceCount: relationEvidence.filter((value) => value.evidenceKind !== "family_inference").length,
    evidenceCount:
      (bestMate ? 1 : 0) + requiredAccessories.length + optionalAccessories.length + toolingRequirements.length + cableOptions.length,
    inferredEvidenceCount: relationEvidence.filter((value) => value.evidenceKind === "family_inference").length,
    optionalAccessoryScore,
    overallScore,
    requiredAccessoryScore,
    toolingScore,
    uncertainEvidenceCount: relationEvidence.filter((value) => value.compatibilityStatus === "uncertain" || value.compatibilityStatus === "rejected").length,
    verifiedEvidenceCount: relationEvidence.filter((value) => value.compatibilityStatus === "verified").length
  };
}

/**
 * Builds structured connector warnings from the stored relationship coverage and confidence evidence.
 */
function buildConnectorWarnings(input: {
  alternateMates: MateRelation[];
  bestMate: MateRelation | null;
  cableOptions: CableCompatibility[];
  familyConflicts: ConnectorFamilyConflict[];
  optionalAccessories: AccessoryRequirement[];
  requiredAccessories: AccessoryRequirement[];
  toolingRequirements: AccessoryRequirement[];
}): ConnectorWarning[] {
  const warnings: ConnectorWarning[] = [];
  const bestMateEffectiveConfidence = input.bestMate ? getConnectorRelationEffectiveConfidence(input.bestMate) : null;
  const hasSupportRows =
    input.requiredAccessories.length > 0 ||
    input.optionalAccessories.length > 0 ||
    input.toolingRequirements.length > 0 ||
    input.cableOptions.length > 0;
  const persistedNearMatchConflicts = input.familyConflicts.filter((conflict) => conflict.conflictType === "near_match_variant");
  const persistedFamilyConflicts = input.familyConflicts.filter((conflict) => conflict.conflictType === "family_confusion");
  const nearMatchAlternates = input.bestMate
    ? input.alternateMates.filter((relation) => getConnectorRelationEffectiveConfidence(relation) >= Math.max(0.75, (bestMateEffectiveConfidence ?? 0) - 0.08))
    : [];
  const lowConfidenceRequiredAccessories = input.requiredAccessories.filter(isLowConfidenceConnectorRelation);
  const lowConfidenceTooling = input.toolingRequirements.filter(isLowConfidenceConnectorRelation);
  const lowConfidenceCables = input.cableOptions.filter(
    (option) => option.confidenceScore < 0.75 || option.compatibilityStatus === "uncertain" || option.compatibilityStatus === "rejected"
  );

  if (!input.bestMate && hasSupportRows) {
    warnings.push({
      code: "support_without_best_mate",
      detail: `${input.requiredAccessories.length} required accessories, ${input.optionalAccessories.length} optional accessories, ${input.toolingRequirements.length} tooling requirements, and ${input.cableOptions.length} cable options exist without a prioritized mating connector.`,
      summary: "Connector support rows exist, but no prioritized best mate is stored.",
      tone: "danger"
    });
  }

  if (input.bestMate && bestMateEffectiveConfidence !== null && bestMateEffectiveConfidence < 0.75) {
    warnings.push({
      code: "best_mate_low_confidence",
      detail: buildRelationReviewDetail("Best-mate", input.bestMate, bestMateEffectiveConfidence),
      summary: `Best mate confidence is ${Math.round(bestMateEffectiveConfidence * 100)}%, so compatibility still needs review.`,
      tone: "review"
    });
  }

  if (persistedNearMatchConflicts.length > 0) {
    warnings.push({
      code: "near_match_alternates",
      detail:
        persistedNearMatchConflicts[0]?.detail ??
        `${persistedNearMatchConflicts.length} near-match candidate ${pluralize("record", persistedNearMatchConflicts.length)} remain close enough to require connector review.`,
      summary: "High-confidence alternate mates still need family review.",
      tone: "review"
    });
  } else if (nearMatchAlternates.length > 0) {
    warnings.push({
      code: "near_match_alternates",
      detail: `${nearMatchAlternates.length} alternate ${pluralize("mate", nearMatchAlternates.length)} sit close to the prioritized mate confidence, so family and keying assumptions should be checked before freezing the BOM.`,
      summary: "High-confidence alternate mates still need family review.",
      tone: "review"
    });
  }

  if (persistedFamilyConflicts.length > 0) {
    warnings.push({
      code: "family_confusion",
      detail:
        persistedFamilyConflicts[0]?.detail ??
        `${persistedFamilyConflicts.length} connector family ${pluralize("conflict", persistedFamilyConflicts.length)} remain unresolved.`,
      summary: "Connector family confusion remains unresolved.",
      tone: "review"
    });
  }

  if (input.requiredAccessories.length === 0 && input.optionalAccessories.length === 0 && input.bestMate) {
    warnings.push({
      code: "missing_accessory_coverage",
      detail: "A prioritized mating connector exists, but no required or optional accessory mappings are stored alongside it yet.",
      summary: "No accessory coverage is stored alongside the current mate mapping.",
      tone: "review"
    });
  }

  if (lowConfidenceRequiredAccessories.length > 0) {
    warnings.push({
      code: "required_accessory_low_confidence",
      detail: buildAccessoryReviewDetail("Required accessory", lowConfidenceRequiredAccessories),
      summary: "Required accessory confidence is still below target.",
      tone: "review"
    });
  }

  if (lowConfidenceTooling.length > 0) {
    warnings.push({
      code: "tooling_low_confidence",
      detail: buildAccessoryReviewDetail("Tooling", lowConfidenceTooling),
      summary: "Tooling requirements still need confirmation.",
      tone: "review"
    });
  }

  if (input.cableOptions.length > 0 && !input.bestMate) {
    warnings.push({
      code: "cable_without_best_mate",
      detail: "Cable compatibility rows exist, but without a prioritized mate they should be treated only as directional hints.",
      summary: "Cable options exist without a prioritized mate mapping.",
      tone: "review"
    });
  }

  if (lowConfidenceCables.length > 0) {
    const rejectedCableCount = lowConfidenceCables.filter((option) => option.compatibilityStatus === "rejected").length;
    warnings.push({
      code: "cable_low_confidence",
      detail:
        rejectedCableCount > 0
          ? `${rejectedCableCount} cable ${pluralize("mapping", rejectedCableCount)} are explicitly rejected, and ${lowConfidenceCables.length} total cable ${pluralize("mapping", lowConfidenceCables.length)} still need review.`
          : `${lowConfidenceCables.length} cable ${pluralize("mapping", lowConfidenceCables.length)} remain below the 75% confidence threshold or are still marked uncertain.`,
      summary: "Cable compatibility confidence is still below target.",
      tone: "review"
    });
  }

  return warnings;
}

/**
 * Treats inferred or uncertain mate/accessory evidence as review-heavy even when the raw score looks high.
 */
function isLowConfidenceConnectorRelation(
  relation: MateRelation | AccessoryRequirement
): boolean {
  return (
    getConnectorRelationEffectiveConfidence(relation) < 0.75 ||
    relation.compatibilityStatus === "uncertain" ||
    relation.compatibilityStatus === "rejected" ||
    relation.evidenceKind === "family_inference"
  );
}

/**
 * Formats one concise mate-review detail without forcing the UI to understand evidence weights.
 */
function buildRelationReviewDetail(
  label: string,
  relation: MateRelation,
  effectiveConfidence: number
): string {
  return `${label} evidence is ${formatEvidenceKindLabel(relation.evidenceKind)} with ${formatCompatibilityStatusLabel(relation.compatibilityStatus)} status, leaving an effective confidence of ${Math.round(effectiveConfidence * 100)}% before pitch, keying, and family fit are treated as trustworthy.`;
}

/**
 * Formats one concise accessory-review detail that keeps inference-heavy mappings explicit.
 */
function buildAccessoryReviewDetail(
  label: string,
  relations: AccessoryRequirement[]
): string {
  const inferredCount = relations.filter((relation) => relation.evidenceKind === "family_inference").length;
  const uncertainCount = relations.filter((relation) => relation.compatibilityStatus === "uncertain" || relation.compatibilityStatus === "rejected").length;
  const detailParts = [`${relations.length} ${label.toLowerCase()} ${pluralize("mapping", relations.length)} remain below the review target.`];

  if (inferredCount > 0) {
    detailParts.push(`${inferredCount} ${pluralize("mapping", inferredCount)} rely on family inference instead of direct provider or reviewed evidence.`);
  }

  if (uncertainCount > 0) {
    detailParts.push(`${uncertainCount} ${pluralize("mapping", uncertainCount)} are still marked uncertain or rejected.`);
  }

  return detailParts.join(" ");
}

/**
 * Parses cable-note assumptions into structured connector context without claiming validation.
 */
function buildCableAssumptions(cableOptions: CableCompatibility[]): ConnectorCableAssumption[] {
  const assumptions: ConnectorCableAssumption[] = [];

  for (const cableOption of cableOptions) {
    const explicitAssumptions = buildStructuredCableAssumptions(cableOption);
    const explicitTypes = new Set(explicitAssumptions.map((assumption) => assumption.type));
    const noteAssumptions = buildParsedCableAssumptions(cableOption).filter(
      (assumption) => assumption.type === "environment" || !explicitTypes.has(assumption.type)
    );

    assumptions.push(...explicitAssumptions, ...noteAssumptions);
  }

  return dedupeCableAssumptions(assumptions);
}

/**
 * Builds structured cable assumptions from persisted constraint columns before falling back to note parsing.
 */
function buildStructuredCableAssumptions(cableOption: CableCompatibility): ConnectorCableAssumption[] {
  const sourceNote = cableOption.notes?.trim() ?? "Persisted cable compatibility fields.";
  const assumptions: ConnectorCableAssumption[] = [];

  if (cableOption.wireGaugeMin !== null || cableOption.wireGaugeMax !== null) {
    assumptions.push(
      createCableAssumption(
        cableOption.cablePartId,
        "wire_gauge",
        buildGaugeSummary(cableOption.wireGaugeMin, cableOption.wireGaugeMax),
        sourceNote
      )
    );
  }

  if (cableOption.shieldingRequirement !== "unknown") {
    assumptions.push(
      createCableAssumption(
        cableOption.cablePartId,
        "shielding",
        {
          either: "Cable compatibility accepts shielded or unshielded construction.",
          shielded: "Cable compatibility requires shielded cable construction.",
          unshielded: "Cable compatibility requires unshielded cable construction."
        }[cableOption.shieldingRequirement],
        sourceNote
      )
    );
  }

  if (cableOption.terminationStyle !== "unknown") {
    assumptions.push(
      createCableAssumption(
        cableOption.cablePartId,
        "termination_style",
        `Cable compatibility requires ${cableOption.terminationStyle.toUpperCase()}-style termination.`,
        sourceNote
      )
    );
  }

  return assumptions;
}

/**
 * Parses note text into cable assumptions only when stronger persisted fields are missing.
 */
function buildParsedCableAssumptions(cableOption: CableCompatibility): ConnectorCableAssumption[] {
  const note = cableOption.notes?.trim();

  if (!note) {
    return [];
  }

  const assumptions: ConnectorCableAssumption[] = [];
  const normalizedNote = note.toLowerCase();
  const gaugeMatch = note.match(/\b\d{1,2}(?:\s*[-/]\s*\d{1,2})?\s*awg\b/iu);

  if (gaugeMatch) {
    assumptions.push(createCableAssumption(cableOption.cablePartId, "wire_gauge", `Cable note mentions ${gaugeMatch[0]}.`, note));
  }

  if (normalizedNote.includes("shielded") || normalizedNote.includes("unshielded") || normalizedNote.includes("shielding")) {
    const shieldingSummary = normalizedNote.includes("unshielded")
      ? "Cable note assumes an unshielded cable construction."
      : normalizedNote.includes("shielded")
        ? "Cable note assumes a shielded cable construction."
        : "Cable note references shielding considerations.";
    assumptions.push(createCableAssumption(cableOption.cablePartId, "shielding", shieldingSummary, note));
  }

  if (
    normalizedNote.includes("idc") ||
    normalizedNote.includes("crimp") ||
    normalizedNote.includes("solder") ||
    normalizedNote.includes("termination")
  ) {
    assumptions.push(createCableAssumption(cableOption.cablePartId, "termination_style", "Cable note includes a termination-style assumption.", note));
  }

  if (
    normalizedNote.includes("prototype") ||
    normalizedNote.includes("production") ||
    normalizedNote.includes("vibration") ||
    normalizedNote.includes("harness")
  ) {
    assumptions.push(createCableAssumption(cableOption.cablePartId, "environment", "Cable note includes environment or use-case assumptions.", note));
  }

  return assumptions;
}

/**
 * Creates one typed cable assumption from a parsed note signal.
 */
function createCableAssumption(
  cablePartId: string,
  type: ConnectorCableAssumptionType,
  summary: string,
  sourceNote: string
): ConnectorCableAssumption {
  return {
    cablePartId,
    sourceNote,
    summary,
    type
  };
}

/**
 * Formats persisted AWG constraints into a short readable summary.
 */
function buildGaugeSummary(wireGaugeMin: number | null, wireGaugeMax: number | null): string {
  if (wireGaugeMin !== null && wireGaugeMax !== null && wireGaugeMin === wireGaugeMax) {
    return `Cable compatibility requires ${wireGaugeMin} AWG conductors.`;
  }

  if (wireGaugeMin !== null && wireGaugeMax !== null) {
    return `Cable compatibility supports ${wireGaugeMin}-${wireGaugeMax} AWG conductors.`;
  }

  if (wireGaugeMin !== null) {
    return `Cable compatibility requires at least ${wireGaugeMin} AWG conductors.`;
  }

  return `Cable compatibility supports conductors up to ${wireGaugeMax} AWG.`;
}

/**
 * Averages confidence across one relationship group while keeping empty groups explicit.
 */
function averageConfidence<TValue extends { confidenceScore: number }>(values: TValue[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total, value) => total + value.confidenceScore, 0) / values.length;
}

/**
 * Averages effective connector confidence across one relation group while keeping empty groups explicit.
 */
function averageEffectiveConfidence<TValue extends MateRelation | AccessoryRequirement>(values: TValue[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total, value) => total + getConnectorRelationEffectiveConfidence(value), 0) / values.length;
}

/**
 * Removes duplicate parsed cable assumptions while preserving stable display order.
 */
function dedupeCableAssumptions(assumptions: ConnectorCableAssumption[]): ConnectorCableAssumption[] {
  const seen = new Set<string>();

  return assumptions.filter((assumption) => {
    const key = `${assumption.cablePartId}:${assumption.type}:${assumption.summary}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

/**
 * Pluralizes short connector labels without introducing a formatting dependency.
 */
function pluralize(singular: string, count: number, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/**
 * Formats evidence kinds for concise engineer-facing copy.
 */
function formatEvidenceKindLabel(kind: ConnectorEvidenceKind): string {
  switch (kind) {
    case "provider_direct":
      return "direct provider-backed";
    case "datasheet_reference":
      return "datasheet-backed";
    case "family_inference":
      return "family-inferred";
    case "manual_review":
      return "review-confirmed";
    case "catalog_fixture":
      return "fixture-backed";
  }
}

/**
 * Formats compatibility status for concise engineer-facing copy.
 */
function formatCompatibilityStatusLabel(status: ConnectorRelationCompatibilityStatus): string {
  switch (status) {
    case "verified":
      return "verified";
    case "probable":
      return "probable";
    case "uncertain":
      return "uncertain";
    case "rejected":
      return "rejected";
  }
}
