-- Durable local notification queue. Scheduler writes events here; browser/PWA
-- delivery confirms them back into deliveries as channel='browser'.

CREATE TABLE IF NOT EXISTS notification_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  local_date TEXT,
  task_id TEXT REFERENCES tasks (id),
  kind TEXT NOT NULL CHECK (kind IN ('nag', 'brief', 'reckoning', 'digest', 'other')),
  agent TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link_path TEXT NOT NULL DEFAULT '/',
  browser_notified_at TEXT,
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_events_unread
  ON notification_events (read_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_events_daily_once
  ON notification_events (kind, local_date)
  WHERE local_date IS NOT NULL;
