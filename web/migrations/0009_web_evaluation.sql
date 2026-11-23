-- Notas y conclusiones web. No modifica las copias ni la base de escritorio.
CREATE TABLE IF NOT EXISTS web_evaluation (
 teacher_id TEXT NOT NULL REFERENCES teachers(id),
 kind TEXT NOT NULL CHECK(kind IN ('grades','conclusions')),
 scope_id TEXT NOT NULL,
 scope_json TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 revision INTEGER NOT NULL,
 operation_id TEXT NOT NULL,
 operation_hash TEXT NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(teacher_id,kind,scope_id)
);
