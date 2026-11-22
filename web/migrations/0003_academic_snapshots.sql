-- Importación de copias por cuenta. No modifica las bases del escritorio.
CREATE TABLE IF NOT EXISTS academic_imports (
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (teacher_id, id),
  UNIQUE (teacher_id, fingerprint)
);
CREATE TABLE IF NOT EXISTS academic_heads (
  teacher_id TEXT PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
  active_import_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (teacher_id, active_import_id) REFERENCES academic_imports(teacher_id, id)
);
CREATE TABLE IF NOT EXISTS academic_import_chunks (
  teacher_id TEXT NOT NULL,
  import_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  digest TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  body_bytes INTEGER NOT NULL,
  PRIMARY KEY (teacher_id, import_id, sequence),
  FOREIGN KEY (teacher_id, import_id) REFERENCES academic_imports(teacher_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS academic_records (
  teacher_id TEXT NOT NULL,
  import_id TEXT NOT NULL,
  dataset TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (teacher_id, import_id, dataset, record_id),
  FOREIGN KEY (teacher_id, import_id) REFERENCES academic_imports(teacher_id, id) ON DELETE CASCADE
);
