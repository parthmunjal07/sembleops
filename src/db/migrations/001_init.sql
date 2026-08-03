-- SembleOps schema v1.
-- All timestamps are UTC ISO-8601 strings. Display timezone comes from node config.

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,                      -- uuid
  title TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('voice', 'text', 'auto', 'email')),
  created_at TEXT NOT NULL,
  due_at TEXT,                              -- nullable, UTC
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'done', 'killed', 'deferred', 'blocked')),
  snooze_count INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  blocked_recheck_at TEXT,                  -- Blocked tasks are revisited.
  thread_id TEXT,                           -- Discord thread <-> session
  session_id TEXT,
  escalation_level INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks (status, due_at);

-- Append-only event history per task (capture, nag, snooze, escalate, resolve, edit).
CREATE TABLE IF NOT EXISTS task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks (id),
  at TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT                               -- JSON
);

CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history (task_id);

-- Delivery confirmation: a send without a persisted Discord message id
-- is a failure. "Hours since last confirmed delivery" feeds the health model.
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT REFERENCES tasks (id),       -- null for briefs/reckonings/digests
  kind TEXT NOT NULL CHECK (kind IN ('nag', 'brief', 'reckoning', 'digest', 'other')),
  sent_at TEXT NOT NULL,
  discord_message_id TEXT,                  -- NULL = unconfirmed = failure
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_deliveries_sent ON deliveries (sent_at);

-- Sessions are runtime-pinned. Cross-runtime failover
-- applies to NEW tasks only; cross-runtime resume is an explicit lossy restart.
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  runtime TEXT NOT NULL CHECK (runtime IN ('claude-code', 'codex', 'rovo', 'api')),
  agent TEXT NOT NULL,                      -- persona slug
  thread_id TEXT,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  transcript_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'checkpointed', 'closed')),
  resumed_from TEXT REFERENCES sessions (session_id)  -- set on lossy cross-runtime restart
);

-- Audit log of every tool call, approval, and kill.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  agent TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,                              -- JSON
  approved INTEGER                          -- NULL = not gated, 0 = rejected, 1 = approved
);

-- Cost ledger. cost_usd_list is the API list-price shadow number.
CREATE TABLE IF NOT EXISTS cost_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  task_id TEXT REFERENCES tasks (id),
  session_id TEXT REFERENCES sessions (session_id),
  agent TEXT NOT NULL,
  runtime TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd_list REAL,
  raw TEXT                                  -- JSON: runtime-reported cost fields
);

-- Auto-capture proposal queue: the watcher's only write target.
-- source_quote is verbatim untrusted content, shown quoted in the approval card.
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('email', 'discord')),
  source_quote TEXT NOT NULL,
  title TEXT NOT NULL,
  due_at TEXT,
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'dismissed')),
  task_id TEXT REFERENCES tasks (id)        -- set on approval
);
