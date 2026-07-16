/**
 * File header: Implements a worker-only Mouser adapter using the free API-key Search API.
 */

import { normalizeLifecycleStatus } from "@ee-library/shared/normalization";
import type { MetricUnit } from "@ee-library/shared/types";
import type { NormalizedProviderPart, ProviderAdapter, ProviderPartRequest, RawProviderPayload } from "../provider-adapters";
import { buildExactLookupCandidate } from "../provider-lookup-candidate";
import {
  assembleNormalizedPart,
  normalizeComparableText,
  normalizeOptionalText,
  readNullableInteger,
  readPositiveInteger,
  readPositiveNumber,
  readRequiredText,
  type NeutralSpec,
  type NeutralSpecification,
  type NeutralSupplyOffering
} from "./distributor-normalize";

/** MOUSER_PROVIDER_ID is the canonical adapter id for Mouser intake. */
const MOUSER_PROVIDER_ID = "mouser";

/** DEFAULT_MOUSER_API_BASE_URL is the official Mouser production API host. */
const DEFAULT_MOUSER_API_BASE_URL = "https://api.mouser.com";

/** SPEC_HINTS maps canonical metric keys to Mouser attribute name hints. */
const SPEC_HINTS: ReadonlyArray<{ metricKey: string; unit: MetricUnit; hints: string[] }> = [
  { hints: ["resistance"], metricKey: "resistance", unit: "ohm" },
  { hints: ["capacitance"], metricKey: "capacitance", unit: "F" },
  { hints: ["inductance"], metricKey: "inductance", unit: "H" },
  { hints: ["voltage rating", "voltage - rated", "supply voltage", "operating voltage"], metricKey: "voltage_rating", unit: "V" },
  { hints: ["current rating", "current - output", "operating current"], metricKey: "current_rating", unit: "A" },
  { hints: ["frequency"], metricKey: "frequency", unit: "Hz" }
];

/** MouserProviderConfig carries runtime credentials and endpoint overrides. */
interface MouserProviderConfig {
  /** Mouser Search API key. */
  apiKey: string | null;
  /** API base URL override used by tests. */
  apiBaseUrl: string;
}

/** MouserRawPayload preserves the selected part and the request context. */
interface MouserRawPayload {
  /** Request shape that produced this payload. */
  request: { mpn: string | null; manufacturerName: string | null };
  /** Selected Mouser part payload. */
  part: MouserPart;
}

/** MouserPart is the permissive raw part shape read by the adapter. */
interface MouserPart {
  ManufacturerPartNumber?: string | null;
  Manufacturer?: string | null;
  Description?: string | null;
  DataSheetUrl?: string | null;
  ProductDetailUrl?: string | null;
  Category?: string | null;
  LifecycleStatus?: string | null;
  ROHSStatus?: string | null;
  UnitWeightKg?: string | number | null;
  SuggestedReplacement?: string | null;
  FactoryStock?: string | number | null;
  AvailabilityInStock?: string | number | null;
  Min?: string | number | null;
  Mult?: string | number | null;
  LeadTime?: string | null;
  MouserPartNumber?: string | null;
  PriceBreaks?: Array<{ Quantity?: number | string | null; Price?: string | number | null; Currency?: string | null }> | null;
  ProductAttributes?: Array<{ AttributeName?: string | null; AttributeValue?: string | null }> | null;
  ProductCompliance?: Array<{ ComplianceName?: string | null; ComplianceValue?: string | null }> | null;
}

/** mouserProviderAdapter fetches and normalizes Mouser part metadata. */
export const mouserProviderAdapter: ProviderAdapter = {
  async findExactPartCandidates(request) {
    if (!hasConfiguredMouserCredentials()) {
      return [];
    }

    try {
      const rawPayload = await fetchMouserRawPart({
        ...(request.manufacturerName ? { manufacturerName: request.manufacturerName } : {}),
        mpn: request.query
      });

      return [buildExactLookupCandidate(normalizeRawPart(rawPayload), request.query)];
    } catch (error) {
      if (isMouserNotFoundError(error) || isMouserCredentialError(error)) {
        return [];
      }

      throw error;
    }
  },
  async fetchRawPart(request) {
    return fetchMouserRawPart(request);
  },
  id: MOUSER_PROVIDER_ID,
  async listAvailablePartRequests() {
    return [];
  },
  name: "Mouser Search API",
  normalizeRawPart
};

