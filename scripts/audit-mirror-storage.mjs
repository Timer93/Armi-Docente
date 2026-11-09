// Read-only audit: metadata plus bounded samples. Never changes the mirror.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const config = read(path.join(process.env.APPDATA, 'ARMI Docente/sync-runtime/sync-config.json'));
const root = path.join(config.mirrorPath, '.armi-sync/incremental-v1');
const local = read(path.join(process.env.APPDATA, 'ARMI Docente/sync-runtime/incremental-identity-state.json'));
const applied = new Set(local.appliedBatches || []);
const report = { mirror: config.mirrorPath, sampledOnly: true,
  local: { deviceId: local.deviceId, lastRunAt: local.lastRunAt,
    identityPending: local.identityPending, reconciliationPending: local.reconciliationPending }, devices: [] };
for (const device of fs.readdirSync(path.join(root, 'devices'), { withFileTypes: true })) {
  if (!device.isDirectory()) continue;
  const events = path.join(root, 'devices', device.name, 'events');
  if (!fs.existsSync(events)) continue;
  const files = fs.readdirSync(events).filter(name => name.endsWith('.json')).map(name => {
    const stat = fs.statSync(path.join(events, name));
    return { name, bytes: stat.size, acknowledgedLocally: applied.has(name.slice(0, -5)) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const selected = [...new Map([files[0], ...files.slice(-2), ...[...files].sort((a,b)=>b.bytes-a.bytes).slice(0,2)]
    .filter(Boolean).map(file => [file.name, file])).values()];
  const samples = selected.map(file => {
    const batch = read(path.join(events, file.name));
    const operations = batch.operations || [];
    const tables = {};
    for (const op of operations) {
      const entry = tables[op.table] ||= { operations: 0, bytes: 0 };
      entry.operations++; entry.bytes += Buffer.byteLength(JSON.stringify(op));
    }
    return { ...file, createdAt: batch.createdAt, operations: operations.length,
      referencesBytes: Buffer.byteLength(JSON.stringify(batch.references || {})),
      operationsSha256: crypto.createHash('sha256').update(JSON.stringify(operations)).digest('hex'), tables };
  });
  report.devices.push({ deviceId: device.name, files: files.length,
    bytes: files.reduce((sum,file)=>sum+file.bytes,0),
    unacknowledgedLocally: files.filter(file=>!file.acknowledgedLocally).length,
    first: files[0]?.name, last: files.at(-1)?.name, samples });
}
console.log(JSON.stringify(report, null, 2));
