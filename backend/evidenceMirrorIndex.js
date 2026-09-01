import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const INDEX_FOLDER = '.armi-evidence-index';
const RECORDS_FOLDER = 'records';
const TOMBSTONES_FOLDER = 'tombstones';

const ensureDir = (target) => fs.mkdirSync(target, { recursive: true });

const writeJsonAtomic = (targetPath, payload) => {
  ensureDir(path.dirname(targetPath));
  const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(temporaryPath, targetPath);
};

const readJson = (targetPath) => {
  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch {
    return null;
  }
};

const hashFile = (targetPath) => {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(targetPath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest('hex');
  } finally {
    fs.closeSync(descriptor);
  }
};

const normalizeRelativePath = (value) => String(value || '')
  .replace(/\\/g, '/')
  .replace(/^\/+/, '')
  .replace(/\/{2,}/g, '/');

const safeJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const portableEvidenceKey = (relativePath) => {
  const normalized = normalizeRelativePath(relativePath).toLocaleLowerCase('en-US');
  if (!normalized) return '';
  return `evidence-${crypto.createHash('sha256').update(normalized).digest('hex')}`;
};

const resolveSafeEvidencePath = (root, relativePath) => {
  const normalized = normalizeRelativePath(relativePath);
  if (!root || !normalized) return '';
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...normalized.split('/'));
  const relative = path.relative(resolvedRoot, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return '';
  return candidate;
};

const compareTimestamp = (left, right) => {
  const leftMs = Date.parse(String(left || '').replace(' ', 'T') + (String(left || '').includes('Z') ? '' : 'Z')) || 0;
  const rightMs = Date.parse(String(right || '').replace(' ', 'T') + (String(right || '').includes('Z') ? '' : 'Z')) || 0;
  return leftMs - rightMs;
};

const indexPaths = (root) => {
  const indexRoot = path.join(root, INDEX_FOLDER);
  return {
    indexRoot,
    recordsRoot: path.join(indexRoot, RECORDS_FOLDER),
    tombstonesRoot: path.join(indexRoot, TOMBSTONES_FOLDER),
  };
};

const ensureIndex = (root) => {
  const locations = indexPaths(root);
  ensureDir(locations.recordsRoot);
  ensureDir(locations.tombstonesRoot);
  const markerPath = path.join(locations.indexRoot, 'README.json');
  if (!fs.existsSync(markerPath)) {
    writeJsonAtomic(markerPath, {
      format: 1,
      application: 'ARMI Docente',
      purpose: 'Indice portatil para relacionar cada evidencia con su estudiante, unidad y sesion en cualquier PC.',
      warning: 'No elimine ni edite esta carpeta manualmente.',
    });
  }
  return locations;
};

const metadataFromRow = (row, evidencePath) => {
  const relativePath = normalizeRelativePath(row?.relative_path);
  const evidenceKey = String(row?.evidence_key || portableEvidenceKey(relativePath));
  if (!evidenceKey || !relativePath) return null;
  const stats = evidencePath && fs.existsSync(evidencePath) ? fs.statSync(evidencePath) : null;
  return {
    format: 1,
    evidenceKey,
    relativePath,
    fileName: String(row?.file_name || path.basename(relativePath)),
    fileSize: Number(row?.file_size || stats?.size || 0),
    fileType: String(row?.file_type || ''),
    studentId: String(row?.student_id || ''),
    studentDni: String(row?.student_dni || ''),
    studentIds: safeJsonArray(row?.student_ids).map(String),
    studentNames: safeJsonArray(row?.student_names).map(String),
    sessionId: String(row?.session_id || ''),
    criteriaId: String(row?.criteria_id || ''),
    year: String(row?.year || ''),
    areaId: String(row?.area_id || ''),
    grade: String(row?.grade || ''),
    section: String(row?.section || ''),
    bimester: String(row?.bimester || ''),
    unitNumber: String(row?.unit_number || ''),
    sessionNumber: String(row?.session_number || ''),
    observation: String(row?.observation || ''),
    source: String(row?.source || 'teacher'),
    versionGroupId: String(row?.version_group_id || evidenceKey),
    versionNumber: Math.max(1, Number(row?.version_number || 1)),
    isLatest: Number(row?.is_latest ?? 1) === 1,
    submittedAt: String(row?.submitted_at || row?.updated_at || new Date().toISOString()),
    submissionIp: String(row?.submission_ip || ''),
    submissionUserAgent: String(row?.submission_user_agent || ''),
    updatedAt: String(row?.updated_at || row?.submitted_at || new Date().toISOString()),
    indexedAt: new Date().toISOString(),
  };
};

