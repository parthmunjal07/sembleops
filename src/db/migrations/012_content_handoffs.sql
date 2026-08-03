-- A Content Studio handoff is one Marco routing request. Marco may fan that
-- request out to several sibling delegations, all sharing the handoff mission.

DROP INDEX IF EXISTS idx_delegations_active_content_run;

CREATE TABLE IF NOT EXISTS content_handoffs (
  request_id TEXT PRIMARY KEY,
  content_idea_id TEXT NOT NULL REFERENCES content_ideas(id),
  status TEXT NOT NULL
    CHECK (status IN ('routing', 'complete', 'error')),
  mission_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  response_json TEXT,
  error TEXT
);

-- The reservation is acquired before Marco calls a model. It prevents two
-- browser tabs from routing the same idea concurrently while still allowing
-- one routing to create multiple active child delegations.
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_handoffs_active_idea
  ON content_handoffs (content_idea_id)
  WHERE status = 'routing';

CREATE INDEX IF NOT EXISTS idx_content_handoffs_idea
  ON content_handoffs (content_idea_id, created_at DESC);

-- Preserve idempotency for context jobs created by the first Content Studio
-- implementation. Those jobs stored the request on the delegation itself and
-- did not have a mission because they bypassed Marco.
UPDATE delegations
SET mission_id = 'legacy-content-' || id
WHERE content_request_id IS NOT NULL AND mission_id IS NULL;

INSERT OR IGNORE INTO content_handoffs
  (request_id, content_idea_id, status, mission_id, created_at, updated_at)
SELECT
  content_request_id,
  content_idea_id,
  'complete',
  mission_id,
  created_at,
  COALESCE(finished_at, started_at, created_at)
FROM delegations
WHERE content_request_id IS NOT NULL AND content_idea_id IS NOT NULL;