/**
 * Fetches one raw Mouser part by exact MPN.
 */
async function fetchMouserRawPart(request: ProviderPartRequest): Promise<RawProviderPayload> {
  const mpn = normalizeOptionalText(request.mpn) ?? normalizeOptionalText(request.providerPartId);

  if (!mpn) {
    throw new Error("Mouser metadata record not found for unknown lookup");
  }

  const config = readMouserProviderConfig();

  if (!config.apiKey) {
    throw new Error("Mouser credentials are not configured. Set MOUSER_API_KEY.");
  }

  const response = await fetch(`${config.apiBaseUrl}/api/v1/search/partnumber?apiKey=${encodeURIComponent(config.apiKey)}`, {
    body: JSON.stringify({ SearchByPartRequest: { mouserPartNumber: mpn, partSearchOptions: "1" } }),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch Mouser response (${response.status})`);
  }

  const envelope = await response.json() as { Errors?: Array<{ Message?: string | null }> | null; SearchResults?: { Parts?: MouserPart[] | null } | null };
  const errors = Array.isArray(envelope.Errors) ? envelope.Errors.map((entry) => normalizeOptionalText(entry.Message)).filter((message): message is string => message !== null) : [];

  if (errors.length > 0) {
    throw new Error(`Mouser API returned errors: ${errors.slice(0, 3).join("; ")}`);
  }

  const parts = Array.isArray(envelope.SearchResults?.Parts) ? envelope.SearchResults.Parts : [];
  const part = selectExactPart(parts, mpn, request.manufacturerName);

  if (!part) {
    throw new Error(`Mouser metadata record not found for ${mpn}`);
  }

  return {
    fetchedAt: new Date().toISOString(),
    payload: {
      part,
      request: { manufacturerName: request.manufacturerName ?? null, mpn }
    } satisfies MouserRawPayload,
    providerId: MOUSER_PROVIDER_ID
  };
}

/**
 * Selects the exact MPN part, using a manufacturer hint only to disambiguate.
 */
function selectExactPart(parts: MouserPart[], mpn: string, manufacturerName: string | undefined): MouserPart | null {
  const exact = parts.filter((part) => normalizeComparableText(part.ManufacturerPartNumber) === normalizeComparableText(mpn));
  const hint = normalizeComparableText(manufacturerName);
  const byManufacturer = hint ? exact.find((part) => normalizeComparableText(part.Manufacturer).includes(hint)) : undefined;

  return byManufacturer ?? exact[0] ?? null;
}

/**
 * Reads provider config from environment variables.
 */
function readMouserProviderConfig(): MouserProviderConfig {
  return {
    apiBaseUrl: (normalizeOptionalText(process.env.MOUSER_API_BASE_URL) ?? DEFAULT_MOUSER_API_BASE_URL).replace(/\/+$/u, ""),
    apiKey: normalizeOptionalText(process.env.MOUSER_API_KEY)
  };
}

/**
 * Reports whether a Mouser API key is configured so optional lookup can skip cleanly.
 */
function hasConfiguredMouserCredentials(): boolean {
  return Boolean(readMouserProviderConfig().apiKey);
}

/**
 * Normalizes one raw Mouser payload into provider-neutral canonical records.
 */
function normalizeRawPart(rawPayload: RawProviderPayload): NormalizedProviderPart {
  if (rawPayload.providerId !== MOUSER_PROVIDER_ID) {
    throw new Error(`Unexpected Mouser provider id: ${rawPayload.providerId}`);
  }

  const payload = rawPayload.payload as Partial<MouserRawPayload> | null;

  if (!payload || typeof payload !== "object" || !payload.part || typeof payload.part !== "object") {
    throw new Error("Invalid Mouser raw payload");
  }

  const part = payload.part;
  const mpn = readRequiredText(part.ManufacturerPartNumber, "part.ManufacturerPartNumber");
  const manufacturerName = readRequiredText(part.Manufacturer, "part.Manufacturer");
  const packageName = readPackageName(part);
  const descriptionSpecs = readDescriptionSpecs(part);

  return assembleNormalizedPart({
    category: normalizeOptionalText(part.Category) ?? "Unknown",
    datasheetUrl: normalizeOptionalText(part.DataSheetUrl),
    description: normalizeOptionalText(part.Description) ?? `${manufacturerName} ${mpn}`,
    fetchedAt: rawPayload.fetchedAt,
    lifecycleStatus: normalizeLifecycleStatus(normalizeOptionalText(part.LifecycleStatus)),
    manufacturerName,
    manufacturerWebsite: null,
    metrics: mergeMetricCandidates(readMetricCandidates(part), descriptionSpecs.metrics),
    mpn,
    packageName,
    pinCount: null,
    providerId: MOUSER_PROVIDER_ID,
    providerPartKey: normalizeOptionalText(part.MouserPartNumber) ?? `${manufacturerName}:${mpn}`,
    rawPayload: payload,
    sourceUrl: normalizeOptionalText(part.ProductDetailUrl) ?? `https://www.mouser.com/c/?q=${encodeURIComponent(mpn)}`,
    specifications: buildSpecifications(part, descriptionSpecs.specifications),
    supplyOfferings: buildSupplyOfferings(part),
    trustScore: 0.66
  });
}

