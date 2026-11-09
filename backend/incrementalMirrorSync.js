import { createSyncReferenceIdentity, SYNC_IDENTITY_TABLE } from './syncReferenceIdentity.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { portableEvidenceKey } from './evidenceMirrorIndex.js';
import { readMirrorJson as readJsonAsync } from './mirrorJsonReader.js';
import { evidenceStudentResolverForDatabase, planEvidenceStudentRepairs, applyEvidenceStudentRepairs } from './evidenceStudentIdentity.js';
import { wouldEraseNewerUnitPlanning } from './shared/unitPlanningSyncProtection.js';
import { applyPreparedIdentityMigration, IDENTITY_LOCAL_TABLES, IDENTITY_PARENT_TABLES, IDENTITY_REPLACED_TABLES } from './identityMigration.js';
import { reviewedLegacyBatchDecisions } from './reviewedSyncBatches.js';
import { compactBatchReferencesAsync } from './syncBatchReferences.js';
import { createDeliveryReceipts, recordIncorporatedHead, batchContentHash } from './syncDeliveryReceipts.js';
import { createSyncHistoryMaintenance } from './syncHistoryMaintenance.js';

const FORMAT = 2;
const readableFormat = value => value === 1 || value === FORMAT;
const IDENTITY_REVISION = 4;
// Concurrent filter selections and already-seen reminders can be resolved by
// the existing deterministic clock. They are not academic-data conflicts.
const MERGEABLE_PREFERENCES = new Set([
  'armi_birthdays_toast_seen',
  'armi_view_selection_sesiones_v1',
  'armi_register_bimester_view_selection',
  'armi_register_unit_view_selection',
  'armi_students_list_selection_v1',
]);

const NATURAL_KEYS = {
  datos_generales: [['id']],
  db_estudiantes: [['__sync_key'], ['dni'], ['id']],
  db_egresados: [['dni'], ['estudiante_id_origen'], ['id']],
  asistencia_rostros: [['student_id'], ['id']],
  asistencia_registros: [['attendance_date', 'grade', 'section', 'student_id'], ['id']],
  areas_grados_cargo: [['area','grado','seccion']],
  db_enfoques: [['enfoque', 'valores', 'actitudes', 'se_demuestra_cuando']],
  unidades: [['anio','area_curricular','grado','seccion','nro_unidad']],
  'resultados_diagnóstico': [['año','area','grado','seccion','estudiante_id','competencia']],
  student_learning_journal: [['student_id','session_id']],
  metas_aprendizaje: [['anio', 'area', 'grado', 'seccion', 'competencia', 'tipo'], ['id']],
  programacion_anual: [['id_programa']],
  unidades_didacticas: [['id_unidad']],
  sesiones: [['id_sesion']],
  programacion_recursos: [['id_programa']],
  estado_modulos: [['id']],
  evaluacion_instrumentos: [['year', 'area_id', 'grade', 'section', 'type', 'name'], ['id']],
  evaluacion_registros: [['student_id', 'session_id', 'criteria_id', 'grading_mode'], ['student_id', 'unit_id', 'criteria_id', 'grading_mode'], ['id']],
  student_achievement_points: [['student_id', 'year', 'bimester', 'unit_number', 'source', 'reference_id', 'created_at'], ['id']],
  interactive_activity_results: [['session_id', 'activity_id', 'scope_type', 'scope_key'], ['id']],
  evaluacion_modos_calificacion: [['year', 'area_id', 'grade', 'section'], ['id']],
  evaluacion_evidencias: [['evidence_key'], ['relative_path'], ['id']],
  evaluacion_configuracion: [['year', 'area_id'], ['id']],
  evaluacion_ventanas_entrega: [['session_id']],
  evaluacion_conclusiones: [['year', 'area_id', 'grade', 'section', 'scope_type', 'scope_value', 'student_id', 'competency_key'], ['id']],
};

const LOCAL_ONLY_COLUMNS = {
  datos_generales: new Set(['path_word_default', 'evidence_storage_path']),
  db_estudiantes: new Set(['password_recovery_cipher', 'id']),
  evaluacion_evidencias: new Set(['file_path', 'id']),
  evaluacion_registros: new Set(['id']),
  evaluacion_instrumentos: new Set(['id']),
  asistencia_registros: new Set(['id']),
  asistencia_rostros: new Set(['id']),
  evaluacion_conclusiones: new Set(['id']),
  student_achievement_points: new Set(['id']),
  interactive_activity_results: new Set(['id']),
  evaluacion_configuracion: new Set(['id']),
  evaluacion_modos_calificacion: new Set(['id']),
  areas_grados_cargo: new Set(['id']),
  db_enfoques: new Set(['id']),
  unidades: new Set(['id']),
  db_egresados: new Set(['id']),
  'resultados_diagnóstico': new Set(['id']),
  metas_aprendizaje: new Set(['id']),
  sesiones: new Set(['id']),
};

// Una ausencia accidental en la base de una PC no debe borrar evidencias de las
// demas. Los borrados deliberados usan el indice portatil y sus tombstones.
const ADDITIVE_TABLES = new Set(['db_estudiantes', 'evaluacion_evidencias']);

// Estos registros son acumulativos y de alto valor. Cada PC publica ademas un
// catalogo compacto con sus filas actuales para que otra PC pueda recuperar una
// fila ausente aunque el evento original no haya terminado de llegar por Drive.
// Los tombstones conocidos siguen teniendo prioridad, por lo que un borrado
// deliberado no se restaura desde un catalogo antiguo.
const RECOVERY_TABLES = new Set(['db_estudiantes', 'evaluacion_evidencias', 'evaluacion_instrumentos']);

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;
const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
};
const hashValue = (value) => crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
const portableRow = (table, row, identity = null) => {
  row = identity ? identity.portable(table, row) : row;
  const excluded = LOCAL_ONLY_COLUMNS[table];
  if (!excluded) return { ...row };
  return Object.fromEntries(Object.entries(row).filter(([column]) => !excluded.has(column)));
};
const hashRow = (table, row, identity = null) => {
  const portable = portableRow(table, row, identity);
  if (table === 'evaluacion_evidencias' && (portable.student_dni || portable.student_names)) {
    delete portable.student_id;
    delete portable.student_ids;
  }
  return hashValue(portable);
};
export const hashPortableIdentityRow = (table,row) => hashRow(table,row);
const exists = (target) => {
  try { fs.accessSync(target); return true; } catch { return false; }
};
const readJson = (target, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch { return fallback; }
};
const listEvidenceTombstoneFiles = (root) => {
  const folder = path.join(root, '.armi-evidence-index', 'tombstones');
  try { return fs.readdirSync(folder).filter(name => name.endsWith('.json')).sort(); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};
const readEvidenceTombstones = async (root, entries) => {
  const folder = path.join(root, '.armi-evidence-index', 'tombstones');
  const keys = new Set();
  for (const entry of entries) {
    // Our immutable deletion filenames already contain the complete key.
    // Protect that evidence even while Drive is still hydrating the JSON;
    // unrelated records must not wait for the placeholder's contents.
    const filenameKey = entry.match(/^(evidence-[a-f0-9]{64})\.json$/)?.[1];
    if (filenameKey) { keys.add(filenameKey); continue; }
    const row = await readJsonAsync(path.join(folder, entry));
    // Do not restore evidence while a deletion placeholder is unreadable.
    if (!row?.evidenceKey) {
      const error = new Error('Drive aun no entrego una ficha de eliminacion de evidencias.');
      error.code = 'ARMI_MIRROR_PENDING';
      throw error;
    }
    keys.add(String(row.evidenceKey));
  }
  return keys;
};
const writeJsonAtomic = async (target, value) => {
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temporary, JSON.stringify(value), 'utf8');
  await fs.promises.rename(temporary, target);
};

const isReliableStudentDni = (value) => /^\d{8}$/.test(String(value || '').trim())
  && !/^(\d)\1{7}$/.test(String(value || '').trim());

const naturalKeyCandidatesForRow = (tableName, row) => {
  const candidates = NATURAL_KEYS[tableName];
  if (tableName !== 'db_estudiantes' || isReliableStudentDni(row?.dni)) return candidates;
  return (candidates || []).filter((columns) => !(columns.length === 1 && columns[0] === 'dni'));
};

const emptyScopeColumns = table => ['evaluacion_instrumentos','evaluacion_modos_calificacion'].includes(table) ? ['grade','section'] : [];
const usableKeyColumns = (row, candidates, primaryKeyColumns, allowEmpty = []) => {
  const options = [...(candidates || []), primaryKeyColumns].filter((item) => Array.isArray(item) && item.length);
  return options.find((columns) => columns.every((column) => (
    Object.prototype.hasOwnProperty.call(row, column)
    && row[column] !== null
    && row[column] !== undefined
    && (String(row[column]).trim() !== '' || allowEmpty.includes(column))
  ))) || [];
};

const inspectSchema = (db, excludedTables) => {
  const excluded = new Set([...(excludedTables || []), SYNC_IDENTITY_TABLE, ...IDENTITY_LOCAL_TABLES]);
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
    .map(({ name }) => name)
    .filter((name) => !excluded.has(name))
    .map((name) => {
      const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all();
      return {
        name,
        columns: columns.map((column) => column.name),
        primaryKeyColumns: columns.filter((column) => Number(column.pk || 0) > 0)
          .sort((left, right) => Number(left.pk) - Number(right.pk))
          .map((column) => column.name),
      };
    });
};

const yieldToServer = () => new Promise((resolve) => setImmediate(resolve));

