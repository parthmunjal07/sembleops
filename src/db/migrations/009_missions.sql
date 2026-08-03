-- Missions: delegations born from one Marco routing share a mission_id, so
-- multi-agent work renders as ONE combined packet with per-agent sections.

ALTER TABLE delegations ADD COLUMN mission_id TEXT;
ALTER TABLE marco_log ADD COLUMN mission_id TEXT;
