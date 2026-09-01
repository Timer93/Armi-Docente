import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const FORMAT = 1;

const NATURAL_KEYS = {
  datos_generales: [['id']],
  db_estudiantes: [['dni'], ['id']],
  db_egresados: [['dni'], ['estudiante_id_origen'], ['id']],
  asistencia_rostros: [['student_id'], ['id']],
  asistencia_registros: [['attendance_date', 'grade', 'section', 'student_id'], ['id']],
  metas_aprendizaje: [['anio', 'area', 'grado', 'seccion', 'competencia', 'tipo'], ['id']],
  programacion_anual: [['id_programa']],
  unidades_didacticas: [['id_unidad']],
  sesiones: [['id_sesion']],
  programacion_recursos: [['id_programa']],
  estado_modulos: [['id']],
  evaluacion_instrumentos: [['year', 'area_id', 'grade', 'section', 'type', 'name'], ['id']],
  evaluacion_registros: [['student_id', 'session_id', 'unit_id', 'instrument_id', 'criteria_id'], ['id']],
  student_achievement_points: [['student_id', 'year', 'bimester', 'unit_number', 'source', 'reference_id', 'created_at'], ['id']],
  evaluacion_modos_calificacion: [['year', 'area_id', 'grade', 'section'], ['id']],
  evaluacion_evidencias: [['evidence_key'], ['relative_path'], ['id']],
  evaluacion_configuracion: [['year', 'area_id'], ['id']],
  evaluacion_ventanas_entrega: [['session_id']],
  evaluacion_conclusiones: [['year', 'area_id', 'grade', 'section', 'scope_type', 'scope_value', 'student_id', 'competency_key'], ['id']],
};

const LOCAL_ONLY_COLUMNS = {
  datos_generales: new Set(['path_word_default', 'evidence_storage_path']),
  evaluacion_evidencias: new Set(['file_path']),
};

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
const portableRow = (table, row) => {
  const excluded = LOCAL_ONLY_COLUMNS[table];
  if (!excluded) return { ...row };
  return Object.fromEntries(Object.entries(row).filter(([column]) => !excluded.has(column)));
};
const exists = (target) => {
  try { fs.accessSync(target); return true; } catch { return false; }
};
const readJson = (target, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch { return fallback; }
};
const writeJsonAtomic = (target, value) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), 'utf8');
  fs.renameSync(temporary, target);
};

const usableKeyColumns = (row, candidates, primaryKeyColumns) => {
  const options = [...(candidates || []), primaryKeyColumns].filter((item) => Array.isArray(item) && item.length);
  return options.find((columns) => columns.every((column) => (
    Object.prototype.hasOwnProperty.call(row, column)
    && row[column] !== null
    && row[column] !== undefined
    && String(row[column]).trim() !== ''
  ))) || [];
};