const captureDatabase = async (db, schema, identity = null) => {
  const tables = {};
  const resolveStudent = evidenceStudentResolverForDatabase(db);
  for (const table of schema) {
    const records = {};
    const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(table.name)}`).all();
    for (let index = 0; index < rows.length; index += 1) {
      let row = table.name === 'evaluacion_evidencias' ? resolveStudent(rows[index]) : rows[index];
      try { row = identity ? identity.portable(table.name, row) : row; } catch (error) {
        if (error.code !== 'ARMI_IDENTITY_PENDING') throw error;
        identity.blockedLocal.push({ table: table.name, localId: rows[index].id, reason: error.message }); continue;
      }
      const keyColumns = usableKeyColumns(row, naturalKeyCandidatesForRow(table.name, row), table.primaryKeyColumns, emptyScopeColumns(table.name));
      if (!keyColumns.length) continue;
      if (keyColumns.length === 1 && typeof row[keyColumns[0]] === 'number'
        && (!NATURAL_KEYS[table.name] || (keyColumns[0] === 'id' && !['datos_generales','estado_modulos'].includes(table.name)))) {
        identity?.blockedLocal.push({ table:table.name,localId:row[keyColumns[0]],reason:'Tabla numerica sin clave portable declarada; no se publica por coincidencia de ID.' });
        continue;
      }
      const keyValues = keyColumns.map((column) => row[column]);
      const key = JSON.stringify([keyColumns, keyValues]);
      const normalizedRow = portableRow(table.name, row);
      const identityPriority = rows[index].student_id == null || String(rows[index].student_id) === String(identity?.local(table.name,row)?.student_id) ? 1 : 0;
      const previous=records[key];
      if(previous && previous.identityPriority>identityPriority) continue;
      if(previous && previous.identityPriority===identityPriority && String(previous.row.updated_at || '')>String(row.updated_at || '')) continue;
      records[key] = { keyColumns, keyValues, hash: hashRow(table.name, normalizedRow), row: normalizedRow, identityPriority };
      if (index > 0 && index % 100 === 0) await yieldToServer();
    }
    tables[table.name] = records;
    await yieldToServer();
  }
  return tables;
};

const captureDump = (dump, schema, identity = null) => {
  const tables = {};
  const references = identity?.legacyCatalog(dump.tables || {});
  schema.forEach((table) => {
    const records = {};
    const rows = Array.isArray(dump?.tables?.[table.name]) ? dump.tables[table.name] : [];
    rows.forEach((original) => {
      let row = original;
      try { row = identity ? identity.portable(table.name, original, references) : original; }
      catch (error) {
        if (error.code !== 'ARMI_IDENTITY_PENDING') throw error;
        identity.blockedLocal.push({ table: table.name, source: 'legacy-dump', reason: error.message }); return;
      }
      const keyColumns = usableKeyColumns(row, naturalKeyCandidatesForRow(table.name, row), table.primaryKeyColumns, emptyScopeColumns(table.name));
      if (!keyColumns.length) return;
      const keyValues = keyColumns.map((column) => row[column]);
      const key = JSON.stringify([keyColumns, keyValues]);
      const normalizedRow = portableRow(table.name, row);
      records[key] = { keyColumns, keyValues, hash: hashRow(table.name, normalizedRow), row: normalizedRow };
    });
    tables[table.name] = records;
  });
  return tables;
};

const compactBaseline = (captured) => Object.fromEntries(
  Object.entries(captured).map(([table, records]) => [
    table,
    Object.fromEntries(Object.entries(records).map(([key, record]) => [key, record.hash])),
  ])
);

// Adding nullable columns during an application upgrade is not a teacher edit.
// Rebase only when all former fields match their saved hash and every added
// field is null/absent. Real edits, non-null defaults and removed columns retain
// the normal conflict protections and are never silently discarded.
const rebaseAddedNullColumns = async (baseline, captured, previousColumns, schema) => {
  if (!previousColumns) return baseline;
  const next = { ...baseline };
  for (const table of schema) {
    const before = previousColumns[table.name];
    if (!Array.isArray(before) || before.some(column => !table.columns.includes(column))) continue;
    const added = table.columns.filter(column => !before.includes(column));
    if (!added.length) continue;
    const allowed = new Set(before);
    let copied = false, checked = 0;
    for (const [key, record] of Object.entries(captured[table.name] || {})) {
      if (++checked % 256 === 0) await yieldToServer();
      if (!next[table.name]?.[key] || added.some(column => record.row[column] != null)) continue;
      const former = Object.fromEntries(Object.entries(record.row).filter(([column]) => allowed.has(column) || column.startsWith('__')));
      if (hashRow(table.name, former) !== next[table.name][key]) continue;
      if (!copied) { next[table.name] = { ...next[table.name] }; copied = true; }
      next[table.name][key] = record.hash;
    }
  }
  return next;
};

const entityId = (table, key) => `${table}:${key}`;
const isIncomingNewer = (incoming, current) => {
  if (!current) return true;
  if (Number(incoming.protocol || 1) !== Number(current.protocol || 1)) return Number(incoming.protocol || 1) > Number(current.protocol || 1);
  if (Number(incoming.version || 0) !== Number(current.version || 0)) {
    return Number(incoming.version || 0) > Number(current.version || 0);
  }
  return String(incoming.deviceId || '').localeCompare(String(current.deviceId || '')) > 0;
};

const evidenceKeyFromPortableKey = (key) => {
  const [columns, values] = readKey(key);
  const evidenceKeyIndex = columns.indexOf('evidence_key');
  if (evidenceKeyIndex >= 0) return String(values[evidenceKeyIndex] || '');
  const relativePathIndex = columns.indexOf('relative_path');
  return relativePathIndex >= 0 ? portableEvidenceKey(values[relativePathIndex]) : '';
};

const isTombstonedEvidenceRecord = (table, key, tombstoneKeys) => table === 'evaluacion_evidencias'
  && tombstoneKeys.has(evidenceKeyFromPortableKey(key));

const createStudentTombstoneIndex = (rows = []) => {
  const index = { ids: new Set(), dnis: new Set() };
  rows.forEach((row) => {
    const id = String(row?.student_id || '').trim();
    const dni = String(row?.dni || '').trim();
    // A tombstone's numeric ID belongs to its origin PC. Only its portable ID
    // can match independently of the machine; a reliable DNI takes priority.
    if (id.startsWith('@student:')) index.ids.add(id);
    if (isReliableStudentDni(dni)) index.dnis.add(dni);
  });
  return index;
};

const addStudentTombstone = (index, row) => {
  const addition = createStudentTombstoneIndex([row]);
  addition.ids.forEach((id) => index.ids.add(id));
  addition.dnis.forEach((dni) => index.dnis.add(dni));
};

const isTombstonedStudentRecord = (table, key, studentTombstones, row = null) => {
  if (table !== 'db_estudiantes') return false;
  const [columns, values] = readKey(key);
  const idIndex = columns.indexOf('id');
  const dniIndex = columns.indexOf('dni');
  const portableIndex = columns.indexOf('__sync_key');
  return (idIndex >= 0 && studentTombstones.ids.has(String(values[idIndex] ?? '').trim()))
    || (portableIndex >= 0 && studentTombstones.ids.has(String(values[portableIndex] ?? '')))
    || (dniIndex >= 0 && studentTombstones.dnis.has(String(values[dniIndex] ?? '').trim()))
    || studentTombstones.ids.has(String(row?.id ?? '').trim())
    || studentTombstones.dnis.has(String(row?.dni ?? '').trim());
};

const isTombstonedAdditiveRecord = (table, key, evidenceTombstoneKeys, studentTombstones, row = null) => (
  isTombstonedEvidenceRecord(table, key, evidenceTombstoneKeys)
  || isTombstonedStudentRecord(table, key, studentTombstones, row)
);

const removeTombstonedStudents = (db, studentTombstones, identity) => {
  if (!studentTombstones.ids.size && !studentTombstones.dnis.size) return 0;
  const rows = db.prepare('SELECT id, dni FROM db_estudiantes').all();
  const ids = rows
    .filter((row) => studentTombstones.ids.has(identity?.catalog().students[String(row.id)]?.token)
      || studentTombstones.dnis.has(String(row.dni ?? '').trim()))
    .map((row) => row.id);
  if (!ids.length) return 0;
  const remove = db.prepare('DELETE FROM db_estudiantes WHERE id = ?');
  ids.forEach((id) => remove.run(id));
  return ids.length;
};

const buildOperations = ({ captured, baseline, versions, deviceId, includeDeletes, tombstoneKeys = new Set(), studentTombstones = createStudentTombstoneIndex() }) => {
  const operations = [];
  Object.entries(captured).forEach(([table, records]) => {
    const previous = baseline?.[table] || {};
    Object.entries(records).forEach(([key, record]) => {
      if (previous[key] === record.hash) return;
      const id = entityId(table, key);
      const version = Number(versions[id]?.version || 0) + 1;
      operations.push({
        table,
        key,
        keyColumns: record.keyColumns,
        keyValues: record.keyValues,
        action: 'upsert',
        row: record.row,
        rowHash: record.hash,
        version,
        deviceId,
      });
    });
    if (!includeDeletes) return;
    Object.keys(previous).forEach((key) => {
      if (records[key]) return;
      if (ADDITIVE_TABLES.has(table) && !isTombstonedAdditiveRecord(table, key, tombstoneKeys, studentTombstones)) return;
      const [keyColumns, keyValues] = readKey(key);
      if (!keyColumns.length) return;
      const id = entityId(table, key);
      const version = Number(versions[id]?.version || 0) + 1;
      operations.push({ table, key, keyColumns, keyValues, action: 'delete', version, deviceId });
    });
  });
  return operations;
};

const readKey = (key) => {
  try {
    const parsed = JSON.parse(key);
    return Array.isArray(parsed) && Array.isArray(parsed[0]) && Array.isArray(parsed[1]) ? parsed : [[], []];
  } catch {
    return [[], []];
  }
};

const whereForOperation = (operation, allowedColumns) => {
  const columns = Array.isArray(operation.keyColumns)
    ? operation.keyColumns.filter((column) => allowedColumns.has(column))
    : [];
  if (!columns.length || columns.length !== operation.keyValues?.length) return null;
  return {
    clause: columns.map((column) => `${quoteIdentifier(column)} IS ?`).join(' AND '),
    values: operation.keyValues,
  };
};

const prepareCached = (db, cache, sql) => {
  if (!cache) return db.prepare(sql);
  if (!cache.has(sql)) cache.set(sql, db.prepare(sql));
  return cache.get(sql);
};
const evidenceResolverCacheKey = Symbol('evidenceStudentResolver');
const cachedEvidenceResolver = (db, cache) => {
  if (!cache) return evidenceStudentResolverForDatabase(db);
  if (!cache.has(evidenceResolverCacheKey)) cache.set(evidenceResolverCacheKey, evidenceStudentResolverForDatabase(db));
  return cache.get(evidenceResolverCacheKey);
};

const applyOperation = (db, operation, tableSchema, statementCache = null, identity = null) => {
  const portableOperation = operation;
  operation = identity ? identity.localOperation(operation) : operation;
  if (operation.table === 'db_estudiantes') statementCache?.delete(evidenceResolverCacheKey);
  const allowedColumns = new Set(tableSchema.columns);
  const where = whereForOperation(operation, allowedColumns);
  if (!where) return false;
  const table = quoteIdentifier(operation.table);
  const existing = prepareCached(db, statementCache, `SELECT * FROM ${table} WHERE ${where.clause} LIMIT 1`).get(...where.values);
  if (operation.action === 'delete') {
    if (existing) prepareCached(db, statementCache, `DELETE FROM ${table} WHERE ${where.clause}`).run(...where.values);
    identity?.didApply(portableOperation);
    return true;
  }
  if (!operation.row || typeof operation.row !== 'object') return false;
  if (operation.table === 'evaluacion_evidencias') {
    operation = { ...operation, row: cachedEvidenceResolver(db, statementCache)(operation.row) };
  }
  const primaryKeys = new Set(tableSchema.primaryKeyColumns);
  if (existing) {
    if (operation.table==='db_estudiantes' && operation.row.password_hash && operation.row.password_hash!==existing.password_hash) {
      if(allowedColumns.has('password_recovery_cipher')) operation.row.password_recovery_cipher=null;
      if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='portal_sesiones_estudiantes'").get()) db.prepare('DELETE FROM portal_sesiones_estudiantes WHERE student_id=?').run(String(existing.id));
    }
    const columns = Object.keys(operation.row).filter((column) => allowedColumns.has(column) && !primaryKeys.has(column));
    if (!columns.length) return true;
    prepareCached(db, statementCache, `UPDATE ${table} SET ${columns.map((column) => `${quoteIdentifier(column)} = ?`).join(', ')} WHERE ${where.clause}`)
      .run(...columns.map((column) => operation.row[column] ?? null), ...where.values);
    identity?.didApply(portableOperation);
    return true;
  }
  let columns = Object.keys(operation.row).filter((column) => allowedColumns.has(column));
  // Con claves naturales, no se reutiliza un AUTOINCREMENT de otra PC: podría
  // pertenecer a un registro diferente creado simultáneamente.
  const usesNaturalKey = operation.keyColumns.some((column) => !primaryKeys.has(column));
  if (usesNaturalKey) {
    const collidingPrimaryKeys = new Set();
    tableSchema.primaryKeyColumns.forEach((column) => {
      const value = operation.row[column];
      if (value === null || value === undefined) return;
      const collision = prepareCached(db, statementCache, `SELECT 1 FROM ${table} WHERE ${quoteIdentifier(column)} IS ? LIMIT 1`).get(value);
      if (collision) collidingPrimaryKeys.add(column);
    });
    columns = columns.filter((column) => !collidingPrimaryKeys.has(column));
  }
  if (!columns.length) return false;
  const inserted = prepareCached(db, statementCache, `INSERT INTO ${table} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...columns.map((column) => operation.row[column] ?? null));
  identity?.didApply(portableOperation, inserted.lastInsertRowid);
  return true;
};

