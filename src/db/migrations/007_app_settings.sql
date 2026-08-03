-- Runtime-adjustable app settings. Config files provide defaults; this table
-- stores operator changes made from the web UI.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
