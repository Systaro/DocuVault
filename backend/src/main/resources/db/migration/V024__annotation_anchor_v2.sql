-- Durable comment anchors.
--
-- `anchor` stays exactly as it was and is never rewritten: it is the original
-- description of where a comment was put, kept for audit and for telling a
-- reader what a comment *used* to point at. Everything added here is the
-- rolling, re-resolved state on top of it.
--
-- Existing rows keep anchor_version 0 and go on resolving by percentage until
-- the document they sit on is next opened, at which point the client upgrades
-- them in place.

ALTER TABLE annotations
    -- Last successful resolution. Re-anchoring against this rather than against
    -- the original is what stops drift compounding over a long edit history.
    ADD COLUMN anchor_current  JSONB,

    -- ANCHORED | SHIFTED | ORPHANED. Orphaned is emphatically not resolved —
    -- it means "we could not find this text any more", not "this is settled".
    ADD COLUMN anchor_state    VARCHAR(16)  NOT NULL DEFAULT 'ANCHORED',

    -- Content hash of the document when the anchor was last resolved. Equal
    -- hash on load means the cached offsets still hold and the whole matching
    -- pipeline can be skipped.
    ADD COLUMN anchor_doc_hash VARCHAR(71),

    -- Git commit the comment was made against, for audit.
    ADD COLUMN anchor_commit   VARCHAR(40),

    ADD COLUMN anchor_version  SMALLINT     NOT NULL DEFAULT 0;

-- Comments created from here on carry a v1 record; only the legacy backlog is v0.
COMMENT ON COLUMN annotations.anchor_version IS
    '0 = legacy percentage-only anchor, 1 = W3C-shaped selector list';

-- Drives the "unanchored comments" count without scanning the table.
CREATE INDEX idx_annotations_unanchored
    ON annotations(space_id, anchor_state)
    WHERE resolved = false AND anchor_state <> 'ANCHORED';