export const exportPortableIdentitySnapshot = async (db, { legacyAliases = {} } = {}) => {
  const selected=new Set([...IDENTITY_PARENT_TABLES,...IDENTITY_REPLACED_TABLES]);
  const schema=inspectSchema(db,[]).filter(table=>selected.has(table.name));
  const identity=createSyncReferenceIdentity(db,{legacyAliases});
  const captured=await captureDatabase(db,schema,identity);
  const tables=Object.fromEntries(Object.entries(captured).map(([table,records])=>[table,Object.entries(records).map(([key,record])=>({
    table,key,keyColumns:record.keyColumns,keyValues:record.keyValues,row:record.row,rowHash:record.hash,action:'upsert'
  }))]));
  return {format:2,tables,references:identity.catalog(),unresolved:[...new Map(identity.blockedLocal.map(item=>[JSON.stringify(item),item])).values()]};
};

const importIdentitySnapshot = (db,payload,policy) => {
  const snapshot=payload.snapshot;
  if(snapshot?.format!==2 || !snapshot.tables) throw new Error('La migracion no contiene una instantanea portable.');
  const allowed=new Set([...IDENTITY_PARENT_TABLES,...IDENTITY_REPLACED_TABLES]);
  if(Object.keys(snapshot.tables).some(table=>!allowed.has(table))) throw new Error('La migracion incluye una tabla no autorizada.');
  const schema=new Map(inspectSchema(db,[]).map(table=>[table.name,table]));
  const identity=createSyncReferenceIdentity(db),cache=new Map();
  const normalize=value=>String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const roster=db.prepare('SELECT * FROM db_estudiantes').all();
  // Missing-DNI identities may be adopted only during this verified migration,
  // with a unique full name/group and the source roster included in its policy.
  for(const record of snapshot.tables.db_estudiantes || []) {
    const ref=record.row.__studentIdentity;
    if(ref?.dni && /^\d{8}$/.test(ref.dni)) continue;
    const matches=roster.filter(row=>normalize(row.estudiantes)===normalize(ref?.name) && String(row.grado || '')===ref?.grade && String(row.secc || '')===ref?.section);
    if(matches.length!==1) continue;
    const proof=(policy?.roster || []).some(row=>String(row.id)===String(matches[0].id) && normalize(row.estudiantes)===normalize(ref.name)
      && String(row.grado || '')===ref.grade && String(row.secc || '')===ref.section);
    if(!proof) throw new Error('Falta verificar la identidad sin DNI de esta computadora.');
    identity.adoptStudent(matches[0].id,ref.token);
  }
  const applyTable=table=>{
    if(!schema.has(table)) {if(snapshot.tables[table]?.length) throw new Error(`Falta la tabla ${table}.`);return;}
    identity.deferRefresh(()=>{
      for(const operation of snapshot.tables[table] || []) {
        if(operation.table!==table || operation.action!=='upsert') throw new Error('Operacion no valida en la migracion.');
        const expected=usableKeyColumns(operation.row,naturalKeyCandidatesForRow(table,operation.row),schema.get(table).primaryKeyColumns,emptyScopeColumns(table));
        if(JSON.stringify(expected)!==JSON.stringify(operation.keyColumns)) throw new Error('La migracion contiene una clave local no portable.');
        if(!applyOperation(db,{...operation,references:snapshot.references},schema.get(table),cache,identity)) throw new Error('No se pudo incorporar una fila verificada.');
      }
    });
  };
  IDENTITY_PARENT_TABLES.forEach(applyTable);
  for(const table of IDENTITY_REPLACED_TABLES) if(snapshot.tables[table] && schema.has(table)) db.prepare(`DELETE FROM ${quoteIdentifier(table)}`).run();
  IDENTITY_REPLACED_TABLES.forEach(applyTable);
  if(schema.has('evaluacion_instrumentos')) {
    for(const row of db.prepare('SELECT * FROM evaluacion_instrumentos').all()) {
      if(row.year && row.area_id && row.type && row.name) continue;
      const used=schema.has('evaluacion_registros') && db.prepare('SELECT 1 FROM evaluacion_registros WHERE instrument_id=? LIMIT 1').get(row.id);
      if(!used) db.prepare('DELETE FROM evaluacion_instrumentos WHERE id=?').run(row.id);
    }
    identity.refresh();
  }
  if(schema.has('armi_frontend_state')) {
    db.prepare("DELETE FROM armi_frontend_state WHERE key LIKE 'armi_register_conclusions_%' OR key='armi_hybrid_numeric_scores_v1'").run();
    const caches=new Map();
    caches.set('armi_fast_session_index_v1',{});
    const scores={};
    for(const row of db.prepare("SELECT * FROM evaluacion_registros WHERE grading_mode='hybrid_vigesimal' ORDER BY updated_at,id").all()) {
      if(row.numeric_score!=null) scores[`${row.session_id}::${row.student_id}::${row.criteria_id}`]=Number(row.numeric_score);
    }
    caches.set('armi_hybrid_numeric_scores_v1',scores);
    for(const row of db.prepare('SELECT * FROM evaluacion_conclusiones').all()) {
      const key=`armi_register_conclusions_${row.scope_type}_${row.year}_${row.area_id}_${row.grade}_${row.section}_${row.scope_value}`;
      if(!caches.has(key)) caches.set(key,{});
      caches.get(key)[`${row.student_id}::${row.competency_key}`]=row.conclusion_text || '';
    }
    const put=db.prepare('INSERT INTO armi_frontend_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at');
    for(const [key,value] of caches) put.run(key,JSON.stringify(value),payload.createdAt || '2000-01-01T00:00:00.000Z');
  }
  // Validate every imported relationship before committing the transaction.
  for(const [table,records] of Object.entries(snapshot.tables)) for(const operation of records) {
    const where=whereForOperation(identity.localOperation({...operation,references:snapshot.references}),new Set(schema.get(table).columns));
    const row=where && db.prepare(`SELECT * FROM ${quoteIdentifier(table)} WHERE ${where.clause} LIMIT 1`).get(...where.values);
    if(!row || hashRow(table,row,identity)!==operation.rowHash) throw new Error(`La verificacion posterior de ${table} no coincide; se revierte toda la migracion.`);
  }
};

