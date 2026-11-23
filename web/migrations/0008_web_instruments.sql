-- Instrumentos web independientes: no altera sesiones ni copias importadas.
CREATE TABLE IF NOT EXISTS web_instruments (
  teacher_id TEXT NOT NULL REFERENCES teachers(id),
  id TEXT NOT NULL,
  year TEXT NOT NULL,
  area_id TEXT NOT NULL,
  grade TEXT NOT NULL,
  section TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  operation_id TEXT NOT NULL,
  operation_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (teacher_id,id)
);
CREATE INDEX IF NOT EXISTS web_instruments_scope ON web_instruments(teacher_id,year,area_id,grade,section,id);
