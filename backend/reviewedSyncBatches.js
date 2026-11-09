import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const reviewedSyncDigest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const allowedKeys = new Set(['armi_view_selection_sesiones_v1', 'armi_view_selection_unidades_v1', 'armi_fast_session_index_v1', 'armi_ai_usage_daily_v1', 'armi_birthdays_toast_seen', 'armi_holidays_v7', 'armi_hybrid_numeric_scores_v1']);
const safeName = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,300}$/.test(value);
const eventPath = (mirror, deviceId, batchId) => safeName(deviceId) && safeName(batchId)
  ? path.join(mirror, '.armi-sync/incremental-v1/devices', deviceId, 'events', `${batchId}.json`) : null;

export function hasVerifiedNumericCache(db) {
  try {
    const saved = db.prepare("SELECT value FROM armi_frontend_state WHERE key='armi_hybrid_numeric_scores_v1'").get();
    const cache = JSON.parse(saved?.value || 'null');
    if (!cache || Array.isArray(cache) || typeof cache !== 'object') return false;
    const expected = {};
    for (const row of db.prepare("SELECT * FROM evaluacion_registros WHERE grading_mode='hybrid_vigesimal' ORDER BY updated_at,id").all()) {
      if (row.numeric_score != null) expected[`${row.session_id}::${row.student_id}::${row.criteria_id}`] = Number(row.numeric_score);
    }
    // New official rows may not have reached the browser cache yet. Keeping a
    // verified subset cannot erase those rows: this path never imports a cache.
    return Object.keys(cache).length > 0 && Object.entries(cache).every(([key, score]) => Object.hasOwn(expected, key) && expected[key] === score);
  } catch { return false; }
}

// A reviewed receipt can recognize only the exact old preference batches that
// were archived. It cannot import grades, waive identity checks for new data,
// or acknowledge a modified/recreated batch. The calendar replacement must
// already have passed through the normal replication engine on this PC.
export async function reviewedLegacyBatchDecisions({ db, mirrorPath, state, batches, readJson }) {
  if (!state.identityMigrationId || !batches.some(batch => batch.format === 1)) return [];
  const root = path.join(mirrorPath, '.armi-sync/reconciliation-audits');
  let folders;
  try { folders = await fs.promises.readdir(root, { withFileTypes: true }); } catch { return []; }
  const applied = new Set(state.appliedBatches || []), decisions = [];
  let cacheVerified;
  for (const folder of folders.filter(item => item.isDirectory())) {
    const receipt = await readJson(path.join(root, folder.name, 'sync-resolution.json'), null);
    if (receipt?.format !== 1 || receipt.migrationId !== state.identityMigrationId
      || receipt.policy !== 'retain-verified-current-and-apply-approved-calendar' || receipt.preserveAcademicData !== true
      || !Array.isArray(receipt.batches) || !receipt.batches.length || receipt.batches.length > 100) continue;
    const approved = receipt.approvedCalendar;
    if (!approved || !applied.has(approved.batchId)) continue;
    const approvedPath = eventPath(mirrorPath, approved.deviceId, approved.batchId);
    if (!approvedPath) continue;
    const calendarBatch = await readJson(approvedPath, null);
    const calendar = calendarBatch?.operations?.[0];
    if (calendarBatch?.format !== 2 || calendarBatch.batchId !== approved.batchId || calendarBatch.deviceId !== approved.deviceId
      || reviewedSyncDigest(calendarBatch) !== approved.sha256 || !Array.isArray(calendarBatch.operations) || calendarBatch.operations.length !== 1
      || calendar?.table !== 'armi_frontend_state' || calendar.action !== 'upsert' || calendar.row?.key !== 'armi_holidays_v7') continue;
    for (const batch of batches) {
      const reviewed = receipt.batches.find(item => item?.batchId === batch.batchId && item.deviceId === batch.deviceId);
      if (!reviewed || batch.format !== 1 || reviewed.sha256 !== reviewedSyncDigest(batch) || reviewed.decision !== 'retain-verified-current') continue;
      if (!batch.operations.length || !batch.operations.every(op => op?.table === 'armi_frontend_state' && op.action === 'upsert'
        && allowedKeys.has(op.row?.key) && JSON.stringify(op.keyColumns) === '["key"]'
        && JSON.stringify(op.keyValues) === JSON.stringify([op.row.key]) && op.key === JSON.stringify([['key'], [op.row.key]]))) continue;
      if (batch.operations.some(op => op.row.key === 'armi_hybrid_numeric_scores_v1')) {
        cacheVerified ??= hasVerifiedNumericCache(db);
        if (!cacheVerified) continue;
      }
      decisions.push({ batchId: batch.batchId, receipt: folder.name, receiptSha256: reviewedSyncDigest(receipt), migrationId: receipt.migrationId });
    }
  }
  return [...new Map(decisions.map(decision => [decision.batchId, decision])).values()];
}
