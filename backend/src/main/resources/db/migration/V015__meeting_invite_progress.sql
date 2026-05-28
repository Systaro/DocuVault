-- Live transcription progress for meeting invites. While an invite is ACTIVE
-- the bot reports its current phase (recording, transcribing, …) and a counter
-- so the DocuVault UI can show real-time status over SSE.
ALTER TABLE meeting_invites
    ADD COLUMN IF NOT EXISTS phase            VARCHAR(20),
    ADD COLUMN IF NOT EXISTS progress_current INT,
    ADD COLUMN IF NOT EXISTS progress_total   INT,
    ADD COLUMN IF NOT EXISTS progress_message VARCHAR(500);
