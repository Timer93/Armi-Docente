import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASETS, FRONTEND_KEYS, validateRecord } from '../src/academic.js';

const excluded = /password|contrase|api[_-]?key|private[_-]?key|token|secret|credential|descriptor|recovery|image|insignia|logo|avatar|photo|(?:^|_)face|path|evidence_storage/i;
export function portableValue(value, depth = 0) {
  if (depth > 18) throw new Error('Un registro supera la profundidad admitida.');
  if (typeof value === 'string') {
    if (value.trim().startsWith('{') || value.trim().startsWith('[')) {
      try { return portableValue(JSON.parse(value), depth + 1); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    if (/^(?:data:|file:)|(?:[A-Z]:\\|\\\\[^\\]+\\)/i.test(value)) return '';
    return value.replace(/<img\b[^>]*>/gi, '').replace(/data:(?:image|application|audio|video)\/[^\s"'<>]+/gi, '');
  }
  if (Array.isArray(value)) return value.map(item => portableValue(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key,item]) => {
    const rubric = key === 'levelDescriptors' && item && typeof item === 'object' && !Array.isArray(item) && Object.entries(item).every(([level,text]) => ['c','b','a','ad'].includes(level) && typeof text === 'string' && text.length <= 8000);
    return (!excluded.test(key) || rubric) && !['__proto__', 'constructor', 'prototype'].includes(key);
  }).map(([key, item]) => [key, portableValue(item, depth + 1)]));
  return value;
}
const parsed = (value, fallback) => value ? JSON.parse(value) : fallback;

export function createAcademicPackage(db, ownerUsername) {
  if (!ownerUsername || ownerUsername.length > 160) throw new Error('Indica el usuario de ARMI propietario de esta copia.');
  const rows = [];
  const add = (dataset, id, value) => {
    const record = { dataset, id: String(id), value: portableValue(value) };
    if (Buffer.byteLength(JSON.stringify(record.value)) > 256_000) throw new Error(`Un registro de ${dataset} es demasiado grande. No se exportó una copia parcial.`);
    validateRecord(record);
    rows.push(record);
  };
  db.exec('BEGIN');
  try {
    const general = db.prepare('SELECT * FROM datos_generales LIMIT 1').get();
    if (!general) throw new Error('No hay datos generales para exportar.');
    add('general', 'general', general);
    for (const row of db.prepare('SELECT * FROM db_estudiantes ORDER BY id').all()) add('students', row.id, {
      id: row.id, nivel: row.nivel || '', dni: row.dni || '', name: row.estudiantes || '', grade: row.grado || '', section: row.secc || '',
      fechaNacimiento: row.fecha_nacimiento || '', email: row.gmail || '', microsoft: row.outlook || '', estado: row.estado || 'A', group: row.grupo || '', sexo: row.sexo || '', edad: row.edad ?? null,
    });
    const resources = new Map(db.prepare('SELECT * FROM programacion_recursos').all().map(row => [row.id_programa, row]));
    for (const row of db.prepare('SELECT * FROM programacion_anual').all()) {
      const resource = resources.get(row.id_programa) || {};
      add('annual', row.id_programa, { id: row.id_programa, nroPa: row.nro_pa || '', areaId: row.area_id, areaName: row.area_curricular, grade: row.grade, section: row.section,
        matrixChecks: parsed(row.matrix_checks, {}), didacticUnits: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, { title: row[`titulo_u${i + 1}`] || '', situation: row[`st_cont_u${i + 1}`] || '' }])),
        areaPurpose: row.area_purpose || '', areaEnfoque: row.area_enfoque || '', areaStandards: row.area_standards || '', metas_datos: row.metas_datos || null,
        resourceFields: Object.fromEntries(['medios', 'materiales', 'recursos', 'espacios', 'apps', 'softwares', 'plataformas'].map(key => [key, resource[key] || ''])),
        bibliographyFields: { referencias: resource.referencias || '', linkografia: resource.linkografia || '' },
      });
    }
    for (const row of db.prepare('SELECT * FROM unidades_didacticas').all()) add('units', row.id_unidad, {
      ...row, id: row.id_unidad, areaId: row.area_id, unitNumber: row.unit_number,
      criterios: parsed(row.criterios, {}), evidencias: parsed(row.evidencias, {}), instrumentos: parsed(row.instrumentos, {}),
      criteriosTrans: parsed(row.criterios_trans, {}), evidenciasTrans: parsed(row.evidencias_trans, {}), instrumentosTrans: parsed(row.instrumentos_trans, {}),
      sesiones: parsed(row.sesiones, []), recursos: parsed(row.recursos, {}), bibliografia: parsed(row.bibliografia, {}),
    });
    for (const row of db.prepare('SELECT * FROM sesiones').all()) add('sessions', row.id_sesion, {
      ...parsed(row.session_data, {}), id: row.id_sesion, year: row.year, areaId: row.area_id, grade: row.grade, section: row.section, unitNumber: row.unit_number, sessionNumber: row.session_number,
    });
    for (const key of FRONTEND_KEYS) {
      const row = db.prepare('SELECT value FROM armi_frontend_state WHERE key = ?').get(key);
      if (row) add('frontend', key, parsed(row.value, null));
    }
    db.exec('ROLLBACK');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  if (new Set(rows.map(row => `${row.dataset}:${row.id}`)).size !== rows.length) throw new Error('La base contiene identificadores duplicados.');
  const counts = Object.fromEntries(DATASETS.map(dataset => [dataset, rows.filter(row => row.dataset === dataset).length]));
  const fingerprint = createHash('sha256').update(JSON.stringify({ ownerUsername, rows })).digest('hex');
  return { format: 'armi-academic-copy', version: 1, ownerUsername, createdAt: new Date().toISOString(), fingerprint, counts, rows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = name => { const at = process.argv.indexOf(name); return at < 0 ? null : process.argv[at + 1]; };
  const owner = argument('--owner');
  const database = argument('--database') || path.join(process.env.APPDATA, 'ARMI Docente', 'database', 'armi.db');
  const outputRoot = path.join(process.env.LOCALAPPDATA, 'ARMI', 'web-import');
  fs.mkdirSync(outputRoot, { recursive: true });
  const db = new DatabaseSync(database, { readOnly: true });
  let copy;
  try { copy = createAcademicPackage(db, owner); } finally { db.close(); }
  const output = path.join(outputRoot, `armi-academic-${Date.now()}.json`);
  const content = JSON.stringify(copy);
  if (Buffer.byteLength(content) > 20_000_000) throw new Error('La copia supera el límite de esta primera importación.');
  fs.writeFileSync(output, content, { flag: 'wx' });
  console.log(JSON.stringify({ output, counts: copy.counts, bytes: Buffer.byteLength(content) }, null, 2));
}
