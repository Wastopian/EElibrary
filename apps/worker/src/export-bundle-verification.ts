/**
 * File header: Read-time cryptographic verification for assembled export bundles.
 *
 * Assembly (in `export-bundle-assembly.ts`) computes the archive SHA-256, optionally signs the
 * hash with an Ed25519 key, and persists both the hash and the signature alongside the archive.
 * This file owns the inverse: given a stored archive (and optionally a recorded signature), it
 * recomputes the hash, verifies any persisted signature, and returns a structured outcome the
 * UI can render with the same honesty discipline as the file-availability matrix:
 *
 *   - `unsigned`              — the bundle was never signed; nothing to verify.
 *   - `signed`                — the recorded hash matches the bytes on disk and, when the bundle
 *                               carries a signature, the signature verifies against the recorded
 *                               public-key fingerprint. This is the only "audit-grade" outcome.
 *   - `verification_failed`   — the bundle was previously signed (or carries a recorded hash)
 *                               but at least one of those checks failed at read time. We expose
 *                               a structured `reason` so the UI can surface "archive_hash_mismatch"
 *                               vs "signature_mismatch" vs "signature_missing" instead of a single
 *                               opaque red badge.
 *
 * The honesty discipline is the entire point: a bundle that *was* signed but whose archive bytes
 * have changed must NEVER quietly slide back to `unsigned` -- silently "downgrading" the
 * signature is the failure mode that defeats reproducible-bundle attestation. Likewise, a bundle
 * with no recorded signature stays `unsigned`; the verifier never invents a verification it did
 * not perform.
 *
 * The verifier deliberately does not write to the database itself. The caller (worker batch
 * job, admin "Re-verify" route, asset download path) decides whether to persist the new
 * outcome -- making the verifier easy to unit-test against arbitrary storage doubles.
 */

import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import type { ExportBundleSignatureStatus } from "@ee-library/shared/types";
import type { FileStorageClient } from "@ee-library/shared/file-storage";

/**
 * VerifiableExportBundle is the minimal projection of a persisted bundle row that the verifier
 * needs. We accept this projection (rather than the full `ExportBundle`) so the verifier can
 * run from the worker without dragging in the API's response-mapping helpers.
 */
export interface VerifiableExportBundle {
  id: string;
  archiveStorageKey: string | null;
  archiveSha256: string | null;
  signatureStatus: ExportBundleSignatureStatus;
  signatureAlgorithm: string | null;
  signaturePublicKeyFingerprint: string | null;
  signatureStorageKey: string | null;
}

/**
 * ExportBundleVerificationReason classifies the structured failure mode behind a
 * `verification_failed` outcome. Each value names the exact check that did not pass so the UI
 * can render targeted recovery copy ("re-assemble this bundle" vs "rotate signing key" vs
 * "configure verification key") instead of a single opaque error.
 */
export type ExportBundleVerificationReason =
  | "archive_missing"
  | "archive_hash_mismatch"
  | "signature_missing"
  | "signature_unreadable"
  | "signature_algorithm_unsupported"
  | "verification_key_unavailable"
  | "verification_key_fingerprint_mismatch"
  | "signature_mismatch";

/**
 * ExportBundleVerificationOutcome is the structured result of one verification attempt. We
 * always return the recomputed `recomputedArchiveSha256` when the archive could be read so the
 * caller can persist it (a hash recomputation that succeeds but does not match still surfaces
 * the recomputed value -- the caller can show both side-by-side).
 *
 * The `verifiedAt` timestamp is set only on `signed` outcomes so the read path can distinguish
 * "verified within the last hour" from "verified six months ago and not re-checked since".
 */
export type ExportBundleVerificationOutcome =
  | {
      status: "unsigned";
      reason: null;
      recomputedArchiveSha256: string | null;
      verifiedAt: null;
    }
  | {
      status: "signed";
      reason: null;
      recomputedArchiveSha256: string;
      verifiedAt: string;
    }
  | {
      status: "verification_failed";
      reason: ExportBundleVerificationReason;
      recomputedArchiveSha256: string | null;
      verifiedAt: null;
    };

/**
 * VerificationKeyMaterial bundles the parsed Ed25519 public key plus its fingerprint. Mirrors
 * the assembly-side `BundleSigningKeyMaterial` shape so a deployment that uses the same key for
 * signing and verifying can pass the public half of its key pair into both call paths.
 */
export interface VerificationKeyMaterial {
  publicKey: KeyObject;
  publicKeyFingerprint: string;
}

/**
 * Reads the optional Ed25519 verification key from `EE_LIBRARY_BUNDLE_VERIFICATION_KEY` (or the
 * supplied PEM override) and returns the parsed key plus the SHA-256 fingerprint of its DER
 * SubjectPublicKeyInfo. Returns null when no key is configured so the verifier can still report
 * `verification_key_unavailable` for signed bundles instead of throwing.
 *
 * The fingerprint is computed exactly the same way the signing side computes it
 * (`createPrivateKey(...).export({ format: "der", type: "spki" })` + sha256), so a key
 * fingerprint mismatch genuinely means a different key, not a different encoding path.
 */
