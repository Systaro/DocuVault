CREATE TABLE space_state (
    id          UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    space_id    UUID         NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    key         VARCHAR(255) NOT NULL,
    value       TEXT         NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (space_id, key)
);

CREATE INDEX idx_space_state_space_id ON space_state(space_id);
