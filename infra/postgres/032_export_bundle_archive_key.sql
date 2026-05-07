-- 032_export_bundle_archive_key: Adds the per-bundle single-archive (`.tar.gz`) storage key.
--
-- The synchronous `storage_key` column persists the manifest archive written at bundle creation
-- by the API. This new column lets the worker record where the assembled `.tar.gz` archive lives
-- without losing the manifest path. Splitting the two keys keeps the manifest readable as JSON
-- (e.g. for audit) while still letting engineers download a single packaged archive.

ALTER TABLE export_bundles
  ADD COLUMN IF NOT EXISTS archive_storage_key TEXT;
