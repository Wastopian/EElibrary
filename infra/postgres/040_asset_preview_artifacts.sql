-- 040_asset_preview_artifacts: Persists derived preview artifact bytes for assets whose source
-- format cannot be embedded directly (STEP / kicad_mod / kicad_sym / dxf). The current preview
-- pipeline embeds source PDFs and images directly, so the derived path is only used when a
-- conversion step writes glTF / glb (3D) or PNG (rasterized footprint/symbol) into storage.
--
-- Honesty discipline preserved: a `preview_status = 'ready'` row that has no
-- `preview_artifact_storage_key` and whose source `file_format` is non-embeddable is downgraded
-- by the worker normalization helper to `not_available` -- the column lets the read path tell
-- "previewable bytes exist" from "previewable in principle but never generated."
--
-- The artifact format is constrained so a misconfigured writer cannot silently smuggle an
-- arbitrary format into the preview channel; only formats the inline previewer actually knows
-- how to render are accepted.

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS preview_artifact_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS preview_artifact_format TEXT,
  ADD COLUMN IF NOT EXISTS preview_artifact_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preview_artifact_source TEXT;

ALTER TABLE assets
  DROP CONSTRAINT IF EXISTS assets_preview_artifact_format_check;

ALTER TABLE assets
  ADD CONSTRAINT assets_preview_artifact_format_check
  CHECK (
    preview_artifact_format IS NULL
    OR preview_artifact_format IN ('glb', 'gltf', 'png', 'jpg', 'jpeg', 'webp', 'pdf')
  );

ALTER TABLE assets
  DROP CONSTRAINT IF EXISTS assets_preview_artifact_source_check;

ALTER TABLE assets
  ADD CONSTRAINT assets_preview_artifact_source_check
  CHECK (
    preview_artifact_source IS NULL
    OR preview_artifact_source IN ('source_native', 'converter_step_to_gltf', 'manual_upload')
  );
