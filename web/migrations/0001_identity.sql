-- Solo estructura nueva: no importa ni modifica la base del escritorio.
PRAGMA foreign_keys = ON;

CREATE TABLE teachers (
  id TEXT PRIMARY KEY,
  provider_username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  institution_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE web_sessions (
  token_hash TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  membership_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX web_sessions_expiry ON web_sessions(expires_at);
CREATE INDEX web_sessions_teacher ON web_sessions(teacher_id);

CREATE TABLE auth_rate_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_rate_limits_expiry ON auth_rate_limits(expires_at);

CREATE TABLE auth_leases (
  id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_leases_expiry ON auth_leases(expires_at);
