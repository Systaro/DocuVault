-- Audit table for denied public share access attempts.
-- Applied manually via psql on the server (project uses ddl-auto=validate, no Flyway).

CREATE TABLE IF NOT EXISTS shared_link_access_denials (
    id UUID PRIMARY KEY,
    token VARCHAR(64) NOT NULL,
    reason VARCHAR(32) NOT NULL,
    client_ip VARCHAR(45),
    user_agent VARCHAR(500),
    request_uri VARCHAR(2000),
    created_at TIMESTAMP(6) WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_denial_token ON shared_link_access_denials(token);
CREATE INDEX IF NOT EXISTS idx_denial_created_at ON shared_link_access_denials(created_at);
