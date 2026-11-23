-- Configuración propia de cada cuenta; no modifica las copias importadas.
CREATE TABLE IF NOT EXISTS web_configurations (
  teacher_id TEXT PRIMARY KEY REFERENCES teachers(id),
  payload_json TEXT NOT NULL,
  removed_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  operation_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
