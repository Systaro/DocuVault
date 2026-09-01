-- Registry of renames and moves (within a space or across spaces).
--
-- Powers two things:
--   1. Forwarding old document URLs to the new location.
--   2. Keeping the creator right after a move. Within a space git rename
--      detection handles that on its own; across spaces the target repo's
--      history starts at the arrival commit, so the origin's creation is
--      captured here at move time.
CREATE TABLE document_moves (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    source_space_id UUID          NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    source_path     TEXT          NOT NULL,
    target_space_id UUID          NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    target_path     TEXT          NOT NULL,
    is_directory    BOOLEAN       NOT NULL DEFAULT FALSE,

    -- Who created the document originally, captured when it crossed spaces.
    -- Null for same-space moves (git follows those) and for folder rows.
    origin_author_name  VARCHAR(255),
    origin_author_email VARCHAR(320),
    origin_commit_sha   VARCHAR(64),
    origin_created_at   TIMESTAMPTZ,

    moved_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    moved_by        UUID          REFERENCES users(id) ON DELETE SET NULL
);

-- Forwarding an old URL looks up by source; creator lookup goes by target.
CREATE INDEX idx_document_moves_source ON document_moves(source_space_id, source_path);
CREATE INDEX idx_document_moves_target ON document_moves(target_space_id, target_path);
