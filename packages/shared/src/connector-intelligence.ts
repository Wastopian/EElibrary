/**
 * File header: Provides seed-free connector intelligence projection helpers.
 */

import type { AccessoryRequirement, BuildableMatingSet, CableCompatibility, MateRelation } from "./types";

/**
 * Builds a deterministic buildable mating set from typed connector relationship rows.
 */
export function buildBuildableMatingSet(
  partMateRelations: MateRelation[],
  partAccessories: AccessoryRequirement[],
  partCables: CableCompatibility[]
): BuildableMatingSet {
  const bestMates = partMateRelations.filter((relation) => relation.relationshipType === "best_mate");

  return {
    bestMate: sortRelationsByConfidence(bestMates)[0] ?? null,
    cableOptions: sortRelationsByConfidence(partCables),
    requiredAccessories: sortRelationsByConfidence(partAccessories.filter((requirement) => requirement.relationshipType === "requires_accessory")),
    toolingRequirements: sortRelationsByConfidence(partAccessories.filter((requirement) => requirement.relationshipType === "tooling_requirement"))
  };
}

/**
 * Sorts relationship-like objects by confidence and stable identifier.
 */
function sortRelationsByConfidence<TValue extends { confidenceScore: number; id: string }>(values: TValue[]): TValue[] {
  return [...values].sort((left, right) => right.confidenceScore - left.confidenceScore || left.id.localeCompare(right.id));
}
