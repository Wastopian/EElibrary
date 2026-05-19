/**
 * File header: Implements a worker-only DigiKey adapter using the free OAuth2 Product Information API.
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
  type NeutralSupplyOffering
} from "./distributor-normalize";

/** DIGIKEY_PROVIDER_ID is the canonical adapter id for DigiKey intake. */
const DIGIKEY_PROVIDER_ID = "digikey";

/** DEFAULT_DIGIKEY_API_BASE_URL is the official DigiKey production API host. */
const DEFAULT_DIGIKEY_API_BASE_URL = "https://api.digikey.com";

/** DIGIKEY_KEYWORD_LIMIT keeps exact MPN lookup bounded and deterministic. */
const DIGIKEY_KEYWORD_LIMIT = 5;

/** ACCESS_TOKEN_CACHE_SKEW_MS refreshes cached tokens before the provider rejects them. */
const ACCESS_TOKEN_CACHE_SKEW_MS = 60_000;

/** SPEC_HINTS maps canonical metric keys to DigiKey parameter name hints. */
const SPEC_HINTS: ReadonlyArray<{ metricKey: string; unit: MetricUnit; hints: string[] }> = [
  { hints: ["resistance"], metricKey: "resistance", unit: "ohm" },
  { hints: ["capacitance"], metricKey: "capacitance", unit: "F" },
  { hints: ["inductance"], metricKey: "inductance", unit: "H" },
  { hints: ["voltage rating", "voltage - rated", "voltage - output", "supply voltage", "operating voltage"], metricKey: "voltage_rating", unit: "V" },
  { hints: ["current rating", "current - output", "current - supply", "operating current"], metricKey: "current_rating", unit: "A" },
  { hints: ["frequency"], metricKey: "frequency", unit: "Hz" }
];

/** CachedDigiKeyToken keeps one short-lived access token between provider calls. */
interface CachedDigiKeyToken {
  /** Bearer token returned by the DigiKey identity service. */
  accessToken: string;
  /** Epoch milliseconds after which the token should not be reused. */
  expiresAtMs: number;
}

/** DigiKeyProviderConfig carries runtime credentials and endpoint overrides. */
interface DigiKeyProviderConfig {
  /** OAuth client id from the DigiKey developer portal. */
  clientId: string | null;
  /** OAuth client secret from the DigiKey developer portal. */
  clientSecret: string | null;
  /** API base URL override used by tests or sandbox runs. */
  apiBaseUrl: string;
}

/** DigiKeyRawPayload preserves the selected product and the request context. */
interface DigiKeyRawPayload {
  /** Request shape that produced this payload. */
  request: { mpn: string | null; manufacturerName: string | null };
  /** Selected DigiKey product payload. */
  product: DigiKeyProduct;
}

/** DigiKeyProduct is the permissive raw product shape read by the adapter. */
interface DigiKeyProduct {
  ManufacturerProductNumber?: string | null;
  Manufacturer?: { Name?: string | null } | null;
  Description?: { ProductDescription?: string | null; DetailedDescription?: string | null } | null;
  DatasheetUrl?: string | null;
  ProductUrl?: string | null;
  Category?: { Name?: string | null } | null;
  ProductStatus?: { Status?: string | null } | null;
  QuantityAvailable?: number | string | null;
  Parameters?: Array<{ ParameterText?: string | null; ValueText?: string | null }> | null;
  ProductVariations?: DigiKeyProductVariation[] | null;
}

/** DigiKeyProductVariation is one packaging variation with pricing. */
interface DigiKeyProductVariation {
  DigiKeyProductNumber?: string | null;
  PackageType?: { Name?: string | null } | null;
  MinimumOrderQuantity?: number | string | null;
  QuantityAvailableforPackageType?: number | string | null;
  StandardPricing?: Array<{ BreakQuantity?: number | string | null; UnitPrice?: number | string | null }> | null;
}

/** cachedDigiKeyToken stores one token for the current process. */
let cachedDigiKeyToken: CachedDigiKeyToken | null = null;

/** digikeyProviderAdapter fetches and normalizes DigiKey product metadata. */
export const digikeyProviderAdapter: ProviderAdapter = {
  async findExactPartCandidates(request) {
    if (!hasConfiguredDigiKeyCredentials()) {
      return [];
    }

    try {
      const rawPayload = await fetchDigiKeyRawPart({
        ...(request.manufacturerName ? { manufacturerName: request.manufacturerName } : {}),
        mpn: request.query
      });

      return [buildExactLookupCandidate(normalizeRawPart(rawPayload), request.query)];
    } catch (error) {
      if (isDigiKeyNotFoundError(error) || isDigiKeyCredentialError(error)) {
        return [];
      }

      throw error;
    }
  },
  async fetchRawPart(request) {
    return fetchDigiKeyRawPart(request);
  },
  id: DIGIKEY_PROVIDER_ID,
  async listAvailablePartRequests() {
    return [];
  },
  name: "DigiKey Product Information API",
  normalizeRawPart
};

