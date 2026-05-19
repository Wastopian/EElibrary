-- 039_export_bundle_cryptographic_provenance: Persists deterministic SHA-256 hashes and
-- optional Ed25519 detached signatures for assembled export bundles so a small medical,
-- aerospace, or defense shop can present an auditor-credible artifact without depending on
-- whoever built the bundle. The hashes are computed by the worker after the deterministic
-- tar+gzip step, so identical input bytes yield identical recorded hashes across regenerations.
--
-- Honesty discipline preserved: a bundle without a configured signing key is `unsigned`, never
-- `signed`. A signature that fails verification at read time becomes `verification_failed`
-- instead of being silently suppressed. The fingerprint column is the SHA-256 of the public
-- key (hex) so the UI can identify the signer without leaking the key itself.

ALTER TABLE export_bundles
  ADD COLUMN IF NOT EXISTS archive_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS manifest_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS signature_status TEXT NOT NULL DEFAULT 'unsigned',
  ADD COLUMN IF NOT EXISTS signature_algorithm TEXT,
  ADD COLUMN IF NOT EXISTS signature_public_key_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS signature_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS signature_signed_at TIMESTAMPTZ;

ALTER TABLE export_bundles
  DROP CONSTRAINT IF EXISTS export_bundles_signature_status_check;

ALTER TABLE export_bundles
  ADD CONSTRAINT export_bundles_signature_status_check
  CHECK (signature_status IN ('unsigned', 'signed', 'verification_failed'));
