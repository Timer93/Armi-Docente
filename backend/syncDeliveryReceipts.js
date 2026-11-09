import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

export const batchContentHash = batch => crypto.createHash('sha256').update(JSON.stringify(batch)).digest('hex');
const safe = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,300}$/.test(value);
export function recordIncorporatedHead(state, batch, hash = batchContentHash(batch)) {
  state.deliveryHeads ||= {};
  if (!safe(batch.deviceId) || !safe(batch.batchId)) return;
  const previous = state.deliveryHeads[batch.deviceId];
  if (!previous || previous.batchId < batch.batchId) state.deliveryHeads[batch.deviceId] = { batchId: batch.batchId, sha256: hash };
}

export function createDeliveryReceipts({ readJson, writeJson }) {
  let snapshot = { scope: 'database-changes', cloud: 'unverified', peers: [], lastPublication: null };
  let ownCache = null;
  return {
    snapshot: (latest = snapshot.lastPublication, mirrorPath = snapshot.mirrorPath) => latest?.batchId === snapshot.lastPublication?.batchId
      && latest?.sha256 === snapshot.lastPublication?.sha256 && mirrorPath === snapshot.mirrorPath ? snapshot
      : { ...snapshot, lastPublication: latest || null, peers: snapshot.peers.map(peer => ({ ...peer, confirmed: false })) },
    async refresh({ mirrorPath, state, eventSignature, eventCount, canAcknowledge }) {
      const folder = path.join(mirrorPath, '.armi-sync/incremental-v1/receipts');
      const deviceId = state.deviceId;
      if (!safe(deviceId)) return snapshot;
      const ownPath = path.join(folder, `${deviceId}.json`);
      if (canAcknowledge) {
        const payload = { format: 1, identityRevision: 4, scope: 'database-changes', deviceId, label: os.hostname(),
          eventSignature, eventCount, heads: state.deliveryHeads || {} };
        const signature = JSON.stringify(payload);
        if (ownCache?.path !== ownPath || ownCache.signature !== signature) {
          const previous = await readJson(ownPath, null);
          if (!previous || JSON.stringify({ ...previous, confirmedAt: undefined }) !== signature) {
            await fs.mkdir(folder, { recursive: true });
            await writeJson(ownPath, { ...payload, confirmedAt: new Date().toISOString() });
          }
          ownCache = { path: ownPath, signature };
        }
      }
      let entries;
      try { entries = await fs.readdir(folder, { withFileTypes: true }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
      const peers = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name === `${deviceId}.json`) continue;
        const receipt = await readJson(path.join(folder, entry.name), null);
        if (receipt?.format !== 1 || receipt.identityRevision !== 4 || receipt.scope !== 'database-changes'
          || !safe(receipt.deviceId) || entry.name !== `${receipt.deviceId}.json`
          || !Number.isFinite(Date.parse(receipt.confirmedAt))) continue;
        const head = receipt.heads?.[deviceId];
        const confirmed = Boolean(state.lastPublication && ((head?.batchId === state.lastPublication.batchId
          && head.sha256 === state.lastPublication.sha256) || (canAcknowledge
          && receipt.eventSignature === eventSignature && receipt.eventCount === eventCount)));
        peers.push({ deviceId: receipt.deviceId, label: typeof receipt.label === 'string' ? receipt.label.slice(0, 100) : receipt.deviceId,
          confirmed, confirmedAt: receipt.confirmedAt,
          eventSignature: receipt.eventSignature, eventCount: receipt.eventCount });
      }
      snapshot = { scope: 'database-changes', cloud: 'unverified', mirrorPath, peers,
        lastPublication: state.lastPublication || null, localCopyPreparedAt: state.lastPublication?.createdAt || null };
      return snapshot;
    },
  };
}