/**
 * Merges attribute-derived metrics with description-parsed metrics, keeping attribute values when
 * both sources report the same metric key (structured attributes are more reliable than free text).
 */
function mergeMetricCandidates(attributeMetrics: NeutralSpec[], descriptionMetrics: NeutralSpec[]): NeutralSpec[] {
  const seenKeys = new Set(attributeMetrics.map((metric) => metric.metricKey));

  return [...attributeMetrics, ...descriptionMetrics.filter((metric) => !seenKeys.has(metric.metricKey))];
}

/**
 * Builds verbatim specification rows from Mouser attributes and commercial/compliance fields.
 *
 * Mouser's Search API returns only packaging attributes for many passives; the electrical specs
 * live in the description string and are added by the caller via descriptionSpecs.
 */
function buildSpecifications(part: MouserPart, descriptionSpecs: NeutralSpecification[]): NeutralSpecification[] {
  const attributes = Array.isArray(part.ProductAttributes) ? part.ProductAttributes : [];
  const parametric = attributes.flatMap<NeutralSpecification>((attribute) => {
    const specKey = normalizeOptionalText(attribute.AttributeName);
    const specValue = normalizeOptionalText(attribute.AttributeValue);

    return specKey && specValue ? [{ specGroup: "parametric", specKey, specValue }] : [];
  });

  const compliance = Array.isArray(part.ProductCompliance) ? part.ProductCompliance : [];
  const complianceRows = compliance.flatMap<NeutralSpecification>((entry) => {
    const specKey = normalizeOptionalText(entry.ComplianceName);
    const specValue = normalizeOptionalText(entry.ComplianceValue);

    return specKey && specValue ? [{ specGroup: "compliance", specKey, specValue }] : [];
  });

  const extras: NeutralSpecification[] = [
    buildSpecRow("RoHS Status", part.ROHSStatus, "compliance"),
    buildSpecRow("Lifecycle Status", part.LifecycleStatus, "commercial"),
    buildSpecRow("Suggested Replacement", part.SuggestedReplacement, "commercial"),
    buildSpecRow("Factory Stock", part.FactoryStock, "commercial"),
    buildSpecRow("Unit Weight (kg)", part.UnitWeightKg, "physical")
  ].flatMap((row) => (row ? [row] : []));

  return [...parametric, ...descriptionSpecs, ...extras, ...complianceRows];
}

/**
 * Builds one verbatim spec row when the provider value is present.
 */
function buildSpecRow(specKey: string, value: string | number | null | undefined, specGroup: NeutralSpecification["specGroup"]): NeutralSpecification | null {
  const specValue = normalizeOptionalText(typeof value === "number" ? String(value) : value);

  return specValue ? { specGroup, specKey, specValue } : null;
}

/**
 * Reads the best package label from Mouser product attributes.
 */
function readPackageName(part: MouserPart): string {
  const attributes = Array.isArray(part.ProductAttributes) ? part.ProductAttributes : [];
  const attribute = attributes.find((entry) => {
    const name = normalizeComparableText(entry.AttributeName);

    return name.includes("package") || name.includes("case");
  });

  return normalizeOptionalText(attribute?.AttributeValue) ?? "Unknown package";
}

/**
 * Reads structured metric candidates from Mouser product attributes.
 */
