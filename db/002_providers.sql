-- Track which backend ran each job, and its job id when it is not a Higgsfield UUID.
ALTER TABLE generations ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'higgsfield';
ALTER TABLE generations ADD COLUMN IF NOT EXISTS provider_request_id text;