const inspectSchema = (db, excludedTables) => {
  const excluded = new Set(excludedTables || []);
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

const captureDatabase = (db, schema) => {
  const tables = {};
  schema.forEach((table) => {
    const records = {};
    const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(table.name)}`).all();
    rows.forEach((row) => {
      const keyColumns = usableKeyColumns(row, NATURAL_KEYS[table.name], table.primaryKeyColumns);
      if (!keyColumns.length) return;
      const keyValues = keyColumns.map((column) => row[column]);
      const key = JSON.stringify([keyColumns, keyValues]);
      const normalizedRow = portableRow(table.name, row);
      records[key] = { keyColumns, keyValues, hash: hashValue(normalizedRow), row: normalizedRow };
    });
    tables[table.name] = records;
  });
  return tables;
};

const captureDump = (dump, schema) => {
  const tables = {};
  schema.forEach((table) => {
    const records = {};
    const rows = Array.isArray(dump?.tables?.[table.name]) ? dump.tables[table.name] : [];
    rows.forEach((row) => {
      const keyColumns = usableKeyColumns(row, NATURAL_KEYS[table.name], table.primaryKeyColumns);
      if (!keyColumns.length) return;
      const keyValues = keyColumns.map((column) => row[column]);
      const key = JSON.stringify([keyColumns, keyValues]);
      const normalizedRow = portableRow(table.name, row);
      records[key] = { keyColumns, keyValues, hash: hashValue(normalizedRow), row: normalizedRow };
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

const entityId = (table, key) => `${table}:${key}`;
const isIncomingNewer = (incoming, current) => {
  if (!current) return true;
  if (Number(incoming.version || 0) !== Number(current.version || 0)) {
    return Number(incoming.version || 0) > Number(current.version || 0);
  }
  return String(incoming.deviceId || '').localeCompare(String(current.deviceId || '')) > 0;
};

const buildOperations = ({ captured, baseline, versions, deviceId, includeDeletes }) => {
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

const applyOperation = (db, operation, tableSchema, statementCache = null) => {
  const allowedColumns = new Set(tableSchema.columns);
  const where = whereForOperation(operation, allowedColumns);
  if (!where) return false;
  const table = quoteIdentifier(operation.table);
  const existing = prepareCached(db, statementCache, `SELECT * FROM ${table} WHERE ${where.clause} LIMIT 1`).get(...where.values);
  if (operation.action === 'delete') {
    if (existing) prepareCached(db, statementCache, `DELETE FROM ${table} WHERE ${where.clause}`).run(...where.values);
    return true;
  }
  if (!operation.row || typeof operation.row !== 'object') return false;
  const primaryKeys = new Set(tableSchema.primaryKeyColumns);
  if (existing) {
    const columns = Object.keys(operation.row).filter((column) => allowedColumns.has(column) && !primaryKeys.has(column));
    if (!columns.length) return true;
    prepareCached(db, statementCache, `UPDATE ${table} SET ${columns.map((column) => `${quoteIdentifier(column)} = ?`).join(', ')} WHERE ${where.clause}`)
      .run(...columns.map((column) => operation.row[column] ?? null), ...where.values);
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
  prepareCached(db, statementCache, `INSERT INTO ${table} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...columns.map((column) => operation.row[column] ?? null));
  return true;
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

const eventSetSignature = (files) => crypto
  .createHash('sha256')
  .update(files.map((file) => {
    try {
      const stats = fs.statSync(file);
      return `${path.basename(file)}:${stats.size}:${stats.mtimeMs}`;
    } catch {
      return `${path.basename(file)}:unavailable`;
    }
  }).sort().join('|'))
  .digest('hex')
  .slice(0, 20);

export const createIncrementalMirrorSync = ({ db, runtimeFolder, excludedTables = [], getDeviceId, getSourceSignature = null }) => {
  const statePath = path.join(runtimeFolder, 'incremental-mirror-state.json');
  const fastStatePath = path.join(runtimeFolder, 'incremental-mirror-fast-state.json');
  const statementCache = new Map();
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
    try {
      if (!mirrorPath || !exists(mirrorPath)) {
        setPublicState({ enabled: true, state: 'unavailable', message: 'La carpeta espejo no esta disponible.', pendingOperations: 0 });
        return { success: false, message: publicState.message, data: { ...publicState } };
      }
      const deviceId = getDeviceId();
      const incrementalRoot = path.join(mirrorPath, '.armi-sync', 'incremental-v1');
      const eventsRoot = path.join(incrementalRoot, 'devices', deviceId, 'events');
      fs.mkdirSync(eventsRoot, { recursive: true });
      const eventFiles = listEventFiles(incrementalRoot);
      const currentEventSetSignature = eventSetSignature(eventFiles);
      const sourceSignature = typeof getSourceSignature === 'function' ? String(getSourceSignature() || '') : '';
      const fastState = readJson(fastStatePath, null);
      if (fastState?.format === FORMAT
        && sourceSignature
        && fastState.lastSourceSignature === sourceSignature
        && fastState.eventSetSignature === currentEventSetSignature) {
        const savedConflictCount = Number(fastState.conflicts || 0);
        setPublicState({
          enabled: true,
          state: savedConflictCount ? 'needs-review' : 'in-sync',
          message: savedConflictCount
            ? `${savedConflictCount} cambio concurrente fue resuelto de forma determinista y permanece registrado para revision.`
            : 'Todos los cambios incrementales visibles estan incorporados.',
          pendingOperations: 0,
          publishedOperations: 0,
          appliedOperations: 0,
          conflicts: savedConflictCount,
          lastSuccessAt: new Date().toISOString(),
        });
        return { success: true, data: { ...publicState, fastCheck: true } };
      }
      const saved = readJson(statePath, null);
      const appliedBeforeRun = new Set(Array.isArray(saved?.appliedBatches) ? saved.appliedBatches : []);
      const unseenEventFiles = eventFiles
        .filter((file) => !appliedBeforeRun.has(path.basename(file, '.json')));
      if (saved?.initialized && sourceSignature && saved.lastSourceSignature === sourceSignature && unseenEventFiles.length === 0) {
        const savedConflictCount = Array.isArray(saved.conflicts) ? saved.conflicts.length : 0;
        writeJsonAtomic(fastStatePath, {
          format: FORMAT,
          lastSourceSignature: sourceSignature,
          eventSetSignature: currentEventSetSignature,
          conflicts: savedConflictCount,
          updatedAt: new Date().toISOString(),
        });
        setPublicState({
          enabled: true,
          state: savedConflictCount ? 'needs-review' : 'in-sync',
          message: savedConflictCount
            ? `${savedConflictCount} cambio concurrente fue resuelto de forma determinista y permanece registrado para revision.`
            : 'Todos los cambios incrementales visibles estan incorporados.',
          pendingOperations: 0,
          publishedOperations: 0,
          appliedOperations: 0,
          conflicts: savedConflictCount,
          lastSuccessAt: new Date().toISOString(),
        });
        return { success: true, data: { ...publicState, fastCheck: true } };
      }
      const schema = inspectSchema(db, excludedTables);
      const schemaByName = new Map(schema.map((table) => [table.name, table]));
      const initialMirrorDump = !saved?.initialized && mirrorDatabaseDumpPath ? readJson(mirrorDatabaseDumpPath, null) : null;
      const localBeforeRemote = captureDatabase(db, schema);
      const initialMirrorCaptured = initialMirrorDump?.tables ? captureDump(initialMirrorDump, schema) : null;
      const baseline = saved?.initialized
        ? (saved.baseline || {})
        : initialMirrorCaptured
          ? compactBaseline(initialMirrorCaptured)
          : {};
      const state = {
        format: FORMAT,
        initialized: true,
        deviceId,
        sequence: Number(saved?.sequence || 0),
        baseline,
        versions: saved?.versions || {},
        appliedBatches: Array.isArray(saved?.appliedBatches) ? saved.appliedBatches : [],
        conflicts: Array.isArray(saved?.conflicts) ? saved.conflicts.slice(-100) : [],
      };
      setPublicState({ enabled: true, state: 'syncing', message: 'Preparando cambios pequeños para la carpeta espejo.' });
      const operations = buildOperations({
        captured: localBeforeRemote,
        baseline: state.baseline,
        versions: state.versions,
        deviceId,
        includeDeletes: saved?.initialized === true,
      });
      if (operations.length) {
        state.sequence += 1;
        const batchId = `${Date.now()}-${String(state.sequence).padStart(8, '0')}-${deviceId}-${crypto.randomUUID().slice(0, 8)}`;
        const batch = { format: FORMAT, batchId, deviceId, sequence: state.sequence, createdAt: new Date().toISOString(), operations };
        writeJsonAtomic(path.join(eventsRoot, `${batchId}.json`), batch);
        operations.forEach((operation) => {
          state.versions[entityId(operation.table, operation.key)] = {
            version: operation.version,
            deviceId,
            rowHash: operation.rowHash || '',
            deleted: operation.action === 'delete',
          };
        });
        state.appliedBatches.push(batchId);
      }
      state.baseline = compactBaseline(localBeforeRemote);

      const applied = new Set(state.appliedBatches);
      const bootstrapOperations = [];
      if (initialMirrorCaptured) {
        Object.entries(initialMirrorCaptured).forEach(([table, records]) => {
          Object.entries(records).forEach(([key, record]) => {
            if (localBeforeRemote[table]?.[key]) return;
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
      const incomingReads = unseenEventFiles.map((file) => ({ file, batch: readJson(file, null) }));
      const unresolvedEventFiles = incomingReads
        .filter(({ batch }) => !(batch?.format === FORMAT && batch.batchId && Array.isArray(batch.operations)))
        .map(({ file }) => file);
      const incoming = incomingReads
        .map(({ batch }) => batch)
        .filter((batch) => batch?.format === FORMAT && batch.batchId && Array.isArray(batch.operations) && !applied.has(batch.batchId))
        .sort((left, right) => String(left.batchId).localeCompare(String(right.batchId)));
      let appliedOperations = 0;
      let ignoredOperations = 0;
      let newConflicts = 0;
      const transaction = db.transaction(() => {
        bootstrapOperations.forEach((operation) => {
          const tableSchema = schemaByName.get(operation.table);
          if (!tableSchema || !applyOperation(db, operation, tableSchema, statementCache)) return;
          state.versions[entityId(operation.table, operation.key)] = {
            version: 0,
            deviceId: 'mirror-bootstrap',
            rowHash: operation.rowHash || '',
            deleted: false,
          };
          appliedOperations += 1;
        });
        incoming.forEach((batch) => {
          batch.operations.forEach((operation) => {
            const tableSchema = schemaByName.get(operation.table);
            if (!tableSchema) return;
            const id = entityId(operation.table, operation.key);
            const incomingVersion = { version: operation.version, deviceId: operation.deviceId || batch.deviceId };
            const currentVersion = state.versions[id];
            const concurrentConflict = currentVersion
              && Number(incomingVersion.version || 0) === Number(currentVersion.version || 0)
              && String(incomingVersion.deviceId || '') !== String(currentVersion.deviceId || '')
              && (String(operation.rowHash || '') !== String(currentVersion.rowHash || '')
                || Boolean(operation.action === 'delete') !== Boolean(currentVersion.deleted));
            if (concurrentConflict) {
              state.conflicts.push({
                entity: id,
                devices: [currentVersion.deviceId, incomingVersion.deviceId].sort(),
                detectedAt: new Date().toISOString(),
              });
              newConflicts += 1;
            }
            if (!isIncomingNewer(incomingVersion, currentVersion)) {
              ignoredOperations += 1;
              return;
            }
            if (!applyOperation(db, operation, tableSchema, statementCache)) return;
            state.versions[id] = {
              ...incomingVersion,
              rowHash: operation.rowHash || '',
              deleted: operation.action === 'delete',
            };
            appliedOperations += 1;
          });
          state.appliedBatches.push(batch.batchId);
          applied.add(batch.batchId);
        });
      });
      transaction();
      if (appliedOperations > 0) {
        state.baseline = compactBaseline(captureDatabase(db, schema));
      }
      // No se olvidan lotes antiguos mientras sigan físicamente en Drive. Si se
      // descartara un identificador, una PC que estuvo meses desconectada podría
      // intentar aplicar nuevamente un cambio viejo.
      state.appliedBatches = Array.from(new Set(state.appliedBatches));
      state.lastRunAt = new Date().toISOString();
      state.lastSourceSignature = typeof getSourceSignature === 'function'
        ? String(getSourceSignature() || '')
        : sourceSignature;
      state.lastPublishedOperations = operations.length;
      state.lastAppliedOperations = appliedOperations;
      writeJsonAtomic(statePath, state);
      if (unresolvedEventFiles.length === 0) {
        const finalEventFiles = listEventFiles(incrementalRoot);
        writeJsonAtomic(fastStatePath, {
          format: FORMAT,
          lastSourceSignature: state.lastSourceSignature,
          eventSetSignature: eventSetSignature(finalEventFiles),
          conflicts: state.conflicts.length,
          updatedAt: state.lastRunAt,
        });
      }
      const changed = operations.length + appliedOperations;
      setPublicState({
        enabled: true,
        state: newConflicts ? 'needs-review' : changed ? 'synchronized' : 'in-sync',
        message: newConflicts
          ? `${newConflicts} registro${newConflicts === 1 ? '' : 's'} fue modificado al mismo tiempo en dos PC. ARMI conservo una version determinista y mantuvo el detalle para revision.`
          : changed
          ? `${operations.length} cambios enviados y ${appliedOperations} recibidos mediante sincronizacion incremental.`
          : 'Todos los cambios incrementales visibles estan incorporados.',
        pendingOperations: 0,
        publishedOperations: operations.length,
        appliedOperations,
        ignoredOperations,
        conflicts: state.conflicts.length,
        lastSuccessAt: new Date().toISOString(),
      });
      return { success: true, data: { ...publicState } };
    } catch (error) {
      setPublicState({
        enabled: true,
        state: 'error',
        message: `Los datos locales estan seguros; se reintentara la sincronizacion incremental. ${error?.message || ''}`.trim(),
        lastErrorAt: new Date().toISOString(),
      });
      return { success: false, message: publicState.message, data: { ...publicState } };
    } finally {
      running = false;
    }
  };

  return {
    run,
    getState: () => ({ ...publicState }),
    resetRuntimeState: () => { publicState = { ...publicState, state: 'inactive', updatedAt: new Date().toISOString() }; },
  };
};
