CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'member')),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS generations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  model           text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('image', 'video')),
  prompt          text NOT NULL,
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_image_url text,
  hf_request_id   uuid UNIQUE,
  status          text NOT NULL CHECK (status IN ('submitting', 'queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled')),
  error           text,
  outputs         jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_polled_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);
CREATE INDEX IF NOT EXISTS generations_user_created_idx ON generations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generations_created_idx ON generations(created_at DESC);
CREATE INDEX IF NOT EXISTS generations_pending_idx ON generations(status)
  WHERE status IN ('submitting', 'queued', 'in_progress');
