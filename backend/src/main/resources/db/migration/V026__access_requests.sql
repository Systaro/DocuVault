-- Someone asking for access to a space they cannot open.
--
-- Kept rather than fired-and-forgotten so a repeat click does not mail the
-- admins again, and so there is a record of who asked for what and when.
CREATE TABLE access_requests (
    id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id    UUID          NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message     TEXT,
    -- How many admins the request actually reached; 0 means nobody could be
    -- notified, which is worth seeing rather than reporting success.
    notified    INTEGER       NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- The dedupe lookup: the newest request by this person for this space.
CREATE INDEX idx_access_requests_space_user ON access_requests(space_id, user_id, created_at DESC);
