-- Añade datos por docente sin modificar perfiles ni importar datos del escritorio.
CREATE TABLE IF NOT EXISTS teacher_responsables (
  teacher_id TEXT PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
