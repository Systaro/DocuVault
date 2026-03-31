CREATE TABLE space_tokens (
    id           UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    space_id     UUID         NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    name         VARCHAR(255) NOT NULL,
    token_hash   VARCHAR(64)  NOT NULL UNIQUE,
    token_prefix VARCHAR(16)  NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);

CREATE INDEX idx_space_tokens_space_id  ON space_tokens(space_id);
CREATE INDEX idx_space_tokens_token_hash ON space_tokens(token_hash);
