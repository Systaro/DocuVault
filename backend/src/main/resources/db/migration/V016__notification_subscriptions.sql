-- Per-space notification subscriptions.
--
-- Model: "subscribed by default". This table stores only OVERRIDES (opt-outs and
-- explicit opt-ins). Absence of a row for (user, space) means the user is
-- subscribed. A row on a GROUP space cascades to its child repositories unless
-- the child has its own row (resolution: repo override > group override > default-on).
CREATE TABLE space_notification_settings (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    space_id   UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    enabled    BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, space_id)
);

CREATE INDEX idx_space_notif_settings_user ON space_notification_settings(user_id);

-- Stable per-user token for unauthenticated unsubscribe links (RFC 8058 one-click
-- + body links). Generated lazily on first send. Regenerable if leaked.
ALTER TABLE users ADD COLUMN notification_token VARCHAR(64) UNIQUE;

-- New release default: members are subscribed (daily digest) unless they opt out.
-- Only affects users created from now on; existing users are migrated by the
-- gated rollout (NotificationRolloutService), which also sends a one-time
-- announcement so nobody is surprised by new mail.
ALTER TABLE users ALTER COLUMN email_mode SET DEFAULT 'DAILY';
