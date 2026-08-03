-- Link agent context packets back to the idea that created them. One idea can
-- have many historical runs; each delegation has at most one originating idea.

ALTER TABLE delegations
  ADD COLUMN content_idea_id TEXT REFERENCES content_ideas(id);

ALTER TABLE delegations
  ADD COLUMN content_run_kind TEXT
  CHECK (
    (content_idea_id IS NULL AND content_run_kind IS NULL)
    OR
    (
      content_idea_id IS NOT NULL
      AND content_run_kind IS NOT NULL
      AND content_run_kind IN ('context', 'verification')
    )
  );

ALTER TABLE delegations ADD COLUMN content_request_id TEXT;

CREATE INDEX IF NOT EXISTS idx_delegations_content_idea
  ON delegations (content_idea_id, created_at DESC);

-- A client retry returns the same paid job instead of enqueuing it twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_delegations_content_request
  ON delegations (content_request_id)
  WHERE content_request_id IS NOT NULL;

-- Even separate browser tabs cannot start two paid context runs for one idea.
-- A new run becomes available after the previous one reaches review or error.
CREATE UNIQUE INDEX IF NOT EXISTS idx_delegations_active_content_run
  ON delegations (content_idea_id, content_run_kind)
  WHERE content_idea_id IS NOT NULL AND status IN ('queued', 'running');
