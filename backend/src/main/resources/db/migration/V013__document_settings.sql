-- Per-document UI preferences shared across the team
-- (e.g. preferred content width set by dragging the resize handle).
-- Anyone with read access can write; last-write-wins.
CREATE TABLE document_settings (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id     UUID         NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    file_path    VARCHAR(1000) NOT NULL,
    settings     JSONB        NOT NULL DEFAULT '{}'::jsonb,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (space_id, file_path)
);

CREATE INDEX idx_document_settings_space_path ON document_settings(space_id, file_path);
