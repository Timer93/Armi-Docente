import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const resourceChecksum = async file => {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};

const titleFor = relativePath => {
  const name = path.basename(relativePath);
  const session = name.match(/-S(\d+)-/i)?.[1];
  const kind = /annex1|anexo.?1/i.test(name) ? 'Motivación' : /annex2|anexo.?2/i.test(name) ? 'Práctica'
    : /instructive|instructivo/i.test(name) ? 'Instructivo' : 'Recurso';
  return session ? `Sesión ${session} · ${kind}` : name;
};

// Only genuine differing file versions enter this queue; old sync audit records do not.
export const createResourceConflictStore = root => {
  const recordPath = id => {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Conflicto no válido.');
    return path.join(root, id, 'record.json');
  };
  const save = record => {
    const file = recordPath(record.id), temporary = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(record));
    fs.renameSync(temporary, file);
  };
  const read = id => JSON.parse(fs.readFileSync(recordPath(id), 'utf8'));
  const all = () => !fs.existsSync(root) ? [] : fs.readdirSync(root).filter(id => /^[a-f0-9]{64}$/.test(id))
    .map(read);
  const summary = record => ({ id: record.id, title: titleFor(record.relativePath), fileName: path.basename(record.relativePath),
    createdAt: record.createdAt, versions: ['local', 'mirror'].map(key => ({ key,
      label: key === 'local' ? 'Este equipo' : 'Carpeta espejo', size: record[key].size, modifiedAt: record[key].modifiedAt })) });
  const capture = async ({ relativePath, localPath, mirrorPath }) => {
    const [localHash, mirrorHash] = await Promise.all([resourceChecksum(localPath), resourceChecksum(mirrorPath)]);
    if (localHash === mirrorHash) return null;
    const id = crypto.createHash('sha256').update([relativePath, localHash, mirrorHash].join('|')).digest('hex');
    if (fs.existsSync(recordPath(id))) {
      const existing = read(id);
      if (existing.status !== 'pending') { existing.status = 'pending'; existing.createdAt = new Date().toISOString(); save(existing); }
      return summary(existing);
    }
    fs.mkdirSync(path.join(root, id), { recursive: true });
    const record = { id, relativePath, localPath, mirrorPath, status: 'pending', createdAt: new Date().toISOString() };
    for (const [key, source, hash] of [['local', localPath, localHash], ['mirror', mirrorPath, mirrorHash]]) {
      const file = path.join(root, id, `${key}${path.extname(source)}`);
      await fs.promises.copyFile(source, file);
      if (await resourceChecksum(file) !== hash) throw new Error('El recurso cambió durante la revisión. Se volverá a comprobar.');
      const stat = fs.statSync(source);
      record[key] = { file, checksum: hash, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    }
    save(record);
    for (const older of all()) if (older.id !== id && older.relativePath === relativePath && older.status === 'pending') {
      older.status = 'superseded'; save(older);
    }
    return summary(record);
  };
  const list = () => all().filter(record => record.status === 'pending').map(summary);
  const snapshot = (id, version) => {
    if (!['local', 'mirror'].includes(version)) throw new Error('Versión no válida.');
    const record = read(id);
    return { file: record[version].file, name: path.basename(record.relativePath) };
  };
  const resolve = async (id, version, copy) => {
    if (!['local', 'mirror'].includes(version)) throw new Error('Elige una versión.');
    const record = read(id);
    if (record.status !== 'pending') throw new Error('Este recurso ya fue revisado.');
    const [localHash, mirrorHash] = await Promise.all([resourceChecksum(record.localPath), resourceChecksum(record.mirrorPath)]);
    if (localHash !== record.local.checksum || mirrorHash !== record.mirror.checksum) {
      throw new Error('El recurso tiene cambios nuevos. Espera a que termine la revisión y vuelve a elegir.');
    }
    const chosen = record[version];
    if (await resourceChecksum(chosen.file) !== chosen.checksum) throw new Error('No se pudo verificar la versión guardada.');
    // Both snapshots remain available as a backup after the choice.
    if (version === 'mirror') await copy(chosen.file, record.localPath, chosen.checksum);
    else await copy(chosen.file, record.mirrorPath, chosen.checksum);
    const now = new Date();
    fs.utimesSync(record.localPath, now, now);
    record.status = 'resolved'; record.selected = version; record.resolvedAt = now.toISOString(); save(record);
    return { success: true };
  };
  return { capture, list, snapshot, resolve };
};
