-- File header: Adds compact source-location previews for project document reads.
--
-- Full extracted segments remain available for targeted document searches. Project-page
-- reads use this small preview list so opening a project does not load every retained
-- page, sheet, slide, or paragraph segment.

ALTER TABLE project_document_extractions
  ADD COLUMN IF NOT EXISTS source_location_previews JSONB NOT NULL DEFAULT '[]'::jsonb;
