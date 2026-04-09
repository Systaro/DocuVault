-- Add access level to shared links (VIEW = read-only, COMMENT = can annotate)
ALTER TABLE shared_links ADD COLUMN access_level VARCHAR(10) NOT NULL DEFAULT 'VIEW';

-- Annotations table: pinned comments on documents
CREATE TABLE annotations (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id        UUID         NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    file_path       VARCHAR(1000) NOT NULL,

    -- Author: internal user OR anonymous (shared link commenter)
    user_id         UUID         REFERENCES users(id) ON DELETE SET NULL,
    author_name     VARCHAR(255) NOT NULL,

    -- Thread: NULL = top-level, non-NULL = reply
    parent_id       UUID         REFERENCES annotations(id) ON DELETE CASCADE,

    -- Content
    body            TEXT         NOT NULL,

    -- Position anchor (JSONB) — schema depends on render mode:
    --   markdown: {"type":"markdown","xPercent":42.5,"yPercent":18.3,"snippet":"nearby text"}
    --   image:    {"type":"image","xPercent":65.0,"yPercent":30.0}
    --   html:     {"type":"html","elementId":"feat-1","selector":"body>div:nth-child(3)>p","offsetX":35.2,"offsetY":60.1,"xPercent":22.8,"yPercent":41.3}
    --   pdf:      {"type":"pdf","page":1,"xPercent":45.0,"yPercent":60.0}
    -- NULL for replies (they inherit parent's anchor)
    anchor          JSONB,

    -- Resolution lifecycle
    resolved        BOOLEAN      NOT NULL DEFAULT false,
    resolved_by     UUID         REFERENCES users(id) ON DELETE SET NULL,
    resolved_at     TIMESTAMPTZ,

    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_annotations_space_file ON annotations(space_id, file_path);
CREATE INDEX idx_annotations_parent ON annotations(parent_id);
CREATE INDEX idx_annotations_user ON annotations(user_id);
