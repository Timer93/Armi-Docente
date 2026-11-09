import fs from 'node:fs';
import { listEvidenceTombstoneKeys, portableEvidenceKey } from './evidenceMirrorIndex.js';

const normalizedPath = value => String(value || '').replace(/\\/g, '/').toLowerCase();
const versionKey = row => row.version_group_id
  ? JSON.stringify([String(row.student_id || ''), String(row.session_id || ''), String(row.version_group_id)])
  : '';

// Classify for recovery only. Historical rows and files remain untouched.
export const buildEvidenceRecoveryInventory = ({ rows, relativePath, deletedKeys = new Set() }) => {
  const retained = rows.filter(row => !deletedKeys.has(row.evidence_key || portableEvidenceKey(relativePath(row))));
  const newest = new Map();
  for (const row of rows) {
    const key = versionKey(row);
    if (key) newest.set(key, Math.max(newest.get(key) || 1, Number(row.version_number) || 1));
  }
  const groups = new Map();
  const historical = new Map();
  for (const row of retained) {
    const relative = relativePath(row);
    const fileKey = normalizedPath(relative || row.file_path) || `record:${row.id}`;
    const key = versionKey(row);
    const replaced = key && (Number(row.version_number) || 1) < newest.get(key);
    const target = replaced ? historical : groups;
    if (!target.has(fileKey)) target.set(fileKey, { relativePath: relative, rows: [] });
    target.get(fileKey).rows.push(row);
  }
  // A file still used by a current delivery remains recoverable.
  for (const key of groups.keys()) historical.delete(key);
  return {
    groups: [...groups.values()],
    historicalFiles: historical.size,
    deletedRecords: rows.length - retained.length,
    duplicateRecords: retained.length - new Set(retained.map(row => normalizedPath(relativePath(row) || row.file_path) || `record:${row.id}`)).size,
  };
};

export const calculateEvidenceRecoveryStatus = ({ rows, context, relativePath, matches, resolveCandidate, resolveFile }) => {
  const inventory = buildEvidenceRecoveryInventory({
    rows, relativePath,
    deletedKeys: context.automaticMirror ? listEvidenceTombstoneKeys(context.effectivePath) : new Set(),
  });
  const result = {
    automaticMirror: context.automaticMirror,
    effectivePath: context.effectivePath,
    legacyConfiguredPath: context.legacyConfiguredPath,
    totalRecords: rows.length,
    totalFiles: inventory.groups.length,
    historicalFiles: inventory.historicalFiles,
    deletedRecords: inventory.deletedRecords,
    duplicateRecords: inventory.duplicateRecords,
    sharedFiles: 0, sharedBytes: 0, recoverableHere: 0, recoverableBytes: 0,
    missingFiles: 0, missingItems: [],
  };
  for (const group of inventory.groups) {
    const row = group.rows[0];
    const canonical = resolveCandidate(context.effectivePath, group.relativePath);
    if (group.rows.every(record => matches(record, canonical))) {
      result.sharedFiles++;
      result.sharedBytes += Number(row.file_size || fs.statSync(canonical).size || 0);
      continue;
    }
    const resolved = group.rows.map(record => resolveFile(record, context))
      .find(candidate => candidate.path && group.rows.every(record => matches(record, candidate.path)));
    if (resolved) {
      result.recoverableHere++;
      result.recoverableBytes += Number(row.file_size || fs.statSync(resolved.path).size || 0);
      continue;
    }
    result.missingFiles++;
    if (result.missingItems.length < 30) result.missingItems.push({
      id: row.id, fileName: row.file_name || '', studentId: row.student_id || '',
      relativePath: group.relativePath, records: group.rows.length,
    });
  }
  return result;
};
