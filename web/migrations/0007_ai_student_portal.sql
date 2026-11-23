CREATE TABLE IF NOT EXISTS ai_credentials (
 teacher_id TEXT NOT NULL REFERENCES teachers(id), provider TEXT NOT NULL CHECK(provider IN ('gemini','openai')),
 cipher TEXT NOT NULL, iv TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL,
 PRIMARY KEY(teacher_id,provider)
);
CREATE TABLE IF NOT EXISTS ai_preferences (teacher_id TEXT PRIMARY KEY REFERENCES teachers(id),payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_usage (teacher_id TEXT NOT NULL,day TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(teacher_id,day));
CREATE TABLE IF NOT EXISTS ai_leases (teacher_id TEXT PRIMARY KEY,lease_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS web_service_limits (bucket TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS student_portals (
 teacher_id TEXT PRIMARY KEY REFERENCES teachers(id), public_id TEXT NOT NULL UNIQUE,
 is_open INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0, access_epoch INTEGER NOT NULL DEFAULT 0,
 membership_until INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS student_access (
 teacher_id TEXT NOT NULL REFERENCES teachers(id),student_id TEXT NOT NULL,code_hash TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(teacher_id,student_id)
);
CREATE INDEX IF NOT EXISTS student_access_code ON student_access(teacher_id,code_hash);
CREATE INDEX IF NOT EXISTS web_service_limits_expiry ON web_service_limits(expires_at);
CREATE TABLE IF NOT EXISTS student_web_sessions (
 token_hash TEXT PRIMARY KEY,teacher_id TEXT NOT NULL,student_id TEXT NOT NULL,
 portal_epoch INTEGER NOT NULL,access_revision INTEGER NOT NULL,expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS student_web_sessions_expiry ON student_web_sessions(expires_at);
CREATE TABLE IF NOT EXISTS student_publications (teacher_id TEXT NOT NULL,session_id TEXT NOT NULL,published INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(teacher_id,session_id));
CREATE TABLE IF NOT EXISTS student_text_submissions (
 id TEXT PRIMARY KEY,teacher_id TEXT NOT NULL,student_id TEXT NOT NULL,session_id TEXT NOT NULL,
 text TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS student_submissions_owner ON student_text_submissions(teacher_id,created_at,id);
CREATE INDEX IF NOT EXISTS student_submissions_student ON student_text_submissions(teacher_id,student_id,created_at);
