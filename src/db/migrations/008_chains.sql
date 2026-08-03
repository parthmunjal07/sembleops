-- Agent pipeline: delegations can chain.
-- verify_requested is set by Marco at routing time; when the parent finishes,
-- a Paige verification child is enqueued automatically with the output.

ALTER TABLE delegations ADD COLUMN parent_id TEXT REFERENCES delegations (id);
ALTER TABLE delegations ADD COLUMN verify_requested INTEGER NOT NULL DEFAULT 0;
