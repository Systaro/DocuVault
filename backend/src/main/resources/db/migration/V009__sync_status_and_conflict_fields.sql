-- DocuVault uses ddl-auto: validate — this file is documentation; apply manually on the server.

ALTER TABLE spaces ADD COLUMN sync_status VARCHAR(32) NOT NULL DEFAULT 'OK';
ALTER TABLE spaces ADD COLUMN conflict_base_ref VARCHAR(64);
ALTER TABLE spaces ADD COLUMN conflict_branch VARCHAR(255);
ALTER TABLE spaces ADD COLUMN conflict_mr_url VARCHAR(500);
ALTER TABLE spaces ADD COLUMN conflict_mr_iid BIGINT;
ALTER TABLE spaces ADD COLUMN conflict_mr_project_id BIGINT;
ALTER TABLE spaces ADD COLUMN conflict_detected_at TIMESTAMP;

-- Backfill derived status from existing error fields so existing rows start in a sensible state.
UPDATE spaces SET sync_status = 'PUSH_ERROR' WHERE last_push_error IS NOT NULL;
UPDATE spaces SET sync_status = 'SYNC_ERROR' WHERE last_sync_error IS NOT NULL AND last_push_error IS NULL;
