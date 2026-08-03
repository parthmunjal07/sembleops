-- Content Studio: a quiet editorial backlog, intentionally separate from
-- commitments so a captured idea never enters Larry's nag loop.

CREATE TABLE IF NOT EXISTS content_ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  hook TEXT NOT NULL DEFAULT '',
  angle TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'inbox'
    CHECK (stage IN ('inbox', 'shaping', 'ready', 'drafting')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high')),
  tags_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'import')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  target_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_content_ideas_board
  ON content_ideas (archived_at, stage, sort_order, updated_at);
