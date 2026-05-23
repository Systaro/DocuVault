-- Meeting invites: one-time tokens a transcription bot uses to join a call
-- and drop meeting notes into a space's inbox.
CREATE TABLE IF NOT EXISTS meeting_invites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id        UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    created_by      UUID NOT NULL REFERENCES users(id),
    label           VARCHAR(255) NOT NULL,
    platform        VARCHAR(20) NOT NULL DEFAULT 'DISCORD',
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    token_hash      VARCHAR(64) NOT NULL UNIQUE,
    token_prefix    VARCHAR(16) NOT NULL,
    meeting_channel VARCHAR(500),
    participants    TEXT,
    note_count      INT NOT NULL DEFAULT 0,
    error           TEXT,
    expires_at      TIMESTAMP WITH TIME ZONE,
    claimed_at      TIMESTAMP WITH TIME ZONE,
    completed_at    TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_meeting_invites_space_id ON meeting_invites(space_id);
CREATE INDEX IF NOT EXISTS idx_meeting_invites_token_hash ON meeting_invites(token_hash);
