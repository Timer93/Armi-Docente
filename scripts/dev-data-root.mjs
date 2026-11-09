import fs from 'node:fs';
import path from 'node:path';

export const resolveDevDataRoot = (projectRoot, env = process.env) => {
  const configFile = path.join(projectRoot, 'armi-dev.local');
  let configured = env.ARMI_DATA_ROOT;
  if (!configured && fs.existsSync(configFile)) {
    configured = JSON.parse(fs.readFileSync(configFile, 'utf8')).dataRoot;
    if (typeof configured !== 'string' || !configured.trim()) throw new Error('armi-dev.local debe indicar dataRoot.');
  }
  if (!configured) return projectRoot;
  const root = path.resolve(projectRoot, configured);
  if (!fs.existsSync(path.join(root, 'database', 'armi.db'))) {
    throw new Error(`No existe database/armi.db en la carpeta configurada: ${root}. No se iniciará una base vacía.`);
  }
  return root;
};
