-- OAuth 2.1 authorization server behind the MCP endpoint (/api/mcp).
--
-- MCP clients (Claude Code, Cursor, ...) register themselves (RFC 7591), send
-- the user through the consent page and exchange a PKCE-protected code for an
-- access/refresh token pair. Every credential is stored as a SHA-256 hash; the
-- raw value only ever exists in the response that handed it out, so a database
-- dump contains nothing usable.

CREATE TABLE oauth_clients (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id                   TEXT        NOT NULL UNIQUE,
    -- Only confidential clients (client_secret_basic / client_secret_post) have one.
    client_secret_hash          TEXT,
    client_name                 TEXT        NOT NULL,
    -- JSON array. Loopback URIs may vary in port at authorize time (RFC 8252).
    redirect_uris               TEXT        NOT NULL,
    token_endpoint_auth_method  TEXT        NOT NULL,
    -- JSON array; authorization_code is mandatory, refresh_token optional.
    grant_types                 TEXT        NOT NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE oauth_authorization_codes (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code_hash       TEXT        NOT NULL UNIQUE,
    client_id       UUID        NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri    TEXT        NOT NULL,
    code_challenge  TEXT        NOT NULL,
    scope           TEXT        NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    -- A code redeemed twice was intercepted: the second attempt revokes every
    -- token of this user for this client.
    used_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE oauth_tokens (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID        NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token_hash   TEXT        NOT NULL UNIQUE,
    refresh_token_hash  TEXT        NOT NULL UNIQUE,
    scope               TEXT        NOT NULL,
    access_expires_at   TIMESTAMPTZ NOT NULL,
    refresh_expires_at  TIMESTAMPTZ NOT NULL,
    -- Set when the pair was rotated away by a refresh or revoked. A rotated
    -- refresh token presented again is a replay and revokes the whole family.
    revoked_at          TIMESTAMPTZ,
    last_used_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Replay handling revokes everything a user holds for one client.
CREATE INDEX idx_oauth_tokens_user_client ON oauth_tokens(user_id, client_id);
