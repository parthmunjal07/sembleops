-- Delegation-first MVP: Marco routes work, agents execute on CLI runtimes.

CREATE TABLE IF NOT EXISTS delegations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  agent TEXT NOT NULL,                      -- persona slug (penny/paige/sam)
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'needs_review', 'reviewed', 'dismissed', 'error')),
  runtime TEXT,                             -- claude-code | codex (set when started)
  session_id TEXT,                          -- runtime-native session id (resume later)
  result TEXT,                              -- agent output (draft/report) — drafts are free
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  cost_usd REAL                             -- API-list-price shadow number when reported
);

CREATE INDEX IF NOT EXISTS idx_delegations_status ON delegations (status);

-- Marco's routing log: every front-door message and what he did with it.
CREATE TABLE IF NOT EXISTS marco_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_text TEXT NOT NULL,
  reply TEXT NOT NULL,
  actions TEXT NOT NULL                     -- JSON array of routed actions
);