export function readBundleVerificationKeyMaterial(rawKey?: string | null): VerificationKeyMaterial | null {
  const pem = (rawKey ?? process.env["EE_LIBRARY_BUNDLE_VERIFICATION_KEY"] ?? "").trim();
  if (pem.length === 0) {
    return null;
  }

  const publicKey = createPublicKey(pem);
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error(`Bundle verification key must be Ed25519 (got ${String(publicKey.asymmetricKeyType)}).`);
  }

  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const publicKeyFingerprint = createHash("sha256").update(publicKeyDer).digest("hex");

  return { publicKey, publicKeyFingerprint };
}

/**
 * Verifies one assembled bundle against its recorded provenance. This function is intentionally
 * pure (no DB writes) so the caller can choose when to persist the new state.
 *
 * Algorithm:
 *   1. If the bundle has no archive storage key (manifest-only) and was never signed → return
 *      `unsigned` with no recomputed hash.
 *   2. Read the archive bytes from storage and recompute SHA-256.
 *      - If the read fails → `verification_failed` with reason `archive_missing`.
 *      - If a hash was previously recorded and does not match → `verification_failed` with
 *        reason `archive_hash_mismatch`. (The recomputed hash is still returned so the caller
 *        can persist it for forensics.)
 *   3. If the bundle was never signed → return `unsigned` with the recomputed hash.
 *   4. If the bundle was signed but the algorithm is unsupported → `signature_algorithm_unsupported`.
 *   5. If no verification key is supplied → `verification_key_unavailable`.
 *   6. If the supplied key's fingerprint does not match the recorded fingerprint →
 *      `verification_key_fingerprint_mismatch` (we never accept a different signer for a
 *      bundle that recorded a specific fingerprint).
 *   7. Read the signature bytes; if missing → `signature_missing`. If unreadable →
 *      `signature_unreadable`.
 *   8. Run Ed25519 verify against the lowercase hex of the recomputed archive hash. Match →
 *      `signed` (verifiedAt set to "now"); mismatch → `signature_mismatch`.
 */
export async function verifyAssembledExportBundle(
  storage: FileStorageClient,
  bundle: VerifiableExportBundle,
  options: { verificationKey?: VerificationKeyMaterial | null; now?: () => Date } = {}
): Promise<ExportBundleVerificationOutcome> {
  const now = options.now ?? (() => new Date());

  if (!bundle.archiveStorageKey) {
    if (bundle.signatureStatus === "signed") {
      return {
        reason: "archive_missing",
        recomputedArchiveSha256: null,
        status: "verification_failed",
        verifiedAt: null
      };
    }
    return { reason: null, recomputedArchiveSha256: null, status: "unsigned", verifiedAt: null };
  }

  let archiveBytes: Buffer;
  try {
    archiveBytes = await storage.read(bundle.archiveStorageKey);
  } catch {
    return {
      reason: "archive_missing",
      recomputedArchiveSha256: null,
      status: "verification_failed",
      verifiedAt: null
    };
  }

  const recomputedArchiveSha256 = createHash("sha256").update(archiveBytes).digest("hex");

  if (bundle.archiveSha256 !== null && bundle.archiveSha256 !== recomputedArchiveSha256) {
    return {
      reason: "archive_hash_mismatch",
      recomputedArchiveSha256,
      status: "verification_failed",
      verifiedAt: null
    };
  }

  if (bundle.signatureStatus !== "signed" || !bundle.signatureStorageKey) {
    return { reason: null, recomputedArchiveSha256, status: "unsigned", verifiedAt: null };
  }

  if (bundle.signatureAlgorithm !== "ed25519") {
    return {
      reason: "signature_algorithm_unsupported",
      recomputedArchiveSha256,
      status: "verification_failed",
      verifiedAt: null
    };
  }

  if (!options.verificationKey) {
    return {
      reason: "verification_key_unavailable",
      recomputedArchiveSha256,
      status: "verification_failed",
      verifiedAt: null
    };
  }

  if (
    bundle.signaturePublicKeyFingerprint !== null
    && bundle.signaturePublicKeyFingerprint !== options.verificationKey.publicKeyFingerprint
  ) {
    return {
      reason: "verification_key_fingerprint_mismatch",
      recomputedArchiveSha256,
      status: "verification_failed",
      verifiedAt: null
    };
  }

  let signatureBytes: Buffer;
  try {
    signatureBytes = await storage.read(bundle.signatureStorageKey);
  } catch {
    return {
      reason: "signature_missing",
      recomputedArchiveSha256,
      status: "verification_failed",
      verifiedAt: null
    };
  }

  let signatureValid = false;
  try {
    signatureValid = cryptoVerify(
      null,
      Buffer.from(recomputedArchiveSha256, "utf8"),
      options.verificationKey.publicKey,
      signatureBytes
    );
  } catch {
    return {
      reason: "signature_unreadable",
      recomputedArchiveSha256,
      status: "verification_failed",
      verifiedAt: null
    };
  }

  if (!signatureValid) {
    return {
      reason: "signature_mismatch",
      recomputedArchiveSha256,
      status: "verification_failed",
      verifiedAt: null
    };
  }

  return {
    reason: null,
    recomputedArchiveSha256,
    status: "signed",
    verifiedAt: now().toISOString()
  };
}
