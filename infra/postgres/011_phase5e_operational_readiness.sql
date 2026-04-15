-- File header: Adds low-risk indexes for Phase 5E operational diagnostics and worker queues.

-- Draft generation scans pending requests by status and target before oldest-first processing.
CREATE INDEX IF NOT EXISTS idx_generation_requests_status_target_requested_at ON generation_requests(request_status, target_asset_type, requested_at ASC, id ASC);

-- Draft generation chooses the best extraction signal for a part, target, and usable extraction state.
CREATE INDEX IF NOT EXISTS idx_source_extraction_signals_generation_lookup ON source_extraction_signals(part_id, signal_type, extraction_status, confidence_score DESC, last_updated_at DESC);

-- Local diagnostics list recent generation workflow activity without scanning every workflow row first.
CREATE INDEX IF NOT EXISTS idx_generation_workflows_status_part ON generation_workflows(generation_status, part_id);

-- Local diagnostics list recent validation evidence and promotion attempts by freshness and outcome.
CREATE INDEX IF NOT EXISTS idx_asset_validation_records_validated_at ON asset_validation_records(validated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_asset_promotion_audits_outcome_created_at ON asset_promotion_audits(promotion_outcome, created_at DESC, id DESC);
