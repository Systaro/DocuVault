-- Teams meeting join link the browser bot is dispatched to. Supplied at invite
-- creation for TEAMS invites; stays NULL for Discord (whose bot is triggered
-- from inside the call and needs no URL).
ALTER TABLE meeting_invites
    ADD COLUMN IF NOT EXISTS meeting_url TEXT;
