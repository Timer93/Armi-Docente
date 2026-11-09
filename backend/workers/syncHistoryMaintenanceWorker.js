import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createLocalSyncHistoryMaintenance } from '../syncHistoryMaintenance.js';

const permissions = new Map();
process.on('disconnect', () => process.exit(0));
process.on('message', async message => {
  if (message.type === 'retire-answer') { permissions.get(message.id)?.(message.allowed); permissions.delete(message.id); return; }
  if (message.type !== 'run') return;
  try {
    const readJson = async (file, fallback) => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; } };
    const writeJson = async (file, value) => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(value)); await fs.rename(temporary, file);
    };
    const service = createLocalSyncHistoryMaintenance({ runtimeFolder: message.runtimeFolder, readJson, writeJson,
      options: { ...message.options, intervalMs: 0 } });
    await service.tick({ ...message.input, applied: new Set(message.input.applied), canRetire: () => new Promise(resolve => {
      const id = crypto.randomUUID(); permissions.set(id, resolve); process.send?.({ type: 'retire-check', id });
    }) });
    process.send?.({ type: 'complete', snapshot: service.snapshot() }, () => process.disconnect());
  } catch {
    process.send?.({ type: 'complete', snapshot: { state: 'deferred', message: 'La revisión aislada no terminó; se conservan las publicaciones equivalentes.',
      retiredFiles: 0, retiredBytes: 0, cloudSpaceReclaimed: false } }, () => process.disconnect());
  }
});
