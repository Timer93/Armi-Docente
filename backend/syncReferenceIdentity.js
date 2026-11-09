import crypto from 'node:crypto';

const name = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const dni = value => /^\d{8}$/.test(String(value || '').trim()) && !/^(\d)\1{7}$/.test(String(value || '').trim()) ? String(value).trim() : '';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parseList = value => { if (Array.isArray(value)) return value; try { const result = JSON.parse(value || '[]'); return Array.isArray(result) ? result : []; } catch { return []; } };
const quote = value => `"${String(value).replaceAll('"', '""')}"`;
export const SYNC_IDENTITY_TABLE = 'armi_sync_identity_map';
export class SyncIdentityPending extends Error {
  constructor(message) { super(message); this.code = 'ARMI_IDENTITY_PENDING'; }
}

// These are relationships, not arbitrary strings containing numbers. Textual
// session, area, unit, activity, post and comment UUIDs remain unchanged.
const studentColumns = new Set(['student_id', 'estudiante_id', 'estudiante_id_origen', 'created_by_student_id', 'reporter_id', 'recipient_id']);
const studentJsonColumns = new Set(['student_ids']);
const individual = row => ['individual', 'student'].includes(String(row.scope_type || ''));

export function createSyncReferenceIdentity(db, { legacyAliases = {} } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${SYNC_IDENTITY_TABLE} (
    entity_table TEXT NOT NULL, local_id TEXT NOT NULL, portable_id TEXT NOT NULL,
    PRIMARY KEY(entity_table,local_id), UNIQUE(entity_table,portable_id))`);
  const knownTables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
  const has = table => knownTables.has(table);
  const put = db.prepare(`INSERT INTO ${SYNC_IDENTITY_TABLE}(entity_table,local_id,portable_id) VALUES(?,?,?) ON CONFLICT(entity_table,local_id) DO UPDATE SET portable_id=excluded.portable_id`);
  const remember = (table,id,token) => {
    const previous = db.prepare(`SELECT local_id FROM ${SYNC_IDENTITY_TABLE} WHERE entity_table=? AND portable_id=?`).get(table,token);
    if(previous?.local_id===String(id)) return;
    if (previous && previous.local_id !== String(id)) {
      if (db.prepare(`SELECT 1 FROM ${quote(table)} WHERE id=?`).get(previous.local_id)) throw new SyncIdentityPending('Identidad portable duplicada; se conserva para revision.');
      db.prepare(`DELETE FROM ${SYNC_IDENTITY_TABLE} WHERE entity_table=? AND local_id=?`).run(table,previous.local_id);
    }
    put.run(table,String(id),token);
  };
  let students = [], instruments = [], evidences = [];
  let retired = [];
  const referenceIndexes=new Map();
  let deferredRefresh = 0;
  let localStudents = new Map(), portableStudents = new Map();
  const pending = message => { throw new SyncIdentityPending(message); };
  const storedIdentity = (table, id, prefix) => {
    const saved = db.prepare(`SELECT portable_id FROM ${SYNC_IDENTITY_TABLE} WHERE entity_table=? AND local_id=?`).get(table, String(id));
    if (saved) return saved.portable_id;
    const value = `@${prefix}:${crypto.randomUUID()}`; put.run(table, String(id), value); return value;
  };
  const refresh = () => {
    referenceIndexes.clear();
    students = has('db_estudiantes') ? db.prepare('SELECT * FROM db_estudiantes').all() : [];
    instruments = has('evaluacion_instrumentos') ? db.prepare('SELECT * FROM evaluacion_instrumentos').all() : [];
    evidences = has('evaluacion_evidencias') ? db.prepare('SELECT * FROM evaluacion_evidencias').all() : [];
    retired = has('db_egresados') ? db.prepare('SELECT * FROM db_egresados').all().map(row=>({
      ...row, token:String(row.estudiante_id_origen || '').startsWith('@student:') ? row.estudiante_id_origen
        : dni(row.dni) ? `@student:${hash(['dni',dni(row.dni)])}` : storedIdentity('db_egresados',row.id,'student')
    })) : [];
    localStudents = new Map(); portableStudents = new Map();
    for (const student of students) {
      const document = dni(student.dni);
      const reliable = document && students.filter(row => dni(row.dni) === document).length === 1;
      const previous = db.prepare(`SELECT portable_id FROM ${SYNC_IDENTITY_TABLE} WHERE entity_table='db_estudiantes' AND local_id=?`).get(String(student.id));
      const token = previous?.portable_id || (reliable ? `@student:${hash(['dni', document])}` : storedIdentity('db_estudiantes', student.id, 'student'));
      if (reliable) remember('db_estudiantes', student.id, token);
      const identity = { token, dni: document, name: String(student.estudiantes || ''), grade: String(student.grado || ''), section: String(student.secc || '') };
      localStudents.set(String(student.id), identity); portableStudents.set(token, student);
    }
  };
  refresh();
  const studentToken = (id, catalog = null, row = null) => {
    if (id == null || String(id) === '') return id;
    if (String(id).startsWith('@student:')) return String(id);
    if (!/^\d+$/.test(String(id))) return id;
    // Non-student test databases and already-global textual identifiers do not
    // need translation. A numeric foreign ID is never trusted by coincidence.
    if (!has('db_estudiantes')) return id;
    const reference = catalog ? catalog.students?.[String(id)] : localStudents.get(String(id));
    // A row's DNI is stronger than a reused local number (attendance/evidence).
    if (row && (row.student_id == null || String(row.student_id) === String(id))) {
      const document = dni(row.student_dni || row.dni);
      const label = name(row.student_name || row.estudiante_nombre || row.estudiantes || parseList(row.student_names)[0]);
      const grade=row.grade || row.grado,section=row.section || row.secc;
      const matches = document || label ? students.filter(student => document ? dni(student.dni) === document : label && name(student.estudiantes) === label && (!grade || String(student.grado) === String(grade)) && (!section || String(student.secc) === String(section))) : [];
      if (matches.length === 1) return localStudents.get(String(matches[0].id)).token;
      const graduates=document || label ? retired.filter(student=>document ? dni(student.dni)===document : label && name(student.estudiantes)===label && (!grade || String(student.grado)===String(grade)) && (!section || String(student.secc)===String(section))) : [];
      if(graduates.length===1) return graduates[0].token;
    }
    if (reference?.token) return reference.token;
    if (!catalog && legacyAliases[String(id)]?.token) return legacyAliases[String(id)].token;
    if(!catalog) {
      const graduates=retired.filter(row=>String(row.estudiante_id_origen)===String(id));
      if(graduates.length===1) return graduates[0].token;
    }
    const byDocument = dni(id) ? students.filter(student => dni(student.dni) === dni(id)) : [];
    if (byDocument.length === 1) return localStudents.get(String(byDocument[0].id)).token;
    if (dni(id)) return `@student:${hash(['dni',dni(id)])}`;
    if (!catalog) {
      const saved = db.prepare(`SELECT portable_id FROM ${SYNC_IDENTITY_TABLE} WHERE entity_table='db_estudiantes' AND local_id=?`).get(String(id));
      if (saved) return saved.portable_id;
    }
    if (catalog) return pending(`No hay identidad de origen para estudiante ${id}.`);
    return pending(`Referencia local de estudiante sin resolver: ${id}.`);
  };
  const localStudent = (token, catalog) => {
    if (has('db_estudiantes') && /^\d+$/.test(String(token ?? ''))) return pending('El paquete contiene un ID numerico de estudiante sin identidad de origen.');
    if (token == null || String(token) === '' || !String(token).startsWith('@student:')) return token;
    let student = portableStudents.get(token);
    if (!student) {
      const reference = Object.values(catalog?.students || {}).find(ref => ref.token === token);
      if(reference?.kind==='retired' || retired.some(row=>row.token===token)) return token;
      const document = dni(reference?.dni);
      const matches = document ? students.filter(row => dni(row.dni) === document) : [];
      if (matches.length === 1) student = matches[0];
    }
    if (!student) {
      const previous = db.prepare(`SELECT local_id FROM ${SYNC_IDENTITY_TABLE} WHERE entity_table='db_estudiantes' AND portable_id=?`).get(token);
      if (previous && !students.some(row => String(row.id) === previous.local_id)) return previous.local_id;
      return pending(`Falta el estudiante de la identidad ${token}.`);
    }
    return String(student.id);
  };
  const instrumentToken = row => `@instrument:${hash(['year','area_id','grade','section','type','name'].map(key => row[key] ?? ''))}`;
  const evidenceToken = row => row.evidence_key ? `@evidence:${row.evidence_key}` : row.relative_path ? `@evidence-path:${String(row.relative_path).replaceAll('\\','/')}` : null;
  const entityReference = (type, id, direction, catalog) => {
    if (id == null || String(id) === '' || Number(id) === 0) return id;
    const source = type === 'instrument' ? instruments : evidences;
    const tokenFor = type === 'instrument' ? instrumentToken : evidenceToken;
    if(!referenceIndexes.has(type)) {
      const outgoing=new Map(),incoming=new Map();
      for(const row of source) {const token=tokenFor(row);outgoing.set(String(row.id),token);if(!incoming.has(token))incoming.set(token,[]);incoming.get(token).push(row);}
      referenceIndexes.set(type,{outgoing,incoming});
    }
    const index=referenceIndexes.get(type);
    if (direction === 'out') {
      if (String(id).startsWith('@')) return id;
      const ref = catalog?.[type + 's']?.[String(id)];
      const token = catalog ? ref?.token : index.outgoing.get(String(id));
      if (!token) return pending(`Falta identidad de ${type} ${id}.`);
      return token;
    }
    if (!String(id).startsWith('@')) return pending(`El paquete contiene un ID local de ${type} sin traducir.`);
    const matches = index.incoming.get(id) || [];
    if (matches.length !== 1) return pending(`Referencia de ${type} no disponible: ${id}.`);
    return Number(matches[0].id);
  };
  const transform = (table, original, direction, catalog = null) => {
    const row = { ...original };
    const convert = id => direction === 'out' ? studentToken(id, catalog, row) : localStudent(id, catalog);
    if (table === 'db_estudiantes') {
      if (direction === 'out') {
        row.__studentIdentity = row.__studentIdentity || catalog?.students?.[String(row.id)] || localStudents.get(String(row.id));
        if (!row.__studentIdentity) pending('El estudiante no tiene identidad portable.');
        row.__sync_key = row.__studentIdentity.token;
        delete row.id;
      }
      return row;
    }
    if (table === 'student_deletion_tombstones' && direction === 'out' && dni(row.dni)) {
      const previous = !catalog && db.prepare(`SELECT portable_id FROM ${SYNC_IDENTITY_TABLE} WHERE entity_table='db_estudiantes' AND local_id=?`).get(String(row.student_id));
      const sourceRef=catalog?.students?.[String(row.student_id)];
      const active=localStudents.get(String(row.student_id));
      row.student_id = String(row.student_id).startsWith('@student:') ? row.student_id
        : sourceRef?.dni===dni(row.dni) ? sourceRef.token
        : !catalog && (!active || active.dni===dni(row.dni)) && previous?.portable_id ? previous.portable_id
        : `@student:${hash(['dni',dni(row.dni)])}`;
      return row;
    }
    if (table === 'student_deletion_tombstones') {
      // Tombstones outlive the deleted row. Store their portable identity even
      // locally, rather than resolving it to a possibly reused numeric ID.
      if (direction === 'out' && !String(row.student_id).startsWith('@student:')) {
        const previous=!catalog && !localStudents.has(String(row.student_id))
          && db.prepare(`SELECT portable_id FROM ${SYNC_IDENTITY_TABLE} WHERE entity_table='db_estudiantes' AND local_id=?`).get(String(row.student_id));
        if(!previous) pending('Borrado antiguo sin DNI ni identidad del registro eliminado: no se aplica a una persona reinscrita.');
        row.student_id=previous.portable_id;
      }
      return row;
    }
    for (const column of Object.keys(row)) {
      if (studentColumns.has(column) || (['author_id','sender_id'].includes(column) && (!row.author_type || row.author_type === 'student') && row.sender_type !== 'teacher')) row[column] = convert(row[column]);
      else if (studentJsonColumns.has(column)) row[column] = JSON.stringify(parseList(row[column]).map(convert));
      else if (column === 'scope_key' && individual(row)) row[column] = convert(row[column]);
      else if (column === 'instrument_id' && has('evaluacion_instrumentos')) row[column] = entityReference('instrument', row[column], direction, catalog);
      else if (column === 'evidence_ids') row[column] = JSON.stringify(parseList(row[column]).map(id => entityReference('evidence', id, direction, catalog)));
    }
    if (table === 'evaluacion_evidencias' && direction === 'out' && /^legacy-\d+$/.test(String(row.version_group_id || ''))) {
      const rootId = String(row.version_group_id).slice('legacy-'.length);
      row.version_group_id = `@version-group:${entityReference('evidence',rootId,'out',catalog)}`;
    }
    // Structured payloads can contain the same explicit relationships. Never
    // replace arbitrary numeric values: scores, dates and answer text are data.
    const nested = value => {
      if (Array.isArray(value)) return value.map(nested);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
        studentColumns.has(key) ? convert(item)
          : studentJsonColumns.has(key) && Array.isArray(item) ? item.map(convert)
          : key === 'evidence_ids' && Array.isArray(item) ? item.map(id => entityReference('evidence',id,direction,catalog))
          : nested(item)]));
    };
    for (const column of ['checkpoint_json','content_json','data_json']) {
      if (typeof row[column] !== 'string' || !row[column]) continue;
      let value; try { value = JSON.parse(row[column]); } catch { continue; }
      row[column] = JSON.stringify(nested(value));
    }
    if (table === 'student_forum_drafts' && row.author_id) row.id = `student:${row.year}:${row.author_id}`;
    else if (table === 'student_forum_drafts' && row.id) {
      const match = String(row.id).match(/^student:([^:]+):(.+)$/);
      if (match) row.id = `student:${match[1]}:${convert(match[2])}`;
    }
    if (table === 'student_learning_journal' && row.student_id && row.session_id) row.id = `${row.student_id}::${row.session_id}`;
    else if (table === 'student_learning_journal' && row.id) {
      const parts = String(row.id).split('::'); if (parts.length > 1) row.id = `${convert(parts[0])}::${parts.slice(1).join('::')}`;
    }
    if (table === 'armi_frontend_state' && typeof row.value === 'string') {
      const remapKeys = (object, mode) => Object.fromEntries(Object.entries(object).map(([key, value]) => {
        const parts = key.split('::');
        const index = mode === 'conclusion' ? 0 : 1;
        if (parts.length > index + 1) parts[index] = String(convert(parts[index]));
        return [parts.join('::'), value];
      }));
      if (row.key.startsWith('armi_register_conclusions_')) row.value = JSON.stringify(remapKeys(JSON.parse(row.value), 'conclusion'));
      else if (row.key === 'armi_hybrid_numeric_scores_v1') row.value = JSON.stringify(remapKeys(JSON.parse(row.value), 'score'));
    }
    return row;
  };
  const catalog = () => ({ students: { ...Object.fromEntries(localStudents),...Object.fromEntries(retired.map(row=>[`retired:${row.id}`,{
    token:row.token,dni:dni(row.dni),name:row.estudiantes,grade:String(row.grado || ''),section:String(row.secc || ''),kind:'retired'
  }])) },
    instruments: Object.fromEntries(instruments.map(row => [String(row.id), { token: instrumentToken(row) }])),
    evidences: Object.fromEntries(evidences.map(row => [String(row.id), { token: evidenceToken(row) }])) });
  const legacyCatalog = rows => {
    const result = { students: {}, instruments: {}, evidences: {} };
    for (const student of rows.db_estudiantes || []) {
      const candidate = dni(student.dni);
      const document = candidate && (rows.db_estudiantes || []).filter(row => dni(row.dni) === candidate).length === 1 ? candidate : '';
      const matches = document ? students.filter(row => dni(row.dni) === document) : students.filter(row => name(row.estudiantes) === name(student.estudiantes) && String(row.grado || '') === String(student.grado || '') && String(row.secc || '') === String(student.secc || ''));
      if (document) result.students[String(student.id)] = { token: `@student:${hash(['dni', document])}`, dni: document, name: student.estudiantes, grade: student.grado, section: student.secc };
      else if (matches.length === 1) result.students[String(student.id)] = localStudents.get(String(matches[0].id));
    }
    for (const row of rows.evaluacion_instrumentos || []) result.instruments[String(row.id)] = { token: instrumentToken(row) };
    for (const row of rows.evaluacion_evidencias || []) result.evidences[String(row.id)] = { token: evidenceToken(row) };
    return result;
  };
  const studentOperation = operation => {
    const reference = operation.row?.__studentIdentity;
    if (!reference) return operation;
    const document = dni(reference.dni);
    let matches = students.filter(row => localStudents.get(String(row.id))?.token === reference.token);
    if (!matches.length && document) matches = students.filter(row => dni(row.dni) === document);
    if (matches.length > 1) pending('Identidad de estudiante duplicada.');
    if (!matches.length && !document && students.some(student => name(student.estudiantes) === name(reference.name)
      && String(student.grado || '') === String(reference.grade || '') && String(student.secc || '') === String(reference.section || ''))) {
      pending('Estudiante sin DNI con identidad distinta: se requiere confirmar antes de duplicarlo.');
    }
    const row = { ...operation.row }; delete row.__studentIdentity;
    if (matches.length) return { ...operation, row, keyColumns: ['id'], keyValues: [matches[0].id] };
    if (document) return { ...operation, row, keyColumns: ['dni'], keyValues: [document] };
    // Missing-document newcomers require an explicit identity, not a reused ID.
    return { ...operation, row, keyColumns: ['id'], keyValues: [-1] };
  };
  const localOperation = operation => {
    if (operation.table === 'db_estudiantes') {
      if (operation.action === 'delete') {
        const token = operation.keyValues?.[0];
        return { ...operation, keyColumns: ['id'], keyValues: [localStudent(token)] };
      }
      return studentOperation(operation);
    }
    const keyRow = Object.fromEntries((operation.keyColumns || []).map((column,index) => [column, operation.keyValues[index]]));
    const localized = transform(operation.table, { ...keyRow, ...operation.row }, 'in', operation.references);
    return { ...operation, row: operation.row ? localized : undefined, keyValues: operation.keyColumns.map(column => localized[column]) };
  };
  const didApply = (operation, insertedId = null) => {
    if (operation.table === 'db_estudiantes' && operation.row?.__studentIdentity) {
      const ref = operation.row.__studentIdentity;
      const matches = insertedId != null ? db.prepare('SELECT * FROM db_estudiantes WHERE id=?').all(insertedId)
        : db.prepare('SELECT * FROM db_estudiantes').all().filter(row => dni(ref.dni) ? dni(row.dni) === dni(ref.dni) : localStudents.get(String(row.id))?.token === ref.token);
      if (matches.length === 1) remember('db_estudiantes',matches[0].id,ref.token);
    }
    if (!deferredRefresh && ['db_estudiantes','db_egresados','evaluacion_instrumentos','evaluacion_evidencias'].includes(operation.table)) refresh();
  };
  return { refresh, catalog, legacyCatalog, studentOperation, localOperation, didApply, requiresStudents: has('db_estudiantes'), blockedLocal: [],
    adoptStudent: (localId,token) => { remember('db_estudiantes',localId,token); if (!deferredRefresh) refresh(); },
    deferRefresh: fn => { deferredRefresh++; try { return fn(); } finally { deferredRefresh--; if (!deferredRefresh) refresh(); } },
    portable: (table,row,sourceCatalog=null) => transform(table,row,'out',sourceCatalog),
    local: (table,row,sourceCatalog=null) => transform(table,row,'in',sourceCatalog) };
}

// Used by legacy package merges as well as the incremental journal. The dump's
// roster is the source of foreign numeric IDs, never the destination roster.
export function createDumpReferenceTranslator(db, dump) {
  const identity = createSyncReferenceIdentity(db);
  const catalog = identity.legacyCatalog(dump?.tables || {});
  return (table,row) => identity.local(table,identity.portable(table,row,catalog),catalog);
}