function readMetricCandidates(part: MouserPart): NeutralSpec[] {
  const attributes = Array.isArray(part.ProductAttributes) ? part.ProductAttributes : [];

  return SPEC_HINTS.flatMap((spec) => {
    const attribute = attributes.find((entry) => {
      const name = normalizeComparableText(entry.AttributeName);

      return spec.hints.some((hint) => name.includes(hint));
    });
    const rawValue = normalizeOptionalText(attribute?.AttributeValue);

    return rawValue ? [{ metricKey: spec.metricKey, rawValue, unit: spec.unit }] : [];
  });
}

/** PASSIVE_VALUE_METRICS maps a passive category keyword to its primary electrical metric. */
const PASSIVE_VALUE_METRICS: ReadonlyArray<{ categoryHint: RegExp; metricKey: string; unit: MetricUnit; valuePattern: RegExp }> = [
  { categoryHint: /resistor/iu, metricKey: "resistance", unit: "ohm", valuePattern: /(\d+(?:\.\d+)?\s?[kKmM]?\s?[oO]hms?)/u },
  { categoryHint: /capacitor/iu, metricKey: "capacitance", unit: "F", valuePattern: /(\d+(?:\.\d+)?\s?[pnuµmμ]?F)\b/u },
  { categoryHint: /inductor/iu, metricKey: "inductance", unit: "H", valuePattern: /(\d+(?:\.\d+)?\s?[pnuµmμ]?H)\b/u }
];

/**
 * Parses passive electrical specs out of Mouser's description string.
 *
 * Mouser's Search API often reports only packaging attributes for passives, leaving the electrical
 * value, tolerance, and power rating buried in the free-text description (for example
 * "...Chip Resistor 0603, 10kOhms, 1%, 1/10W"). This runs only for resistor/capacitor/inductor
 * categories and stays conservative: one value metric matched to the category, plus tolerance and
 * power-rating spec rows. It never guesses temperature coefficients, voltages, or other fields.
 *
 * MCU and regulator categories get the same treatment for the handful of specs Mouser reliably puts
 * in their descriptions ("64 Kbytes of Flash 8 Kbytes RAM, 64 MHz CPU"; "200mA nanopower-IQ ( 25 nA)"):
 * verbatim fragments become parametric spec rows the shared registry parses into typed parameters.
 * Nothing is emitted for categories whose descriptions carry no numbers (e.g. small-signal diodes).
 */
function readDescriptionSpecs(part: MouserPart): { metrics: NeutralSpec[]; specifications: NeutralSpecification[] } {
  const category = normalizeOptionalText(part.Category);
  const description = normalizeOptionalText(part.Description);

  if (!category || !description) {
    return { metrics: [], specifications: [] };
  }

  if (/microcontroller|mcu/iu.test(category)) {
    return { metrics: [], specifications: readMcuDescriptionSpecs(description) };
  }

  if (/regulator/iu.test(category)) {
    return { metrics: [], specifications: readRegulatorDescriptionSpecs(description) };
  }

  const valueMetric = PASSIVE_VALUE_METRICS.find((entry) => entry.categoryHint.test(category));

  if (!valueMetric) {
    return { metrics: [], specifications: [] };
  }

  const metrics: NeutralSpec[] = [];
  const valueMatch = description.match(valueMetric.valuePattern);

  if (valueMatch?.[1]) {
    metrics.push({ metricKey: valueMetric.metricKey, rawValue: valueMatch[1], unit: valueMetric.unit });
  }

  const specifications: NeutralSpecification[] = [];
  const toleranceMatch = description.match(/±\s?\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?%/u);

  if (toleranceMatch?.[0]) {
    specifications.push({ specGroup: "parametric", specKey: "Tolerance", specValue: normalizeOptionalText(toleranceMatch[0]) ?? toleranceMatch[0] });
  }

  const powerMatch = description.match(/\b\d+\/\d+\s?W\b|\b\d+(?:\.\d+)?\s?W\b/u);

  if (powerMatch?.[0]) {
    specifications.push({ specGroup: "parametric", specKey: "Power Rating", specValue: normalizeOptionalText(powerMatch[0]) ?? powerMatch[0] });
  }

  return { metrics, specifications };
}

/**
 * Reads flash size, RAM size, and clock frequency from an MCU description ("Mainstream Arm Cortex-M0+
 * MCU 64 Kbytes of Flash 8 Kbytes RAM, 64 MHz CPU"). Each value must appear with its unit and its
 * anchor word (Flash / RAM / a frequency unit), so nothing is guessed from bare numbers.
 */
