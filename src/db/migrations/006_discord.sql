-- Discord delivery channel: notification events gain Discord send tracking,
-- Delegations gain a Discord thread identifier.

ALTER TABLE notification_events ADD COLUMN discord_message_id TEXT;
ALTER TABLE notification_events ADD COLUMN discord_sent_at TEXT;

ALTER TABLE delegations ADD COLUMN thread_id TEXT;
