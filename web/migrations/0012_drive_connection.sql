CREATE TABLE IF NOT EXISTS drive_connections (
 teacher_id TEXT PRIMARY KEY REFERENCES teachers(id),
 google_account_id TEXT NOT NULL,
 google_email TEXT NOT NULL,
 token_cipher TEXT NOT NULL,
 token_iv TEXT NOT NULL,
 folder_id TEXT UNIQUE,
 folder_name TEXT NOT NULL DEFAULT '',
 mirror_verified INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS drive_oauth_states (
 state_hash TEXT PRIMARY KEY,
 teacher_id TEXT NOT NULL REFERENCES teachers(id),
 session_hash TEXT NOT NULL,
 verifier_cipher TEXT NOT NULL,
 verifier_iv TEXT NOT NULL,
 connection_revision INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS drive_oauth_expiry ON drive_oauth_states(expires_at);
