-- Guardado de planificación; conserva sin cambios academic_edits y las copias.
CREATE TABLE IF NOT EXISTS planning_edits (
  teacher_id TEXT NOT NULL REFERENCES teachers(id),
  dataset TEXT NOT NULL CHECK(dataset IN ('annual', 'units', 'sessions')),
  record_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0, 1)),
  revision INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  operation_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (teacher_id, dataset, record_id)
);
