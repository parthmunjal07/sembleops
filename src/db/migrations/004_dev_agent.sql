-- Dex Developer: delegations can target an allowlisted project and carry
-- the resulting working-tree diff for review.

ALTER TABLE delegations ADD COLUMN project TEXT;
ALTER TABLE delegations ADD COLUMN diff TEXT;
