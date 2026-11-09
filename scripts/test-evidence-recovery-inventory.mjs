import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildEvidenceRecoveryInventory, calculateEvidenceRecoveryStatus } from '../backend/evidenceRecoveryInventory.js';
import { portableEvidenceKey, writeEvidenceTombstone } from '../backend/evidenceMirrorIndex.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-recovery-inventory-'));
const relativePath = row => row.relative_path;
const row = (id, file, group, version, extra = {}) => ({
  id, relative_path: file, file_name: file, file_size: 4,
  student_id: 'student', session_id: 'session', version_group_id: group,
  version_number: version, is_latest: 1, ...extra,
});
try {
  const rows = [
    row(1, 'old.png', 'group', 1), // Stale is_latest flag must not trigger recovery.
    row(2, 'new.png', 'group', 2),
    row(3, 'old.png', 'group', 1),
    row(4, 'new.png', 'group', 2),
    row(5, 'missing.pdf', 'other', 1),
    row(6, 'missing.pdf', 'other', 1),
    row(7, 'unproven.png', 'unproven', 1, { is_latest: 0 }),
    row(8, 'other-student.png', 'group', 1, { student_id: 'another' }),
    row(9, 'other-session.png', 'group', 1, { session_id: 'another' }),
    row(10, 'deleted.pdf', 'deleted', 1),
  ];
  const before = structuredClone(rows);
  fs.writeFileSync(path.join(root, 'new.png'), 'DATA');
  writeEvidenceTombstone({ root, row: rows.at(-1) });
  const status = calculateEvidenceRecoveryStatus({
    rows, context: { automaticMirror: true, effectivePath: root }, relativePath,
    resolveCandidate: (folder, file) => path.join(folder, file),
    matches: (record, file) => { try { return fs.statSync(file).isFile() && fs.statSync(file).size === record.file_size; } catch { return false; } },
    resolveFile: () => ({ path: '' }),
  });
  assert.equal(status.sharedFiles, 1);
  assert.equal(status.sharedBytes, 4, 'Duplicate records must not multiply bytes.');
  assert.equal(status.missingFiles, 4);
  assert.equal(status.historicalFiles, 1);
  assert.equal(status.deletedRecords, 1);
  assert.equal(status.duplicateRecords, 3);
  assert.equal(status.missingItems.find(item => item.fileName === 'missing.pdf').records, 2);
  assert.deepEqual(rows, before, 'Classification must preserve all history and flags.');
  const missingReplacement = buildEvidenceRecoveryInventory({ rows: [row(1, 'old.png', 'group', 1), row(2, 'missing-new.png', 'group', 2)], relativePath });
  assert.equal(missingReplacement.groups[0].relativePath, 'missing-new.png');
  assert.equal(missingReplacement.historicalFiles, 1);
  const reused = buildEvidenceRecoveryInventory({ rows: [row(1, 'old.png', 'group', 1), row(2, 'new.png', 'group', 2), row(3, 'old.png', 'independent', 1)], relativePath });
  assert.equal(reused.groups.length, 2, 'A file used by another current delivery still needs recovery.');
  assert.equal(reused.historicalFiles, 0);
  const deletedReplacement = buildEvidenceRecoveryInventory({
    rows: [row(1, 'old.png', 'group', 1), row(2, 'new.png', 'group', 2)], relativePath,
    deletedKeys: new Set([portableEvidenceKey('new.png')]),
  });
  assert.equal(deletedReplacement.groups.length, 0, 'Deleting the replacement must not resurrect the old version.');
  console.log('OK: unique file counts, stale flags, version history, missing replacements, scope and recorded deletions.');
} finally {
  const resolved = path.resolve(root);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('armi-recovery-inventory-')) fs.rmSync(resolved, { recursive: true, force: true });
}