function readMcuDescriptionSpecs(description: string): NeutralSpecification[] {
  const specifications: NeutralSpecification[] = [];
  const flashMatch = description.match(/(\d+(?:\.\d+)?\s*[kmg]?(?:b|bytes?))\s*(?:of\s+)?flash/iu) ?? description.match(/flash\s*[:=]?\s*(\d+(?:\.\d+)?\s*[kmg]?(?:b|bytes?))\b/iu);

  if (flashMatch?.[1]) {
    specifications.push({ specGroup: "parametric", specKey: "Flash Size", specValue: flashMatch[1].trim() });
  }

  const ramMatch = description.match(/(\d+(?:\.\d+)?\s*[kmg]?(?:b|bytes?))\s*(?:of\s+)?s?ram/iu);

  if (ramMatch?.[1]) {
    specifications.push({ specGroup: "parametric", specKey: "RAM Size", specValue: ramMatch[1].trim() });
  }

  const clockMatch = description.match(/(\d+(?:\.\d+)?\s*[kmg]hz)\b/iu);

  if (clockMatch?.[1]) {
    specifications.push({ specGroup: "parametric", specKey: "Clock Frequency", specValue: clockMatch[1].trim() });
  }

  return specifications;
}

/**
 * Reads output current and quiescent current from a regulator description ("200mA nanopower-IQ
 * ( 25 nA) low-dropout"). The milli/whole-amp value is the output rating; a nano/micro-amp value is
 * only read as quiescent current when the description says so (IQ / quiescent / nanopower). Output
 * voltage is deliberately never guessed — fixed-output parts encode it in the MPN, not the text.
 */
function readRegulatorDescriptionSpecs(description: string): NeutralSpecification[] {
  const specifications: NeutralSpecification[] = [];
  const outputMatch = description.match(/(\d+(?:\.\d+)?\s*m?A)\b/u);

  if (outputMatch?.[1]) {
    specifications.push({ specGroup: "parametric", specKey: "Output Current", specValue: outputMatch[1].trim() });
  }

  if (/iq|quiescent|nanopower/iu.test(description)) {
    const quiescentMatch = description.match(/(\d+(?:\.\d+)?\s*[nuµμ]A)\b/u);

    if (quiescentMatch?.[1]) {
      specifications.push({ specGroup: "parametric", specKey: "Quiescent Current", specValue: quiescentMatch[1].trim() });
    }
  }

  return specifications;
}

/**
 * Builds one Mouser commercial snapshot when any useful commercial signal exists.
 */
function buildSupplyOfferings(part: MouserPart): NeutralSupplyOffering[] {
  const priceBreaks = (Array.isArray(part.PriceBreaks) ? part.PriceBreaks : []).flatMap((tier) => {
    const minQuantity = readPositiveInteger(tier.Quantity);
    const unitPrice = readPositiveNumber(tier.Price);

    return minQuantity !== null && unitPrice !== null
      ? [{ currencyCode: normalizeOptionalText(tier.Currency) ?? "USD", minQuantity, unitPrice }]
      : [];
  });
  const inventoryQuantity = readNullableInteger(part.AvailabilityInStock);

  if (priceBreaks.length === 0 && inventoryQuantity === null) {
    return [];
  }

  return [
    {
      inventoryQuantity,
      leadTimeDays: readLeadTimeDays(part.LeadTime),
      moq: readPositiveInteger(part.Min),
      packaging: null,
      preferredRank: 1,
      priceBreaks,
      providerSku: normalizeOptionalText(part.MouserPartNumber),
      supplierName: "Mouser"
    }
  ];
}

/**
 * Parses a Mouser lead-time string such as "28 Days" into a day count.
 */
function readLeadTimeDays(value: string | null | undefined): number | null {
  const text = normalizeOptionalText(value);

  if (!text) {
    return null;
  }

  return readPositiveInteger(text.match(/\d+/u)?.[0] ?? null);
}

/**
 * Returns whether an error represents a normal no-match provider outcome.
 */
function isMouserNotFoundError(error: unknown): boolean {
  return error instanceof Error && /Mouser metadata record not found/u.test(error.message);
}

/**
 * Returns whether an error means the Mouser API key is absent for optional lookup.
 */
function isMouserCredentialError(error: unknown): boolean {
  return error instanceof Error && /Mouser credentials are not configured/u.test(error.message);
}
