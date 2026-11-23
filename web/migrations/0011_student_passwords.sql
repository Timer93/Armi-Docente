CREATE TABLE IF NOT EXISTS student_passwords (
 teacher_id TEXT NOT NULL REFERENCES teachers(id),
 student_id TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(teacher_id,student_id)
);
CREATE TABLE IF NOT EXISTS student_password_sessions (
 token_hash TEXT PRIMARY KEY REFERENCES student_web_sessions(token_hash) ON DELETE CASCADE,
 password_revision INTEGER NOT NULL,
 must_change INTEGER NOT NULL DEFAULT 1
);