const listEventFiles = (incrementalRoot) => {
  const devicesRoot = path.join(incrementalRoot, 'devices');
  if (!exists(devicesRoot)) return [];
  const files = [];
  fs.readdirSync(devicesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).forEach((device) => {
    const eventsRoot = path.join(devicesRoot, device.name, 'events');
    if (!exists(eventsRoot)) return;
    fs.readdirSync(eventsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .forEach((entry) => files.push(path.join(eventsRoot, entry.name)));
  });
  return files.sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
};

// Drive directory enumeration can take seconds even when every file is
// synchronized. Keep it off the HTTP event loop, including status polling.
const readDirectory = async folder => {
  try { return await fs.promises.readdir(folder,{withFileTypes:true}); }
  catch(error) { if(error.code==='ENOENT') return []; throw error; }
};
const listEventFilesAsync = async incrementalRoot => {
  const root=path.join(incrementalRoot,'devices');
  const files=[];
  for(const device of (await readDirectory(root)).filter(entry=>entry.isDirectory())) {
    const folder=path.join(root,device.name,'events');
    for(const entry of await readDirectory(folder)) if(entry.isFile() && entry.name.endsWith('.json')) files.push(path.join(folder,entry.name));
  }
  return files.sort((left,right)=>path.basename(left).localeCompare(path.basename(right)));
};
const listRecoveryCatalogsAsync = async incrementalRoot => {
  const folder=path.join(incrementalRoot,'recovery');
  const files=[];
  for(const entry of await readDirectory(folder)) {
    if(!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file=path.join(folder,entry.name);
    try { const stats=await fs.promises.stat(file);files.push({file,signature:`${entry.name}:${stats.size}:${stats.mtimeMs}`}); }
    catch(error) {if(error.code!=='ENOENT')throw error;}
  }
  return files;
};
const listTombstonesAsync = async root => (await readDirectory(path.join(root,'.armi-evidence-index','tombstones')))
  .filter(entry=>entry.isFile() && entry.name.endsWith('.json')).map(entry=>entry.name).sort();

const eventSetSignature = (files) => crypto
  .createHash('sha256')
  // Published batches have unique, immutable names and are written atomically.
  // statSync on every historical Drive placeholder blocked the HTTP server for
  // seconds. Unreadable/unapplied batches stay pending and never enter fast state.
  .update('immutable-event-names-v1|')
  .update(files.map((file) => path.basename(file)).sort().join('|'))
  .digest('hex')
  .slice(0, 20);

const buildRecoveryCatalog = (captured, deviceId, identity = null) => {
  const tables = {};
  RECOVERY_TABLES.forEach((table) => {
    tables[table] = Object.entries(captured?.[table] || {}).map(([key, record]) => ({
      key,
      keyColumns: record.keyColumns,
      keyValues: record.keyValues,
      rowHash: record.hash,
      row: record.row,
    }));
  });
  const digest = hashValue({ tables, references: identity?.catalog() });
  return { format: FORMAT, deviceId, generatedAt: new Date().toISOString(), digest, tables, ...(identity ? { references: identity.catalog() } : {}) };
};

const listRecoveryCatalogs = (incrementalRoot) => {
  const recoveryRoot = path.join(incrementalRoot, 'recovery');
  if (!exists(recoveryRoot)) return [];
  return fs.readdirSync(recoveryRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      const file = path.join(recoveryRoot, entry.name);
      const stats = fs.statSync(file);
      return { file, signature: `${entry.name}:${stats.size}:${stats.mtimeMs}` };
    });
};

const recoverySetSignature = (catalogs) => crypto
  .createHash('sha256')
  .update('recovery-catalogs-v1|')
  .update(catalogs.map((catalog) => catalog.signature).sort().join('|'))
  .digest('hex')
  .slice(0, 20);

const recoveryOperationsFromCatalogs = ({ catalogs, captured, versions, tombstoneKeys = new Set(), studentTombstones = createStudentTombstoneIndex() }) => {
  const operations = [];
  const queued = new Set();
  catalogs.forEach((catalog) => {
    RECOVERY_TABLES.forEach((table) => {
      const localRecords = captured?.[table] || {};
      const rows = Array.isArray(catalog.tables?.[table]) ? catalog.tables[table] : [];
      rows.forEach((record) => {
        const recoveryId = `${table}:${record?.key || ''}`;
        if (!record?.key || localRecords[record.key] || queued.has(recoveryId)) return;
        if (isTombstonedAdditiveRecord(table, record.key, tombstoneKeys, studentTombstones, record.row)) return;
        const currentVersion = versions?.[entityId(table, record.key)];
        if (currentVersion?.deleted) return;
        operations.push({
          table,
          key: record.key,
          keyColumns: record.keyColumns,
          keyValues: record.keyValues,
          action: 'upsert',
          row: record.row,
          rowHash: record.rowHash || hashValue(record.row || {}),
          version: Number(currentVersion?.version || 0),
          deviceId: String(currentVersion?.deviceId || catalog.deviceId || 'recovery-catalog'),
        });
        queued.add(recoveryId);
      });
    });
  });
  return operations;
};

export const createIncrementalMirrorSync = ({ db, runtimeFolder, excludedTables = [], getDeviceId, getSourceSignature = null, getBootstrapSeed = null, maintenanceOptions = {}, isMaintenanceAllowed = () => true }) => {
  const statePath = path.join(runtimeFolder, 'incremental-identity-state.json');
  const legacyStatePath = path.join(runtimeFolder, 'incremental-mirror-state.json');
  const fastStatePath = path.join(runtimeFolder, 'incremental-identity-fast-state.json');
  const publicationPath = path.join(runtimeFolder, 'incremental-pending-publication.json');
  const delivery = createDeliveryReceipts({ readJson: readJsonAsync, writeJson: writeJsonAtomic });
  const maintenance = createSyncHistoryMaintenance({ runtimeFolder, readJson: readJsonAsync, writeJson: writeJsonAtomic, options: maintenanceOptions });
  let auxiliaryTask = null, currentPublication = null, currentMirrorPath = null, auxiliaryEpoch = 0;
  const refreshAuxiliary = (mirrorPath, state, eventFiles, canAcknowledge) => {
    currentPublication = state.lastPublication || null;
    if (auxiliaryTask) return;
    const eventSignature = eventSetSignature(eventFiles);
    const epoch = auxiliaryEpoch;
    auxiliaryTask = (async () => {
      try {
        const applied = new Set(state.appliedBatches || []);
        canAcknowledge = canAcknowledge && eventFiles.every(file => applied.has(path.basename(file, '.json')));
        const status = await delivery.refresh({ mirrorPath, state, eventSignature, eventCount: eventFiles.length, canAcknowledge });
        if (canAcknowledge) await maintenance.tick({ mirrorPath, eventFiles, eventSignature,
          applied: new Set(state.appliedBatches || []), peers: status.peers, deviceId: state.deviceId,
          protectedBatchIds: state.lastPublication ? [state.lastPublication.batchId] : [],
          canRetire: () => auxiliaryEpoch === epoch && currentMirrorPath === mirrorPath && isMaintenanceAllowed(mirrorPath) });
      } catch { /* Delivery confirmation is conservative and never blocks local saves. */ }
    })().finally(() => { auxiliaryTask = null; });
    // On a normal local filesystem the receipt is ready before returning. A
    // stalled Drive provider cannot hold publication of the next edit hostage.
    let timer;
    return Promise.race([auxiliaryTask, new Promise(resolve => { timer = setTimeout(resolve, 150); })])
      .finally(() => clearTimeout(timer));
  };
  // Write ahead locally: retry the SAME immutable batch if either Drive or the
  // checkpoint fails. Receiving remote changes must not undo a completed send.
  const finishPublication = async (mirrorPath, deviceId) => {
    let pending;
    try { pending = JSON.parse(await fs.promises.readFile(publicationPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (pending.mirrorPath !== path.resolve(mirrorPath) || pending.batch?.deviceId !== deviceId
      || !pending.batch?.batchId || path.basename(pending.batch.batchId) !== pending.batch.batchId
      || !pending.state?.appliedBatches?.includes(pending.batch.batchId)) {
      throw new Error('La publicacion pendiente no corresponde a esta carpeta o equipo; se conserva para revision.');
    }
    const target = path.join(mirrorPath, '.armi-sync', 'incremental-v1', 'devices', deviceId, 'events', `${pending.batch.batchId}.json`);
    await writeJsonAtomic(target, pending.batch);
    await writeJsonAtomic(statePath, pending.state);
    await fs.promises.rm(publicationPath);
  };
  const publishCheckpoint = async (mirrorPath, deviceId, batch, state) => {
    await yieldToServer();
    state.lastPublication = { batchId: batch.batchId, sha256: batchContentHash(batch), createdAt: batch.createdAt };
    recordIncorporatedHead(state, batch, state.lastPublication.sha256);
    await yieldToServer();
    await writeJsonAtomic(publicationPath, { mirrorPath: path.resolve(mirrorPath), batch, state });
    await finishPublication(mirrorPath, deviceId);
    currentPublication = state.lastPublication;
    return { lastPublication: state.lastPublication, deliveryHeads: state.deliveryHeads };
  };
  const statementCache = new Map();
  let inventoryRead = null;
  let inventoryCache = null;
  const checkpointCache = new Map();
  const inspectCheckpoint = file => {
    try {
      const stats=fs.statSync(file), signature=`${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
      if(checkpointCache.get(file)?.signature===signature) return checkpointCache.get(file).value;
      const value=readJson(file,null);checkpointCache.set(file,{signature,value});return value;
    } catch {checkpointCache.delete(file);return null;}
  };
  const readInventory = async mirrorPath => {
    const wait = async promise => {
      let timer;
      try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{
        const error=new Error('La lectura del historial de sincronización sigue en curso; el servicio local permanece disponible.');
        error.syncTask={kind:'sync-inventory',label:'Revisando historial de sincronización',detail:error.message,requiresAction:false};
        error.code='ARMI_MIRROR_PENDING';reject(error);
      },2000);})]); } finally {clearTimeout(timer);}
    };
    if(inventoryCache?.mirrorPath===mirrorPath && Date.now()-inventoryCache.at<1000) return inventoryCache.value;
    if(inventoryRead?.mirrorPath===mirrorPath) return wait(inventoryRead.promise);
    const promise=(async()=>{
      const root=path.join(mirrorPath,'.armi-sync','incremental-v1');
      // One directory operation at a time reserves filesystem workers for local
      // saves when the Drive provider leaves a native read stalled.
      const eventFiles=await listEventFilesAsync(root);
      const recoveryFiles=await listRecoveryCatalogsAsync(root);
      const tombstoneFiles=await listTombstonesAsync(path.join(mirrorPath,'Evidencias de estudiantes'));
      const value={eventFiles,recoveryFiles,tombstoneFiles};inventoryCache={mirrorPath,at:Date.now(),value};return value;
    })();
    const read={mirrorPath,promise};inventoryRead=read;
    const done=()=>{if(inventoryRead===read)inventoryRead=null;};promise.then(done,done);
    return wait(promise);
  };
  let running = false;
  let publicState = {
    enabled: false,
    state: 'inactive',
    message: 'La sincronizacion incremental esta inactiva.',
    pendingOperations: 0,
    updatedAt: null,
  };
  const setPublicState = (patch) => {
    publicState = { ...publicState, ...patch, updatedAt: new Date().toISOString() };
  };

  const run = async ({ mirrorPath, mirrorDatabaseDumpPath = '' } = {}) => {
    if (running) return { success: true, data: { ...publicState, alreadyRunning: true } };
    running = true;
    publicState.identityMigrationApplied=false;
    publicState.pendingTask=null;
    try {
      if (!mirrorPath || !exists(mirrorPath)) {
        setPublicState({ enabled: true, state: 'unavailable', message: 'La carpeta espejo no esta disponible.', pendingOperations: 0 });
        return { success: false, message: publicState.message, data: { ...publicState } };
      }
      const deviceId = getDeviceId();
      if (currentMirrorPath !== mirrorPath) { currentMirrorPath = mirrorPath; auxiliaryEpoch++; }
      await finishPublication(mirrorPath, deviceId);
      const incrementalRoot = path.join(mirrorPath, '.armi-sync', 'incremental-v1');
      const eventsRoot = path.join(incrementalRoot, 'devices', deviceId, 'events');
      const recoveryRoot = path.join(incrementalRoot, 'recovery');
      fs.mkdirSync(eventsRoot, { recursive: true });
      const {eventFiles,recoveryFiles,tombstoneFiles}=await readInventory(mirrorPath);
      const currentEventSetSignature = eventSetSignature(eventFiles);
      const currentRecoverySetSignature = recoverySetSignature(recoveryFiles);
      const evidenceRoot = path.join(mirrorPath, 'Evidencias de estudiantes');
      const currentTombstoneSetSignature = hashValue(tombstoneFiles);
      let sourceSignature = typeof getSourceSignature === 'function' ? String(getSourceSignature() || '') : '';
      let saved = readJson(statePath, null) || readJson(legacyStatePath, null);
      const migration = await applyPreparedIdentityMigration({ db,runtimeFolder,mirrorPath,deviceId,saved,
        importSnapshot:(payload,policy)=>importIdentitySnapshot(db,payload,policy) });
      saved=migration.saved;
      if(migration.applied) { statementCache.clear(); sourceSignature=typeof getSourceSignature==='function'?String(getSourceSignature() || ''):''; }
      const fastState = readJson(fastStatePath, null);
      if (saved?.initialized && saved.schemaColumns && saved.identityRevision === IDENTITY_REVISION && fastState?.format === FORMAT
        && fastState.identityRevision === IDENTITY_REVISION
        && sourceSignature
        && fastState.lastSourceSignature === sourceSignature
        && fastState.eventSetSignature === currentEventSetSignature
        && fastState.recoverySetSignature === currentRecoverySetSignature
        && fastState.tombstoneSetSignature === currentTombstoneSetSignature) {
        await refreshAuxiliary(mirrorPath, saved, eventFiles, true);
        const savedConflictCount = Number(fastState.conflicts || 0);
        setPublicState({
          enabled: true,
          state: 'in-sync',
          message: 'Todos los cambios incrementales visibles estan incorporados.',
          pendingOperations: 0,
          publishedOperations: 0,
          appliedOperations: 0,
          conflicts: savedConflictCount,
          lastSuccessAt: new Date().toISOString(),
        });
        return { success: true, data: { ...publicState, fastCheck: true } };
      }
      // An old database may already contain relationships copied with another
      // machine's numbers. Publishing a fresh identity label would bless that
      // corruption. Preserve it and require reconciliation before upgrading.
      if (saved?.initialized && saved.identityRevision !== IDENTITY_REVISION
        && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='db_estudiantes'").get()) {
        const local = db.prepare('SELECT id,dni FROM db_estudiantes').all();
        const mismatches = [];
        for (const entry of recoveryFiles) {
          const catalog = await readJsonAsync(entry.file,null);
          if (catalog?.format !== FORMAT || catalog.deviceId === deviceId) continue;
          for (const [remoteId,reference] of Object.entries(catalog.references?.students || {})) {
            const matches = local.filter(row => isReliableStudentDni(reference.dni) && String(row.dni) === reference.dni);
            if (matches.length === 1 && String(matches[0].id) !== remoteId) mismatches.push({ dni:reference.dni,localId:matches[0].id,sourceId:remoteId,source:catalog.deviceId });
          }
        }
        if (mismatches.length) {
          await writeJsonAtomic(path.join(runtimeFolder,'sync-identity-migration-review.json'), { createdAt:new Date().toISOString(), mismatches });
          const error = new Error('Esta PC conserva identificadores antiguos diferentes. Se requiere reconciliar su copia antes de publicar; no se enviaron ni reemplazaron sus registros.');
          error.code = 'ARMI_IDENTITY_PENDING'; throw error;
        }
      }
      const appliedBeforeRun = new Set(Array.isArray(saved?.appliedBatches) ? saved.appliedBatches : []);
      const unseenEventFiles = eventFiles
        .filter((file) => !appliedBeforeRun.has(path.basename(file, '.json')));
      if (saved?.initialized
        && saved.schemaColumns
        && saved.identityRevision === IDENTITY_REVISION
        && !saved.legacyBootstrapPending
        && sourceSignature
        && saved.lastSourceSignature === sourceSignature
        && unseenEventFiles.length === 0
        && fastState?.recoverySetSignature === currentRecoverySetSignature
        && fastState?.tombstoneSetSignature === currentTombstoneSetSignature) {
        await refreshAuxiliary(mirrorPath, saved, eventFiles, true);
        const savedConflictCount = Array.isArray(saved.conflicts) ? saved.conflicts.length : 0;
        await writeJsonAtomic(fastStatePath, {
          format: FORMAT,
          identityRevision: IDENTITY_REVISION,
          lastSourceSignature: sourceSignature,
          eventSetSignature: currentEventSetSignature,
          recoverySetSignature: currentRecoverySetSignature,
          tombstoneSetSignature: currentTombstoneSetSignature,
          conflicts: savedConflictCount,
          updatedAt: new Date().toISOString(),
        });
        setPublicState({
          enabled: true,
          state: 'in-sync',
          message: 'Todos los cambios incrementales visibles estan incorporados.',
          pendingOperations: 0,
          publishedOperations: 0,
          appliedOperations: 0,
          conflicts: savedConflictCount,
          lastSuccessAt: new Date().toISOString(),
        });
        return { success: true, data: { ...publicState, fastCheck: true } };
      }
      if (saved?.identityRevision !== IDENTITY_REVISION && db.name && db.name !== ':memory:') {
        const backupFolder = path.join(runtimeFolder,'identity-upgrade-backups');
        await fs.promises.mkdir(backupFolder,{ recursive:true });
        const backupPath = path.join(backupFolder,`before-identity-v${IDENTITY_REVISION}.db`);
        if (!exists(backupPath)) {
          const temporary = `${backupPath}.tmp`;
          await db.backup(temporary);
          await fs.promises.rename(temporary,backupPath);
          if (saved) await writeJsonAtomic(`${backupPath}.state.json`,saved);
        }
      }
      const identity = createSyncReferenceIdentity(db);
      const schema = inspectSchema(db, excludedTables);
      statementCache.delete(evidenceResolverCacheKey);
      const identityRepairs = planEvidenceStudentRepairs(db);
      if (identityRepairs.length) {
        await writeJsonAtomic(path.join(runtimeFolder, 'evidence-identity-repairs', `${Date.now()}-${crypto.randomUUID()}.json`), identityRepairs);
        applyEvidenceStudentRepairs(db, identityRepairs);
      }
      const schemaByName = new Map(schema.map((table) => [table.name, table]));
      const needsLegacyBootstrap = !saved?.initialized || saved.legacyBootstrapPending;
      const legacyDumpExists = needsLegacyBootstrap && mirrorDatabaseDumpPath && exists(mirrorDatabaseDumpPath);
      const initialMirrorDump = legacyDumpExists ? await readJsonAsync(mirrorDatabaseDumpPath, null) : null;
      const legacyBootstrapPending = Boolean(legacyDumpExists && !initialMirrorDump?.tables);
      const tombstoneKeys = await readEvidenceTombstones(evidenceRoot, tombstoneFiles);
      const studentTombstones = createStudentTombstoneIndex(
        schemaByName.has('student_deletion_tombstones')
          ? db.prepare('SELECT student_id, dni FROM student_deletion_tombstones').all().map(row => {
            try { return identity.portable('student_deletion_tombstones',row); }
            catch (error) { if (error.code !== 'ARMI_IDENTITY_PENDING') throw error; return { dni:row.dni }; }
          })
          : []
      );
      if (schemaByName.has('db_estudiantes')) {
        db.transaction(() => removeTombstonedStudents(db, studentTombstones, identity))();
        identity.refresh();
      }
      let localBeforeRemote = await captureDatabase(db, schema, identity);
      const tombstonedLocalRecords = Object.entries(localBeforeRemote.evaluacion_evidencias || {})
        .filter(([key]) => isTombstonedEvidenceRecord('evaluacion_evidencias', key, tombstoneKeys));
      if (tombstonedLocalRecords.length) {
        const evidenceSchema = schemaByName.get('evaluacion_evidencias');
        const removeTombstoned = db.transaction(() => {
          tombstonedLocalRecords.forEach(([key]) => {
            const [keyColumns, keyValues] = readKey(key);
            const where = whereForOperation({ keyColumns, keyValues }, new Set(evidenceSchema?.columns || []));
            if (where) db.prepare(`DELETE FROM ${quoteIdentifier('evaluacion_evidencias')} WHERE ${where.clause}`).run(...where.values);
          });
        });
        removeTombstoned();
        localBeforeRemote = await captureDatabase(db, schema, identity);
      }
      const initialMirrorCaptured = initialMirrorDump?.tables ? captureDump(initialMirrorDump, schema, identity) : null;
      const seedDump = needsLegacyBootstrap && getBootstrapSeed
        ? await getBootstrapSeed() : null;
      const seed = seedDump?.tables ? captureDump(seedDump, schema, identity) : null;
      const isUnchangedSeed = (table, key) => !!seed?.[table]?.[key]
        && localBeforeRemote[table]?.[key]?.hash === seed[table][key].hash;
      const baselineBeforeSchema = saved?.initialized && saved.identityRevision === IDENTITY_REVISION
        ? (saved.baseline || {})
        : initialMirrorCaptured
          ? compactBaseline(initialMirrorCaptured)
          : {};
      const baseline = await rebaseAddedNullColumns(baselineBeforeSchema, localBeforeRemote, saved?.schemaColumns, schema);
      const state = {
        format: FORMAT,
        identityRevision: IDENTITY_REVISION,
        ...(saved?.identityMigrationId ? {identityMigrationId:saved.identityMigrationId} : {}),
        legacyBootstrapPending,
        initialized: true,
        deviceId,
        sequence: Number(saved?.sequence || 0),
        baseline,
        versions: saved?.versions || {},
        appliedBatches: Array.isArray(saved?.appliedBatches) ? saved.appliedBatches : [],
        conflicts: Array.isArray(saved?.conflicts) ? saved.conflicts.slice(-100) : [],
        deliveryHeads: saved?.deliveryHeads || {},
        lastPublication: saved?.lastPublication || null,
        schemaColumns: Object.fromEntries(schema.map(table => [table.name, table.columns])),
      };
      // Earlier clients identified grades by a PC's AUTOINCREMENT id whenever
      // instrument_id was null. Republish those rows once with their shared key.
      if (Number(saved?.identityRevision || 0) < 2) {
        state.baseline.evaluacion_registros = {};
        let reviewedGrades = 0;
        for (const [key, record] of Object.entries(localBeforeRemote.evaluacion_registros || {})) {
          if (++reviewedGrades % 64 === 0) await yieldToServer();
          const where = whereForOperation(identity.localOperation({ ...record, table: 'evaluacion_registros' }), new Set(schemaByName.get('evaluacion_registros').columns));
          const raw = prepareCached(db, statementCache, `SELECT * FROM evaluacion_registros WHERE ${where.clause} LIMIT 1`).get(...where.values);
          const oldColumns = usableKeyColumns(raw, [['student_id', 'session_id', 'unit_id', 'instrument_id', 'criteria_id'], ['id']], ['id']);
          const oldKey = JSON.stringify([oldColumns, oldColumns.map(column => raw[column])]);
          // Keep each student's own clock; a frequently edited unrelated grade
          // must not cause a stale row to outrank newer changes from another PC.
          const version = Math.max(Number(state.versions[entityId('evaluacion_registros', key)]?.version || 0),
            Number(state.versions[entityId('evaluacion_registros', oldKey)]?.version || 0));
          state.versions[entityId('evaluacion_registros', key)] = { version, deviceId, rowHash: record.hash };
        }
      }
      setPublicState({ enabled: true, state: 'syncing', message: 'Preparando cambios pequeños para la carpeta espejo.' });
      const operations = buildOperations({
        captured: localBeforeRemote,
        baseline: state.baseline,
        versions: state.versions,
        deviceId,
        includeDeletes: saved?.initialized === true,
        tombstoneKeys,
        studentTombstones,
      }).filter((operation) => !isUnchangedSeed(operation.table, operation.key)
        && !(operation.action === 'delete' && identity.blockedLocal.some(item => item.table === operation.table)));
      await yieldToServer();
      if (operations.length) {
        state.sequence += 1;
        const batchId = `${Date.now()}-${String(state.sequence).padStart(8, '0')}-${deviceId}-${crypto.randomUUID().slice(0, 8)}`;
        const batch = { format: FORMAT, identityRevision: IDENTITY_REVISION, references: await compactBatchReferencesAsync(identity.catalog(), operations), batchId, deviceId, sequence: state.sequence, createdAt: new Date().toISOString(), operations };
        operations.forEach((operation) => {
          state.versions[entityId(operation.table, operation.key)] = {
            version: operation.version,
            protocol: FORMAT,
            deviceId,
            rowHash: operation.rowHash || '',
            deleted: operation.action === 'delete',
          };
        });
        state.appliedBatches.push(batchId);
        Object.assign(state, await publishCheckpoint(mirrorPath, deviceId, batch, {
          ...state, baseline: compactBaseline(localBeforeRemote),
          // A failed receive must retry the initial import, including when the
          // first local publication has already been durably acknowledged.
          legacyBootstrapPending: needsLegacyBootstrap || legacyBootstrapPending,
        }));
      }
      state.baseline = compactBaseline(localBeforeRemote);

      const recoveryCatalogs = [];
      let unresolvedRecoveryFiles = false;
      const readDeadline = Date.now() + 2_000;
      for (const entry of recoveryFiles) {
        const catalog = Date.now() < readDeadline ? await readJsonAsync(entry.file, null) : null;
        if (readableFormat(catalog?.format) && catalog.deviceId && catalog.digest && catalog.tables) recoveryCatalogs.push(catalog);
        else unresolvedRecoveryFiles = true;
      }
      const applied = new Set(state.appliedBatches);
      const bootstrapOperations = [];
      if (initialMirrorCaptured) {
        Object.entries(initialMirrorCaptured).forEach(([table, records]) => {
          Object.entries(records).forEach(([key, record]) => {
            if (localBeforeRemote[table]?.[key] && !isUnchangedSeed(table, key)) return;
            if (isTombstonedAdditiveRecord(table, key, tombstoneKeys, studentTombstones, record.row)) return;
            bootstrapOperations.push({
              table,
              key,
              keyColumns: record.keyColumns,
              keyValues: record.keyValues,
              action: 'upsert',
              row: record.row,
              rowHash: record.hash,
              version: 0,
              deviceId: 'mirror-bootstrap',
            });
          });
        });
      }
      const incomingReads = [];
      // Slow recovery catalogs must not consume the event queue's entire turn.
      const eventReadDeadline = Date.now() + 2_000;
      for (const file of unseenEventFiles) incomingReads.push({ file, batch: Date.now() < eventReadDeadline ? await readJsonAsync(file, null) : null });
      const unresolvedEventFiles = incomingReads
        .filter(({ batch }) => !(readableFormat(batch?.format) && batch.batchId && Array.isArray(batch.operations)))
        .map(({ file }) => file);
      let incoming = incomingReads
        .map(({ batch }) => batch)
        .filter((batch) => readableFormat(batch?.format) && batch.batchId && Array.isArray(batch.operations) && !applied.has(batch.batchId))
        .sort((left, right) => String(left.batchId).localeCompare(String(right.batchId)));
      const incomingHashes = new Map(incoming.map(batch => [batch.batchId, batchContentHash(batch)]));
      const reviewed = await reviewedLegacyBatchDecisions({ db, mirrorPath, state, batches: incoming, readJson: readJsonAsync });
      if (reviewed.length) {
        for (const decision of reviewed) { state.appliedBatches.push(decision.batchId); applied.add(decision.batchId); }
        state.reviewedLegacyBatches = [...new Map([...(state.reviewedLegacyBatches || []), ...reviewed].map(item => [item.batchId, item])).values()];
        incoming = incoming.filter(batch => !applied.has(batch.batchId));
      }
      // Earlier v2 clients used only the approach name as a catalog key. A
      // received update must target its full row, never every value in it.
      for(const batch of incoming) for(const operation of batch.operations) {
        if(operation.table==='db_enfoques' && operation.action==='upsert'
          && NATURAL_KEYS.db_enfoques[0].every(column=>operation.row?.[column]!=null)) {
          operation.keyColumns=[...NATURAL_KEYS.db_enfoques[0]];
          operation.keyValues=operation.keyColumns.map(column=>operation.row[column]);
          operation.key=JSON.stringify([operation.keyColumns,operation.keyValues]);
        }
      }
      const sourceCatalogs = new Map(recoveryCatalogs.map(catalog => [catalog.deviceId, catalog.references || identity.legacyCatalog(Object.fromEntries(Object.entries(catalog.tables).map(([table, records]) => [table, records.map(record => record.row)])))]));
      const legacyGradeModes = new Map();
      incoming.forEach(batch => batch.operations.forEach(operation => {
        if (operation.table !== 'evaluacion_registros' || !operation.row?.grading_mode) return;
        const key=`${batch.deviceId}::${operation.key}`;
        if (!legacyGradeModes.has(key)) legacyGradeModes.set(key,new Set());
        legacyGradeModes.get(key).add(operation.row.grading_mode);
      }));
      const blockedIdentities = [];
      const decodeIncoming = (operation, batch) => {
        const declaredSchema = schemaByName.get(operation.table);
        if (!NATURAL_KEYS[operation.table] && operation.keyValues?.some((value,index) =>
          typeof value === 'number' && declaredSchema?.primaryKeyColumns.includes(operation.keyColumns[index]))) {
          const error = new Error('Tabla sin clave portable declarada: no se aplicara un ID numerico de otra PC.');
          error.code = 'ARMI_IDENTITY_PENDING'; throw error;
        }
        if (batch.format === FORMAT) {
          const keyRow=operation.row || Object.fromEntries((operation.keyColumns || []).map((column,index)=>[column,operation.keyValues[index]]));
          const columns=usableKeyColumns(keyRow,naturalKeyCandidatesForRow(operation.table,keyRow),declaredSchema?.primaryKeyColumns || [],emptyScopeColumns(operation.table));
          const values=columns.map(column=>keyRow[column]);
          if (!columns.length || JSON.stringify(columns)!==JSON.stringify(operation.keyColumns)
            || JSON.stringify(values)!==JSON.stringify(operation.keyValues)
            || (columns.length===1 && columns[0]==='id' && typeof values[0]==='number' && !['datos_generales','estado_modulos'].includes(operation.table))) {
            const error=new Error('La clave del paquete no corresponde a una identidad portable verificable.');
            error.code='ARMI_IDENTITY_PENDING'; throw error;
          }
          return { ...operation, key:JSON.stringify([columns,values]), references:batch.references };
        }
        const catalog = sourceCatalogs.get(batch.deviceId) || (batch.deviceId === deviceId ? identity.catalog() : null);
        if (identity.requiresStudents && !catalog && operation.table !== 'db_estudiantes' && Object.keys(operation.row || {}).some(key => /student|estudiante|author|scope_key/.test(key))) { const error = new Error('Falta el catalogo de identidad del equipo de origen.'); error.code = 'ARMI_IDENTITY_PENDING'; throw error; }
        const row = { ...(operation.row || Object.fromEntries(operation.keyColumns.map((column,index) => [column,operation.keyValues[index]]))) };
        if (operation.table === 'evaluacion_registros' && !row.grading_mode) {
          const modes=legacyGradeModes.get(`${batch.deviceId}::${operation.key}`);
          if (operation.action === 'delete' && modes?.size !== 1) { const error = new Error('Borrado antiguo sin modalidad inequivoca: no se eliminara ninguna nota.'); error.code='ARMI_IDENTITY_PENDING'; throw error; }
          row.grading_mode = modes?.size === 1 ? [...modes][0] : 'literal_traditional';
        }
        const portable = identity.portable(operation.table,row,catalog);
        const tableSchema = schemaByName.get(operation.table);
        const keyColumns = usableKeyColumns(portable,naturalKeyCandidatesForRow(operation.table,portable),tableSchema?.primaryKeyColumns || [],emptyScopeColumns(operation.table));
        const keyValues = keyColumns.map(column=>portable[column]);
        if (keyColumns.length === 1 && keyColumns[0] === 'id' && typeof keyValues[0] === 'number'
          && !['datos_generales','estado_modulos'].includes(operation.table)) {
          const error=new Error('Registro antiguo sin clave natural verificable; se conserva sin asignarlo por ID.');
          error.code='ARMI_IDENTITY_PENDING'; throw error;
        }
        return {...operation,keyColumns,keyValues,key:JSON.stringify([keyColumns,keyValues]),row:operation.row?portable:undefined,rowHash:operation.row?hashRow(operation.table,portable):undefined};
      };
      const normalizedCatalogs = recoveryCatalogs.map(catalog => ({ ...catalog,
        tables: Object.fromEntries(Object.entries(catalog.tables).map(([table,records]) => [table, records.flatMap(record => {
          try {
            const op = decodeIncoming({ ...record, table, action:'upsert' },catalog);
            return [{ ...record, ...op, rowHash:hashRow(table,op.row) }];
          } catch (error) {
            if (error.code !== 'ARMI_IDENTITY_PENDING') throw error;
            blockedIdentities.push({ source: 'recovery', deviceId:catalog.deviceId, table, key:record.key, reason:error.message }); return [];
          }
        })])) }));
      const recoveryOperations = recoveryOperationsFromCatalogs({ catalogs: normalizedCatalogs,
        captured:localBeforeRemote, versions:state.versions, tombstoneKeys, studentTombstones });
      const parentPriority = op => op.table === 'db_estudiantes' ? 0 : op.table === 'evaluacion_instrumentos' ? 1 : op.table === 'evaluacion_evidencias' ? 2 : 3;
      bootstrapOperations.sort((a,b) => parentPriority(a)-parentPriority(b));
      recoveryOperations.sort((a,b) => parentPriority(a)-parentPriority(b));
      incoming.forEach((batch) => batch.operations.forEach((operation) => {
        if (operation.table === 'student_deletion_tombstones') {
          try {
            const decoded=decodeIncoming(operation,batch);
            const version={version:decoded.version,protocol:batch.format,deviceId:decoded.deviceId || batch.deviceId};
            if(!isIncomingNewer(version,state.versions[entityId(decoded.table,decoded.key)])) return;
            if(decoded.action==='upsert') addStudentTombstone(studentTombstones,decoded.row);
            else {
              const keyRow=Object.fromEntries(decoded.keyColumns.map((column,index)=>[column,decoded.keyValues[index]]));
              studentTombstones.ids.delete(String(keyRow.student_id));
              const row=db.prepare('SELECT dni FROM student_deletion_tombstones WHERE student_id=?').get(keyRow.student_id);
              if(row?.dni) studentTombstones.dnis.delete(String(row.dni));
            }
          }
          catch (error) { if (error.code !== 'ARMI_IDENTITY_PENDING') throw error; }
        }
      }));
      let appliedOperations = 0;
      let recoveredOperations = 0;
      let ignoredOperations = 0;
      let newConflicts = 0;
      const acknowledgedBaseline = compactBaseline(localBeforeRemote);
      const lateLocalOperations = [];
      const acknowledgeAppliedRow = (operation, tableSchema) => {
        if (operation.action === 'delete') {
          delete acknowledgedBaseline[operation.table]?.[operation.key]; return;
        }
        const where = whereForOperation(identity.localOperation(operation), new Set(tableSchema.columns));
        if (!where) return;
        const row = db.prepare(`SELECT * FROM ${quoteIdentifier(operation.table)} WHERE ${where.clause} LIMIT 1`).get(...where.values);
        acknowledgedBaseline[operation.table] ||= {};
        if (row) acknowledgedBaseline[operation.table][operation.key] = hashRow(operation.table,
          operation.table === 'evaluacion_evidencias' ? cachedEvidenceResolver(db, statementCache)(row) : row, identity);
        else delete acknowledgedBaseline[operation.table][operation.key];
      };
      const transaction = db.transaction(() => {
        bootstrapOperations.forEach((operation) => {
          const tableSchema = schemaByName.get(operation.table);
          if (!tableSchema) return;
          try { if (!applyOperation(db, operation, tableSchema, statementCache, identity)) return; }
          catch (error) {
            if (error.code !== 'ARMI_IDENTITY_PENDING') throw error;
            blockedIdentities.push({ source:'bootstrap',table:operation.table,key:operation.key,reason:error.message }); return;
          }
          acknowledgeAppliedRow(operation, tableSchema);
          state.versions[entityId(operation.table, operation.key)] = {
            version: 0,
            deviceId: 'mirror-bootstrap',
            rowHash: operation.rowHash || '',
            deleted: false,
          };
          appliedOperations += 1;
        });
        recoveryOperations.forEach((operation) => {
          const tableSchema = schemaByName.get(operation.table);
          if (!tableSchema) return;
          try { if (!applyOperation(db, operation, tableSchema, statementCache, identity)) return; }
          catch (error) {
            if (error.code !== 'ARMI_IDENTITY_PENDING') throw error;
            blockedIdentities.push({ source:'recovery',table:operation.table,key:operation.key,reason:error.message }); return;
          }
          acknowledgeAppliedRow(operation, tableSchema);
          const id = entityId(operation.table, operation.key);
          if (!state.versions[id]) {
            state.versions[id] = {
              version: operation.version,
              deviceId: operation.deviceId,
              rowHash: operation.rowHash || '',
              deleted: false,
            };
          }
          appliedOperations += 1;
          recoveredOperations += 1;
        });
        incoming.forEach((batch) => {
          [...batch.operations].sort((a,b) => parentPriority(a)-parentPriority(b)).forEach((operation) => {
            const tableSchema = schemaByName.get(operation.table);
            if (!tableSchema) {
              blockedIdentities.push({ batchId: batch.batchId, table: operation.table, key: operation.key,
                kind: 'unsupported-table', reason: 'Esta versión no reconoce la tabla del cambio; se conserva para una versión compatible.' });
              return;
            }
            try {
              operation = decodeIncoming(operation, batch);
              const localized = identity.localOperation(operation); // Fail closed before clock acknowledgement.
              const unknownColumns = Object.keys(localized.row || {}).filter(column =>
                !tableSchema.columns.includes(column) && !['__studentIdentity', '__sync_key'].includes(column));
              if (batch.format === FORMAT && unknownColumns.length) {
                const error = new Error('Esta versión no reconoce algunos campos del cambio; se conserva para una versión compatible.');
                error.code = 'ARMI_IDENTITY_PENDING'; error.unsupportedSchema = true; throw error;
              }
            } catch (error) {
              if (error.code !== 'ARMI_IDENTITY_PENDING') throw error;
              blockedIdentities.push({ batchId: batch.batchId, table: operation.table, key: operation.key,
                ...(error.unsupportedSchema ? { kind: 'unsupported-table' } : {}), reason: error.message });
              return;
            }
            if (operation.action === 'upsert'
              && isTombstonedAdditiveRecord(operation.table, operation.key, tombstoneKeys, studentTombstones, operation.row)) {
              ignoredOperations += 1;
              return;
            }
            if (operation.action === 'delete' && ADDITIVE_TABLES.has(operation.table)
              && !isTombstonedAdditiveRecord(operation.table, operation.key, tombstoneKeys, studentTombstones)) {
              ignoredOperations += 1;
              return;
            }
            const id = entityId(operation.table, operation.key);
            const incomingVersion = { version: operation.version, protocol:batch.format, deviceId: operation.deviceId || batch.deviceId };
            const currentVersion = state.versions[id];
            if (batch.format === 1 && currentVersion?.protocol === FORMAT
              && (operation.rowHash !== currentVersion.rowHash || operation.action === 'delete')) {
              blockedIdentities.push({ batchId:batch.batchId,table:operation.table,key:operation.key,
                kind:'legacy-conflict',reason:'Cambio antiguo distinto de la copia migrada: se conserva para conciliacion.',incoming:operation });
              return;
            }
            const concurrentConflict = currentVersion
              && Number(incomingVersion.version || 0) === Number(currentVersion.version || 0)
              && String(incomingVersion.deviceId || '') !== String(currentVersion.deviceId || '')
              && (String(operation.rowHash || '') !== String(currentVersion.rowHash || '')
                || Boolean(operation.action === 'delete') !== Boolean(currentVersion.deleted));
            const preferenceOnly = operation.table === 'armi_frontend_state'
              && operation.action === 'upsert' && !currentVersion?.deleted
              && MERGEABLE_PREFERENCES.has(operation.row?.key);
            if (concurrentConflict && !preferenceOnly) {
              const gradeWhere = operation.table === 'evaluacion_registros'
                ? whereForOperation(identity.localOperation(operation), new Set(tableSchema.columns)) : null;
              state.conflicts.push({
                entity: id,
                devices: [currentVersion.deviceId, incomingVersion.deviceId].sort(),
                detectedAt: new Date().toISOString(),
                ...(gradeWhere ? {
                  localRow: db.prepare(`SELECT * FROM ${quoteIdentifier(operation.table)} WHERE ${gradeWhere.clause} LIMIT 1`).get(...gradeWhere.values) || null,
                  incomingRow: operation.row || null,
                } : {}),
              });
              newConflicts += 1;
            }
            if (!isIncomingNewer(incomingVersion, currentVersion)) {
              ignoredOperations += 1;
              return;
            }
            const where = whereForOperation(identity.localOperation(operation), new Set(tableSchema.columns));
            if (!where) return;
            const currentRow = db.prepare(`SELECT * FROM ${quoteIdentifier(operation.table)} WHERE ${where.clause} LIMIT 1`).get(...where.values);
            let currentHash;
            try {
              currentHash = currentRow ? hashRow(operation.table,
                operation.table === 'evaluacion_evidencias' ? cachedEvidenceResolver(db, statementCache)(currentRow) : currentRow, identity) : undefined;
            } catch (error) {
              if (error.code !== 'ARMI_IDENTITY_PENDING') throw error;
              // A protected local row (e.g. a legacy numeric-score cache) must
              // remain untouched, without rolling back unrelated received work.
              blockedIdentities.push({ batchId: batch.batchId, table: operation.table,
                key: operation.key, source: 'local-current-row', reason: error.message });
              return;
            }
            if(operation.action==='upsert' && currentRow && currentHash===operation.rowHash) {
              // A migrated PC can receive the same verified snapshot published
              // by another device. Advance its clock without rewriting thousands
              // of unchanged rows or refreshing the identity catalog per row.
              state.versions[id]={...incomingVersion,rowHash:currentHash,deleted:false};
              acknowledgedBaseline[operation.table] ||= {};
              acknowledgedBaseline[operation.table][operation.key]=currentHash;
              ignoredOperations++;return;
            }
            // The user can edit while Drive is reading an event. That edit was
            // not in the earlier capture; publish it instead of overwriting it.
            if ((currentHash !== acknowledgedBaseline[operation.table]?.[operation.key]
              || wouldEraseNewerUnitPlanning(operation, currentRow))
              && (currentRow || !ADDITIVE_TABLES.has(operation.table))) {
              const version = Math.max(Number(incomingVersion.version || 0), Number(currentVersion?.version || 0)) + 1;
              const late = { ...operation, action: currentRow ? 'upsert' : 'delete',
                row: currentRow ? portableRow(operation.table, currentRow, identity) : undefined,
                rowHash: currentHash || '', version, deviceId };
              lateLocalOperations.push(late);
              state.versions[id] = { version, protocol:FORMAT, deviceId, rowHash: currentHash || '', deleted: !currentRow };
              acknowledgeAppliedRow(late, tableSchema);
              ignoredOperations += 1;
              return;
            }
            if (!applyOperation(db, operation, tableSchema, statementCache, identity)) return;
            acknowledgeAppliedRow(operation, tableSchema);
            state.versions[id] = {
              ...incomingVersion,
              rowHash: operation.rowHash || '',
              deleted: operation.action === 'delete',
            };
            appliedOperations += 1;
          });
          if (!blockedIdentities.some(item => item.batchId === batch.batchId)) {
            state.appliedBatches.push(batch.batchId); applied.add(batch.batchId);
            recordIncorporatedHead(state, batch, incomingHashes.get(batch.batchId));
          }
        });
        removeTombstonedStudents(db, studentTombstones, identity);
        identity.refresh();
      });
      transaction();
      if (lateLocalOperations.length) {
        state.sequence += 1;
        const batchId = `${Date.now()}-${String(state.sequence).padStart(8, '0')}-${deviceId}-${crypto.randomUUID().slice(0, 8)}`;
        const batch = {
          format: FORMAT, identityRevision: IDENTITY_REVISION, references: await compactBatchReferencesAsync(identity.catalog(), lateLocalOperations), batchId, deviceId, sequence: state.sequence,
          createdAt: new Date().toISOString(), operations: lateLocalOperations,
        };
        state.appliedBatches.push(batchId);
        Object.assign(state, await publishCheckpoint(mirrorPath, deviceId, batch, {
          ...state, baseline: acknowledgedBaseline,
          legacyBootstrapPending: needsLegacyBootstrap || legacyBootstrapPending,
        }));
      }
      const finalCaptured = appliedOperations > 0 || lateLocalOperations.length > 0 ? await captureDatabase(db, schema, identity) : localBeforeRemote;
      // A post-transaction capture may include unsent edits made while yielding.
      // Only rows published or applied by this pass may enter the baseline.
      state.baseline = acknowledgedBaseline;
      const recoveryCatalog = buildRecoveryCatalog(finalCaptured, deviceId, identity);
      fs.mkdirSync(recoveryRoot, { recursive: true });
      const recoveryPath = path.join(recoveryRoot, `${deviceId}.json`);
      const previousRecovery = await readJsonAsync(recoveryPath, null);
      if (previousRecovery?.digest !== recoveryCatalog.digest) {
        await writeJsonAtomic(recoveryPath, recoveryCatalog);
      }
      // No se olvidan lotes antiguos mientras sigan físicamente en Drive. Si se
      // descartara un identificador, una PC que estuvo meses desconectada podría
      // intentar aplicar nuevamente un cambio viejo.
      state.appliedBatches = Array.from(new Set(state.appliedBatches));
      state.lastRunAt = new Date().toISOString();
      // A local write can arrive while captureDatabase yields to the server.
      // Acknowledge only the revision observed before capture, never that later write.
      state.lastSourceSignature = sourceSignature;
      state.lastPublishedOperations = operations.length + lateLocalOperations.length;
      state.lastAppliedOperations = appliedOperations;
      identity.blockedLocal = [...new Map(identity.blockedLocal.map(item => [JSON.stringify(item),item])).values()];
      const reconciliationPending = blockedIdentities.filter(item => item.kind === 'legacy-conflict').length;
      const identityPending = blockedIdentities.length - reconciliationPending + identity.blockedLocal.length;
      const unsupportedTables = blockedIdentities.some(item => item.kind === 'unsupported-table');
      const blockedPending = identityPending + reconciliationPending;
      state.identityPending = identityPending;
      state.reconciliationPending = reconciliationPending;
      await writeJsonAtomic(statePath, state);
      await writeJsonAtomic(path.join(runtimeFolder, 'sync-identity-pending.json'), { updatedAt: state.lastRunAt, incoming: blockedIdentities, local: identity.blockedLocal });
      if (blockedPending) await fs.promises.rm(fastStatePath,{force:true});
      let acknowledgedInventory = eventFiles;
      if (blockedPending === 0 && unresolvedEventFiles.length === 0 && !unresolvedRecoveryFiles && !legacyBootstrapPending) {
        const appliedBatchIds = new Set(state.appliedBatches);
        inventoryCache=null;
        const finalInventory=await readInventory(mirrorPath);
        acknowledgedInventory = finalInventory.eventFiles;
        const finalEventFiles = finalInventory.eventFiles.filter((file) => appliedBatchIds.has(path.basename(file, '.json')));
        const finalRecoveryCatalogs = finalInventory.recoveryFiles;
        await writeJsonAtomic(fastStatePath, {
          format: FORMAT,
          identityRevision: IDENTITY_REVISION,
          lastSourceSignature: state.lastSourceSignature,
          eventSetSignature: eventSetSignature(finalEventFiles),
          // Only acknowledge catalogs actually read, plus our own new catalog.
          recoverySetSignature: recoverySetSignature(finalRecoveryCatalogs.filter((entry) =>
            entry.file === recoveryPath || recoveryFiles.some((old) => old.file === entry.file && old.signature === entry.signature))),
          conflicts: state.conflicts.length,
          tombstoneSetSignature: currentTombstoneSetSignature,
          updatedAt: state.lastRunAt,
        });
      }
      const publishedOperations = operations.length + lateLocalOperations.length;
      const changed = publishedOperations + appliedOperations;
      setPublicState({
        enabled: true,
        state: blockedPending || unresolvedEventFiles.length || unresolvedRecoveryFiles || legacyBootstrapPending ? 'pending' : changed ? 'synchronized' : 'in-sync',
        message: blockedPending
          ? [identityPending ? `${identityPending} relaciones de identidad requieren verificación.` : '', reconciliationPending ? `${reconciliationPending} cambios del formato anterior requieren conciliación; se conservaron para revisión.` : ''].filter(Boolean).join(' ')
          : unresolvedEventFiles.length || unresolvedRecoveryFiles || legacyBootstrapPending
          ? 'Drive aun debe entregar algunos cambios; los datos locales siguen disponibles y se reintentara su lectura.'
          : newConflicts
          ? `${newConflicts} registro${newConflicts === 1 ? '' : 's'} fue modificado al mismo tiempo en dos PC. ARMI conservo una version determinista y mantuvo el detalle para revision.`
          : changed
          ? `${publishedOperations} cambios enviados, ${appliedOperations} recibidos${recoveredOperations ? ` (${recoveredOperations} recuperados por verificacion)` : ''} mediante sincronizacion incremental.`
          : 'Todos los cambios incrementales visibles estan incorporados.',
        identityPending,
        reconciliationPending,
        pendingTask: unsupportedTables ? { kind: 'compatible-version', label: 'Actualización compatible pendiente',
          detail: 'Esta PC necesita una versión compatible para incorporar algunos cambios. Se conservan en el historial.', requiresAction: true } : null,
        pendingOperations: blockedPending + unresolvedEventFiles.length + Number(unresolvedRecoveryFiles) + Number(legacyBootstrapPending),
        publishedOperations,
        appliedOperations,
        ...(migration.applied ? {identityMigrationApplied:true, migrationId:migration.migrationId} : {}),
        recoveredOperations,
        ignoredOperations,
        conflicts: state.conflicts.length,
        lastSuccessAt: new Date().toISOString(),
      });
      await refreshAuxiliary(mirrorPath, state, acknowledgedInventory,
        !blockedPending && !unresolvedEventFiles.length && !unresolvedRecoveryFiles && !legacyBootstrapPending);
      return { success: true, data: { ...publicState } };
    } catch (error) {
      // Retain the actual failure on disk even after the UI is closed.
      try {
        await writeJsonAtomic(path.join(runtimeFolder, 'incremental-last-error.json'), {
          at: new Date().toISOString(), code: error.code || null,
          message: error.message, stack: error.stack,
        });
      } catch { /* A full/locked disk must not hide the original sync error. */ }
      setPublicState({
        enabled: true,
        state: ['ARMI_MIRROR_PENDING','ARMI_IDENTITY_PENDING'].includes(error?.code) ? 'pending' : 'error',
        pendingOperations: Math.max(1, Number(publicState.pendingOperations || 0)),
        message: `Los datos locales estan seguros; se reintentara la sincronizacion incremental. ${error?.message || ''}`.trim(),
        pendingTask:error.syncTask || null,
        lastErrorAt: new Date().toISOString(),
      });
      return { success: false, message: publicState.message, data: { ...publicState } };
    } finally {
      running = false;
      inventoryCache=null;
    }
  };

  const inspect = ({ mirrorPath, inventory = null } = {}) => {
    const sourceSignature = typeof getSourceSignature === 'function' ? String(getSourceSignature() || '') : '';
    if (!mirrorPath || !exists(mirrorPath)) {
      return {
        initialized: false,
        running,
        localChangesPending: false,
        remoteChangesPending: false,
        sourceSignature,
      };
    }
    const incrementalRoot = path.join(mirrorPath, '.armi-sync', 'incremental-v1');
    const eventFiles = inventory?.eventFiles || listEventFiles(incrementalRoot);
    const currentEventSetSignature = eventSetSignature(eventFiles);
    const currentRecoverySetSignature = recoverySetSignature(inventory?.recoveryFiles || listRecoveryCatalogs(incrementalRoot));
    const currentTombstoneSetSignature = hashValue(inventory?.tombstoneFiles || listEvidenceTombstoneFiles(path.join(mirrorPath, 'Evidencias de estudiantes')));
    const fastState = inspectCheckpoint(fastStatePath);
    // The small checkpoint already confirms which immutable batches were applied.
    // Avoid parsing the full row baseline on every UI poll while nothing arrived.
    if (fastState?.format === FORMAT
      && fastState.identityRevision === IDENTITY_REVISION
      && fastState.eventSetSignature === currentEventSetSignature
      && fastState.recoverySetSignature === currentRecoverySetSignature
      && fastState.tombstoneSetSignature === currentTombstoneSetSignature) {
      const localChangesPending = !!sourceSignature && fastState.lastSourceSignature !== sourceSignature;
      return {
        initialized: true, running, localChangesPending, remoteChangesPending: false,
        pending: running || localChangesPending, sourceSignature,
        eventSetSignature: currentEventSetSignature,
        recoverySetSignature: currentRecoverySetSignature,
        lastEventSetSignature: fastState.eventSetSignature,
      };
    }
    const saved = inspectCheckpoint(statePath) || inspectCheckpoint(legacyStatePath);
    const applied = new Set(Array.isArray(saved?.appliedBatches) ? saved.appliedBatches : []);
    const remoteChangesPending = eventFiles.some((file) => !applied.has(path.basename(file, '.json')));
    const localChangesPending = !!sourceSignature
      && String(fastState?.lastSourceSignature || saved?.lastSourceSignature || '') !== sourceSignature;
    const recoveryChangesPending = String(fastState?.recoverySetSignature || '') !== currentRecoverySetSignature;
    const tombstoneChangesPending = String(fastState?.tombstoneSetSignature || '') !== currentTombstoneSetSignature;
    return {
      initialized: saved?.initialized === true && saved.identityRevision === IDENTITY_REVISION,
      running,
      localChangesPending,
      remoteChangesPending,
      recoveryChangesPending,
      tombstoneChangesPending,
      pending: running || localChangesPending || remoteChangesPending || recoveryChangesPending || tombstoneChangesPending || Boolean(saved?.legacyBootstrapPending) || Boolean(saved?.identityPending) || Boolean(saved?.reconciliationPending),
      sourceSignature,
      eventSetSignature: currentEventSetSignature,
      lastEventSetSignature: String(fastState?.eventSetSignature || ''),
      recoverySetSignature: currentRecoverySetSignature,
      lastRecoverySetSignature: String(fastState?.recoverySetSignature || ''),
    };
  };

  return {
    run,
    inspect,
    inspectAsync: async ({mirrorPath}={}) => {
      try {return inspect({mirrorPath,inventory:mirrorPath ? await readInventory(mirrorPath) : null});}
      catch(error) {
        if(error.code!=='ARMI_MIRROR_PENDING') throw error;
        return {initialized:false,running,pending:true,remoteChangesPending:true,message:error.message};
      }
    },
    getState: () => ({ ...publicState, delivery: delivery.snapshot(currentPublication, currentMirrorPath), maintenance: maintenance.snapshot() }),
    waitForMaintenance: async () => { if (auxiliaryTask) await auxiliaryTask; },
    stopMaintenance: () => { auxiliaryEpoch++; maintenance.stop?.(); },
    resetRuntimeState: () => { auxiliaryEpoch++; maintenance.stop?.(); publicState = { ...publicState, state: 'inactive', updatedAt: new Date().toISOString() }; },
  };
};
