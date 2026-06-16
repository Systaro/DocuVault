-- A user can ask an ACTIVE meeting to stop from the DocuVault UI. The bot polls
-- this flag and, when set, ends recording and files whatever it captured so far
-- (same outcome as Discord's /stop, but triggerable for Teams too).
ALTER TABLE meeting_invites
    ADD COLUMN stop_requested BOOLEAN NOT NULL DEFAULT FALSE;
