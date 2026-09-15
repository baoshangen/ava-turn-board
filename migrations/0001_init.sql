-- AVA Turn Board schema for Cloudflare D1.
-- Applied with: wrangler d1 migrations apply ava-turn-board --remote
CREATE TABLE IF NOT EXISTS board (
  id integer PRIMARY KEY NOT NULL,
  revision integer NOT NULL,
  data text NOT NULL
);

CREATE TABLE IF NOT EXISTS salon_account (
  id integer PRIMARY KEY NOT NULL,
  username text NOT NULL,
  password_hash text NOT NULL,
  salt text NOT NULL,
  epoch text NOT NULL
);

CREATE TABLE IF NOT EXISTS salon_sessions (
  token_hash text PRIMARY KEY NOT NULL,
  epoch text NOT NULL,
  expires_at integer NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key text PRIMARY KEY NOT NULL,
  attempts integer NOT NULL,
  expires_at integer NOT NULL
);
