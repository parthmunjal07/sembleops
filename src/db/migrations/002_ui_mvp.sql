-- UI-first schema additions: nag scheduling moves into the task row, and
-- deliveries gain a channel so 'ui' and (later) 'discord' share one table.

ALTER TABLE tasks ADD COLUMN next_nag_at TEXT;

ALTER TABLE deliveries ADD COLUMN channel TEXT NOT NULL DEFAULT 'ui';