const writeEvidenceMetadata = ({ root, row, evidencePath }) => {
  if (!root || !row) return null;
  const locations = ensureIndex(root);
  const metadata = metadataFromRow(row, evidencePath);
  if (!metadata) return null;
  const tombstonePath = path.join(locations.tombstonesRoot, `${metadata.evidenceKey}.json`);
  const tombstone = readJson(tombstonePath);
  if (tombstone && compareTimestamp(tombstone.deletedAt, metadata.updatedAt) >= 0) return null;
  const recordPath = path.join(locations.recordsRoot, `${metadata.evidenceKey}.json`);
  const existing = readJson(recordPath);
  if (existing && compareTimestamp(existing.updatedAt, metadata.updatedAt) > 0) return null;
  if (existing) {
    const withoutGeneratedFields = (value) => {
      const copy = { ...value };
      delete copy.indexedAt;
      delete copy.fileChecksum;
      return JSON.stringify(copy);
    };
    if (withoutGeneratedFields(existing) === withoutGeneratedFields(metadata)) return null;
  }
  if (evidencePath && fs.existsSync(evidencePath)) metadata.fileChecksum = hashFile(evidencePath);
  writeJsonAtomic(recordPath, metadata);
  return metadata;
};

const writeEvidenceTombstone = ({ root, row }) => {
  if (!root || !row) return null;
  const relativePath = normalizeRelativePath(row.relative_path);
  const evidenceKey = String(row.evidence_key || portableEvidenceKey(relativePath));
  if (!evidenceKey) return null;
  const locations = ensureIndex(root);
  const payload = {
    format: 1,
    evidenceKey,
    relativePath,
    deletedAt: new Date().toISOString(),
  };
  writeJsonAtomic(path.join(locations.tombstonesRoot, `${evidenceKey}.json`), payload);
  try { fs.rmSync(path.join(locations.recordsRoot, `${evidenceKey}.json`), { force: true }); } catch {}
  return payload;
};

