-- Enlaces permanentes: el número procede del registro de Apps Script/Sheets.
CREATE TABLE IF NOT EXISTS teacher_portal_registry (
 teacher_id TEXT PRIMARY KEY REFERENCES teachers(id),
 registry_number INTEGER NOT NULL UNIQUE CHECK(registry_number>0),
 public_slug TEXT NOT NULL UNIQUE,
 assigned_at INTEGER NOT NULL
);
-- La búsqueda por DNI queda acotada al docente y a su copia activa.
CREATE INDEX IF NOT EXISTS academic_students_dni ON academic_records(teacher_id,import_id,trim(CAST(json_extract(payload_json,'$.dni') AS TEXT))) WHERE dataset='students';
CREATE INDEX IF NOT EXISTS edited_students_dni ON academic_edits(teacher_id,trim(CAST(json_extract(payload_json,'$.dni') AS TEXT))) WHERE dataset='students' AND deleted=0;
