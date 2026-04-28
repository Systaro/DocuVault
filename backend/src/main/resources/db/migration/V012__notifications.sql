-- Per-user notification preferences: push and email cadences are independent.
ALTER TABLE users ADD COLUMN push_mode VARCHAR(16) NOT NULL DEFAULT 'INSTANT'
    CHECK (push_mode IN ('INSTANT', 'NONE'));
ALTER TABLE users ADD COLUMN email_mode VARCHAR(16) NOT NULL DEFAULT 'NONE'
    CHECK (email_mode IN ('INSTANT', 'HOURLY', 'DAILY', 'NONE'));

-- Track the last commit we synced so we can diff incrementally
ALTER TABLE spaces ADD COLUMN last_synced_commit_sha VARCHAR(40);

-- Per-space change events emitted during sync (and via MCP-triggered commits)
CREATE TABLE space_change_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    old_path TEXT,
    change_type VARCHAR(16) NOT NULL CHECK (change_type IN ('ADDED', 'MODIFIED', 'DELETED', 'RENAMED')),
    commit_sha VARCHAR(40),
    commit_message TEXT,
    commit_author_email VARCHAR(320),
    commit_author_name VARCHAR(255),
    triggered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_space_change_events_space_detected ON space_change_events(space_id, detected_at DESC);
CREATE INDEX idx_space_change_events_detected ON space_change_events(detected_at);

-- Outbox of dispatched notifications (one row per user per event per channel)
CREATE TABLE notification_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES space_change_events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(16) NOT NULL CHECK (channel IN ('PUSH', 'EMAIL_INSTANT', 'EMAIL_HOURLY', 'EMAIL_DAILY')),
    dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    success BOOLEAN NOT NULL,
    error TEXT,
    UNIQUE (event_id, user_id, channel)
);

CREATE INDEX idx_notification_dispatches_user ON notification_dispatches(user_id, dispatched_at DESC);