const reconcileEvidenceMirrorIndex = ({ db, root }) => {
  if (!db || !root || !fs.existsSync(root)) {
    return { enabled: false, exported: 0, imported: 0, updated: 0, deletedLinks: 0, pendingFiles: 0, invalidRecords: 0 };
  }
  const locations = ensureIndex(root);
  let exported = 0;
  let imported = 0;
  let updated = 0;
  let deletedLinks = 0;
  let pendingFiles = 0;
  let invalidRecords = 0;

  const updateKey = db.prepare(`UPDATE evaluacion_evidencias SET evidence_key = ? WHERE id = ?`);
  const findKeyOwner = db.prepare('SELECT id FROM evaluacion_evidencias WHERE evidence_key = ? LIMIT 1');
  const findStudent = db.prepare('SELECT id, dni, grado, secc, estudiantes FROM db_estudiantes WHERE id = ?');
  const findStudentByDni = db.prepare('SELECT id, dni, grado, secc, estudiantes FROM db_estudiantes WHERE dni = ? LIMIT 1');
  const normalizeStudentScope = db.prepare(`
    UPDATE evaluacion_evidencias
    SET grade = ?, section = ?, student_names = ?, updated_at = updated_at
    WHERE id = ?
  `);
  const localRows = db.prepare('SELECT * FROM evaluacion_evidencias ORDER BY id').all();
  localRows.forEach((originalRow) => {
    let row = originalRow;
    if (String(row.source || '') === 'student_portal' && String(row.student_id || '').trim()) {
      const student = findStudent.get(String(row.student_id));
      const actualGrade = String(student?.grado || row.grade || '');
      const actualSection = String(student?.secc || row.section || '');
      const names = safeJsonArray(row.student_names);
      const actualNames = names.length ? names : student?.estudiantes ? [String(student.estudiantes)] : [];
      if (actualGrade !== String(row.grade || '') || actualSection !== String(row.section || '') || names.length === 0) {
        normalizeStudentScope.run(actualGrade, actualSection, JSON.stringify(actualNames), row.id);
        row = { ...row, grade: actualGrade, section: actualSection, student_names: JSON.stringify(actualNames) };
      }
      row = { ...row, student_dni: String(student?.dni || '') };
    }
    const relativePath = normalizeRelativePath(row.relative_path);
    const evidenceKey = String(row.evidence_key || portableEvidenceKey(relativePath));
    if (!relativePath || !evidenceKey) return;
    const keyOwner = findKeyOwner.get(evidenceKey);
    if (keyOwner && Number(keyOwner.id) !== Number(row.id)) return;
    if (!row.evidence_key) updateKey.run(evidenceKey, row.id);
    const evidencePath = resolveSafeEvidencePath(root, relativePath);
    if (!evidencePath || !fs.existsSync(evidencePath)) return;
    if (writeEvidenceMetadata({ root, row: { ...row, evidence_key: evidenceKey }, evidencePath })) exported += 1;
  });

  const tombstones = fs.readdirSync(locations.tombstonesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  tombstones.forEach((entry) => {
    const tombstone = readJson(path.join(locations.tombstonesRoot, entry.name));
    if (!tombstone?.evidenceKey) return;
    const existing = db.prepare('SELECT id, updated_at FROM evaluacion_evidencias WHERE evidence_key = ?').get(String(tombstone.evidenceKey));
    if (existing && compareTimestamp(tombstone.deletedAt, existing.updated_at) >= 0) {
      db.prepare('DELETE FROM evaluacion_evidencias WHERE id = ?').run(existing.id);
      deletedLinks += 1;
    }
  });

  const insert = db.prepare(`
    INSERT INTO evaluacion_evidencias (
      evidence_key, student_id, session_id, criteria_id, file_path, file_type, observation,
      year, area_id, grade, section, bimester, unit_number, session_number,
      student_ids, student_names, file_name, file_size, relative_path, source,
      version_group_id, version_number, is_latest, submitted_at, submission_ip,
      submission_user_agent, updated_at
    ) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE evaluacion_evidencias SET
      student_id = ?, session_id = ?, criteria_id = ?, file_path = '', file_type = ?, observation = ?,
      year = ?, area_id = ?, grade = ?, section = ?, bimester = ?, unit_number = ?, session_number = ?,
      student_ids = ?, student_names = ?, file_name = ?, file_size = ?, relative_path = ?, source = ?,
      version_group_id = ?, version_number = ?, is_latest = ?, submitted_at = ?, submission_ip = ?,
      submission_user_agent = ?, updated_at = ?
    WHERE id = ?
  `);

  const records = fs.readdirSync(locations.recordsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  const transaction = db.transaction(() => {
    records.forEach((entry) => {
      const metadata = readJson(path.join(locations.recordsRoot, entry.name));
      const relativePath = normalizeRelativePath(metadata?.relativePath);
      const expectedKey = portableEvidenceKey(relativePath);
      if (!metadata || metadata.format !== 1 || !relativePath || metadata.evidenceKey !== expectedKey
        || !metadata.studentId || !metadata.sessionId || !metadata.year || !metadata.grade
        || !metadata.unitNumber || !metadata.sessionNumber) {
        invalidRecords += 1;
        return;
      }
      const evidencePath = resolveSafeEvidencePath(root, relativePath);
      if (!evidencePath || !fs.existsSync(evidencePath)) {
        pendingFiles += 1;
        return;
      }
      const actualSize = Number(fs.statSync(evidencePath).size);
      if (Number(metadata.fileSize || 0) > 0 && actualSize !== Number(metadata.fileSize)) {
        pendingFiles += 1;
        return;
      }
      const tombstone = readJson(path.join(locations.tombstonesRoot, `${metadata.evidenceKey}.json`));
      if (tombstone && compareTimestamp(tombstone.deletedAt, metadata.updatedAt) >= 0) return;

      const existing = db.prepare(`
        SELECT * FROM evaluacion_evidencias
        WHERE evidence_key = ? OR REPLACE(relative_path, '\\', '/') = ?
        ORDER BY CASE WHEN evidence_key = ? THEN 0 ELSE 1 END, id LIMIT 1
      `).get(metadata.evidenceKey, relativePath, metadata.evidenceKey);
      const incomingIsNewer = !existing || !existing.evidence_key || compareTimestamp(metadata.updatedAt, existing.updated_at) > 0;
      if (incomingIsNewer && metadata.fileChecksum && hashFile(evidencePath) !== String(metadata.fileChecksum)) {
        pendingFiles += 1;
        return;
      }
      const matchedStudent = metadata.studentDni ? findStudentByDni.get(String(metadata.studentDni)) : null;
      const resolvedStudentId = String(matchedStudent?.id || metadata.studentId);
      const portableStudentIds = safeJsonArray(metadata.studentIds).map(String);
      if (matchedStudent && portableStudentIds.length === 1) portableStudentIds[0] = resolvedStudentId;
      const values = [
        resolvedStudentId, String(metadata.sessionId), String(metadata.criteriaId || ''),
        String(metadata.fileType || ''), String(metadata.observation || ''), String(metadata.year),
        String(metadata.areaId || ''), String(metadata.grade), String(metadata.section || ''),
        String(metadata.bimester || ''), String(metadata.unitNumber), String(metadata.sessionNumber),
        JSON.stringify(portableStudentIds),
        JSON.stringify(safeJsonArray(metadata.studentNames).map(String)),
        String(metadata.fileName || path.basename(relativePath)), actualSize, relativePath,
        String(metadata.source || 'student_portal'), String(metadata.versionGroupId || metadata.evidenceKey),
        Math.max(1, Number(metadata.versionNumber || 1)), metadata.isLatest === false ? 0 : 1,
        String(metadata.submittedAt || metadata.updatedAt || new Date().toISOString()),
        String(metadata.submissionIp || ''), String(metadata.submissionUserAgent || ''),
        String(metadata.updatedAt || metadata.submittedAt || new Date().toISOString()),
      ];
      if (!existing) {
        insert.run(metadata.evidenceKey, ...values);
        imported += 1;
      } else if (incomingIsNewer) {
        if (!existing.evidence_key) updateKey.run(metadata.evidenceKey, existing.id);
        update.run(...values, existing.id);
        updated += 1;
      }
    });
  });
  transaction();

  return { enabled: true, exported, imported, updated, deletedLinks, pendingFiles, invalidRecords };
};

export {
  portableEvidenceKey,
  reconcileEvidenceMirrorIndex,
  resolveSafeEvidencePath,
  writeEvidenceMetadata,
  writeEvidenceTombstone,
};
