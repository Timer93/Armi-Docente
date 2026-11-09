const list = value => {
  if (Array.isArray(value)) return value.map(String);
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
};
const nameKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const dniKey = value => /^\d{8}$/.test(String(value || '').trim()) && !/^(\d)\1{7}$/.test(String(value || '').trim())
  ? String(value).trim() : '';

export const createEvidenceStudentResolver = (students = []) => {
  const byId = new Map(students.map(student => [String(student.id), student]));
  const byName = new Map();
  const byDni = new Map();
  for (const student of students) {
    const name = nameKey(student.estudiantes);
    const dni = dniKey(student.dni);
    if (name) byName.set(name, [...(byName.get(name) || []), student]);
    if (dni) byDni.set(dni, [...(byDni.get(dni) || []), student]);
  }
  return row => {
    const parts = String(row.relative_path || '').replace(/\\/g, '/').split('/');
    // The submission folder preserves its class even if a foreign numeric id
    // previously caused the local row's grade/section to be rewritten.
    const folderScope = parts.length >= 7 && /^\d{4}$/.test(parts[0]) && /^U\d+$/i.test(parts[4]);
    const grade = String(folderScope ? parts[2] : row.grade || '');
    const section = String(folderScope ? parts[3] : row.section || '');
    const names = list(row.student_names);
    const ids = list(row.student_ids);
    const dnis = list(row.student_dnis);
    const scopeMatches = student => (!grade || !student.grado || String(student.grado) === grade)
      && (!section || !student.secc || String(student.secc) === section);
    const resolve = (id, name, dni) => {
      const normalizedName = nameKey(name);
      const matchingName = student => !normalizedName || nameKey(student.estudiantes) === normalizedName;
      const dniMatches = (byDni.get(dniKey(dni)) || []).filter(matchingName);
      if (dniMatches.length === 1) return dniMatches[0];
      const nameMatches = (byName.get(normalizedName) || []).filter(scopeMatches);
      if (nameMatches.length === 1) return nameMatches[0];
      // Numeric ids are acceptable only when the supplied identity agrees.
      // Ambiguous names are never guessed from another PC's numeric id.
      const local = byId.get(String(id || ''));
      if (local && matchingName(local) && scopeMatches(local) && !normalizedName && !dniKey(dni)) return local;
      return null;
    };
    const primaryIndex = Math.max(0, ids.indexOf(String(row.student_id || '')));
    const primary = resolve(row.student_id, names[primaryIndex], row.student_dni || dnis[primaryIndex]);
    const members = ids.map((id, index) => resolve(id, names[index], dnis[index] || (index === primaryIndex ? row.student_dni : '')));
    if (!primary && !members.some(Boolean)) return row;
    const resolvedIds = ids.map((id, index) => String(members[index]?.id ?? (id === String(row.student_id) && primary ? primary.id : id)));
    const resolvedDnis = ids.map((id, index) => dniKey(members[index]?.dni || (id === String(row.student_id) ? primary?.dni : '') || dnis[index]));
    return { ...row,
      ...(primary ? { student_id: String(primary.id), student_dni: dniKey(primary.dni) } : {}),
      ...(ids.length ? { student_ids: JSON.stringify(resolvedIds), student_dnis: JSON.stringify(resolvedDnis) } : {}),
      grade, section,
    };
  };
};

export const evidenceStudentResolverForDatabase = db => {
  try { return createEvidenceStudentResolver(db.prepare('SELECT * FROM db_estudiantes').all()); }
  catch { return row => row; }
};

export const planEvidenceStudentRepairs = db => {
  const resolve = evidenceStudentResolverForDatabase(db);
  const columns = new Set(db.prepare('PRAGMA table_info(evaluacion_evidencias)').all().map(column => column.name));
  if (!columns.has('student_id')) return [];
  return db.prepare('SELECT * FROM evaluacion_evidencias').all().flatMap(row => {
    const resolved = resolve(row);
    const fields = ['student_id', 'student_ids', 'student_dni', 'student_dnis', 'grade', 'section']
      .filter(field => columns.has(field) && resolved[field] !== undefined && String(row[field] ?? '') !== String(resolved[field] ?? ''));
    return fields.length ? [{ id: row.id, evidenceKey: row.evidence_key, fields,
      before: Object.fromEntries(fields.map(field => [field, row[field]])),
      after: Object.fromEntries(fields.map(field => [field, resolved[field]])),
      studentNames: row.student_names, updatedAt: row.updated_at }] : [];
  });
};

export const applyEvidenceStudentRepairs = (db, repairs) => db.transaction(() => {
  let updated = 0;
  for (const repair of repairs) {
    const fields = repair.fields;
    updated += db.prepare(`UPDATE evaluacion_evidencias SET ${fields.map(field => `${field} = ?`).join(', ')}
      WHERE id = ? AND ${fields.map(field => `${field} IS ?`).join(' AND ')} AND student_names IS ? AND updated_at IS ?`)
      .run(...fields.map(field => repair.after[field]), repair.id, ...fields.map(field => repair.before[field]), repair.studentNames, repair.updatedAt).changes;
  }
  return updated;
})();
