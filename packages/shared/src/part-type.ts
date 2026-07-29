/**
 * File header: Derives a coarse part type from free-text category so parameters can be normalized per type.
 *
 * `parts.category` is unbounded free text (whatever a provider emits). This classifier maps it to a small
 * closed `PartType` union the parameter registry keys off, exactly the way `resolveConnectorClass` derives
 * a connector class from the same text. It is intentionally conservative: anything it cannot confidently
 * type falls through to `"other"`, which still gets a generic parameter set.
 */

import { resolveConnectorClass } from "./part-readiness";
import type { Part } from "./types";

/** PartType is the closed set of part categories the parameter registry understands. */
export type PartType = "resistor" | "capacitor" | "inductor" | "diode" | "mcu" | "regulator" | "connector" | "other";

/**
 * Resolves a coarse part type from category text, delegating connector detection to the shared classifier.
 */
export function resolvePartType(part: Pick<Part, "category" | "connectorFamilyId">): PartType {
  // Keep connector detection in one place; connector accessories/tooling/cable are not parametric design
  // parts, so they fall through to "other" rather than getting a bespoke type here.
  if (resolveConnectorClass(part) === "connector") {
    return "connector";
  }

  const category = part.category.trim().toLowerCase();

  if (category.includes("resistor")) {
    return "resistor";
  }

  if (category.includes("capacitor")) {
    return "capacitor";
  }

  if (category.includes("inductor") || category.includes("coil") || category.includes("ferrite bead")) {
    return "inductor";
  }

  if (category.includes("diode") || category.includes("rectifier")) {
    return "diode";
  }

  if (category.includes("regulator") || category.includes("power management")) {
    return "regulator";
  }

  if (category.includes("microcontroller") || category.includes("mcu")) {
    return "mcu";
  }

  return "other";
}