/**
 * Clears the cached access token so focused tests can change credentials safely.
 */
export function resetDigiKeyProviderAuthCacheForTests(): void {
  cachedDigiKeyToken = null;
}

/**
 * Fetches one raw DigiKey product by exact MPN.
 */
async function fetchDigiKeyRawPart(request: ProviderPartRequest): Promise<RawProviderPayload> {
  const mpn = normalizeOptionalText(request.mpn) ?? normalizeOptionalText(request.providerPartId);

  if (!mpn) {
    throw new Error("DigiKey metadata record not found for unknown lookup");
  }

  const config = readDigiKeyProviderConfig();
  const accessToken = await readDigiKeyAccessToken(config);
  const response = await fetch(`${config.apiBaseUrl}/products/v4/search/keyword`, {
    body: JSON.stringify({ Keywords: mpn, Limit: DIGIKEY_KEYWORD_LIMIT, Offset: 0 }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-DIGIKEY-Client-Id": config.clientId ?? "",
      "X-DIGIKEY-Locale-Currency": "USD",
      "X-DIGIKEY-Locale-Language": "en",
      "X-DIGIKEY-Locale-Site": "US"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch DigiKey response (${response.status})`);
  }

  const envelope = await response.json() as { Products?: DigiKeyProduct[] | null };
  const products = Array.isArray(envelope.Products) ? envelope.Products : [];
  const product = selectExactProduct(products, mpn, request.manufacturerName);

  if (!product) {
    throw new Error(`DigiKey metadata record not found for ${mpn}`);
  }

  return {
    fetchedAt: new Date().toISOString(),
    payload: {
      product,
      request: { manufacturerName: request.manufacturerName ?? null, mpn }
    } satisfies DigiKeyRawPayload,
    providerId: DIGIKEY_PROVIDER_ID
  };
}

/**
 * Selects the exact MPN product, using a manufacturer hint only to disambiguate.
 */
function selectExactProduct(products: DigiKeyProduct[], mpn: string, manufacturerName: string | undefined): DigiKeyProduct | null {
  const exact = products.filter((product) => normalizeComparableText(product.ManufacturerProductNumber) === normalizeComparableText(mpn));
  const hint = normalizeComparableText(manufacturerName);
  const byManufacturer = hint ? exact.find((product) => normalizeComparableText(product.Manufacturer?.Name).includes(hint)) : undefined;

  return byManufacturer ?? exact[0] ?? null;
}

/**
 * Reads a usable DigiKey bearer token from cached state or OAuth client credentials.
 */
async function readDigiKeyAccessToken(config: DigiKeyProviderConfig): Promise<string> {
  if (cachedDigiKeyToken && cachedDigiKeyToken.expiresAtMs > Date.now()) {
    return cachedDigiKeyToken.accessToken;
  }

  if (!config.clientId || !config.clientSecret) {
    throw new Error("DigiKey credentials are not configured. Set DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET.");
  }

  const response = await fetch(`${config.apiBaseUrl}/v1/oauth2/token`, {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "client_credentials"
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch DigiKey access token (${response.status})`);
  }

  const payload = await response.json() as Record<string, unknown>;
  const accessToken = typeof payload.access_token === "string" && payload.access_token.trim().length > 0 ? payload.access_token.trim() : null;
  const expiresInSeconds = readPositiveNumber(payload.expires_in) ?? 10 * 60;

  if (!accessToken) {
    throw new Error("DigiKey access token response was missing access_token");
  }

  cachedDigiKeyToken = {
    accessToken,
    expiresAtMs: Date.now() + Math.max(1, expiresInSeconds) * 1000 - ACCESS_TOKEN_CACHE_SKEW_MS
  };

  return accessToken;
}

/**
 * Reads provider config from environment variables.
 */
function readDigiKeyProviderConfig(): DigiKeyProviderConfig {
  return {
    apiBaseUrl: (normalizeOptionalText(process.env.DIGIKEY_API_BASE_URL) ?? DEFAULT_DIGIKEY_API_BASE_URL).replace(/\/+$/u, ""),
    clientId: normalizeOptionalText(process.env.DIGIKEY_CLIENT_ID),
    clientSecret: normalizeOptionalText(process.env.DIGIKEY_CLIENT_SECRET)
  };
}

/**
 * Reports whether DigiKey credentials are configured so optional lookup can skip cleanly.
 */
function hasConfiguredDigiKeyCredentials(): boolean {
  const config = readDigiKeyProviderConfig();

  return Boolean(config.clientId && config.clientSecret);
}

/**
 * Normalizes one raw DigiKey payload into provider-neutral canonical records.
 */
function normalizeRawPart(rawPayload: RawProviderPayload): NormalizedProviderPart {
  if (rawPayload.providerId !== DIGIKEY_PROVIDER_ID) {
    throw new Error(`Unexpected DigiKey provider id: ${rawPayload.providerId}`);
  }

  const payload = rawPayload.payload as Partial<DigiKeyRawPayload> | null;

  if (!payload || typeof payload !== "object" || !payload.product || typeof payload.product !== "object") {
    throw new Error("Invalid DigiKey raw payload");
  }

  const product = payload.product;
  const mpn = readRequiredText(product.ManufacturerProductNumber, "product.ManufacturerProductNumber");
  const manufacturerName = readRequiredText(product.Manufacturer?.Name, "product.Manufacturer.Name");
  const variations = Array.isArray(product.ProductVariations) ? product.ProductVariations : [];
  const packageName = normalizeOptionalText(variations.find((variation) => normalizeOptionalText(variation.PackageType?.Name))?.PackageType?.Name) ?? "Unknown package";
  const description = normalizeOptionalText(product.Description?.ProductDescription)
    ?? normalizeOptionalText(product.Description?.DetailedDescription)
    ?? `${manufacturerName} ${mpn}`;

  return assembleNormalizedPart({
    category: normalizeOptionalText(product.Category?.Name) ?? "Unknown",
    datasheetUrl: normalizeOptionalText(product.DatasheetUrl),
    description,
    fetchedAt: rawPayload.fetchedAt,
    lifecycleStatus: normalizeLifecycleStatus(normalizeOptionalText(product.ProductStatus?.Status)),
    manufacturerName,
    manufacturerWebsite: null,
    metrics: readMetricCandidates(product),
    mpn,
    packageName,
    pinCount: null,
    providerId: DIGIKEY_PROVIDER_ID,
    providerPartKey: normalizeOptionalText(variations[0]?.DigiKeyProductNumber) ?? `${manufacturerName}:${mpn}`,
    rawPayload: payload,
    sourceUrl: normalizeOptionalText(product.ProductUrl) ?? `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(mpn)}`,
    supplyOfferings: buildSupplyOfferings(product),
    trustScore: 0.66
  });
}

/**
 * Reads structured metric candidates from DigiKey parameters.
 */
function readMetricCandidates(product: DigiKeyProduct): NeutralSpec[] {
  const parameters = Array.isArray(product.Parameters) ? product.Parameters : [];

  return SPEC_HINTS.flatMap((spec) => {
    const parameter = parameters.find((entry) => {
      const name = normalizeComparableText(entry.ParameterText);

      return spec.hints.some((hint) => name.includes(hint));
    });
    const rawValue = normalizeOptionalText(parameter?.ValueText);

    return rawValue ? [{ metricKey: spec.metricKey, rawValue, unit: spec.unit }] : [];
  });
}

/**
 * Builds one commercial snapshot per packaging variation that exposes pricing or stock.
 */
function buildSupplyOfferings(product: DigiKeyProduct): NeutralSupplyOffering[] {
  const variations = Array.isArray(product.ProductVariations) ? product.ProductVariations : [];

  return variations.flatMap((variation, index) => {
    const priceBreaks = (Array.isArray(variation.StandardPricing) ? variation.StandardPricing : []).flatMap((tier) => {
      const minQuantity = readPositiveInteger(tier.BreakQuantity);
      const unitPrice = readPositiveNumber(tier.UnitPrice);

      return minQuantity !== null && unitPrice !== null ? [{ currencyCode: "USD", minQuantity, unitPrice }] : [];
    });
    const inventoryQuantity = readNullableInteger(variation.QuantityAvailableforPackageType) ?? readNullableInteger(product.QuantityAvailable);

    if (priceBreaks.length === 0 && inventoryQuantity === null) {
      return [];
    }

    return [
      {
        inventoryQuantity,
        leadTimeDays: null,
        moq: readPositiveInteger(variation.MinimumOrderQuantity),
        packaging: normalizeOptionalText(variation.PackageType?.Name),
        preferredRank: index + 1,
        priceBreaks,
        providerSku: normalizeOptionalText(variation.DigiKeyProductNumber),
        supplierName: "DigiKey"
      }
    ];
  });
}

/**
 * Returns whether an error represents a normal no-match provider outcome.
 */
function isDigiKeyNotFoundError(error: unknown): boolean {
  return error instanceof Error && /DigiKey metadata record not found/u.test(error.message);
}

/**
 * Returns whether an error means DigiKey credentials are absent for optional lookup.
 */
function isDigiKeyCredentialError(error: unknown): boolean {
  return error instanceof Error && /DigiKey credentials are not configured/u.test(error.message);
}
