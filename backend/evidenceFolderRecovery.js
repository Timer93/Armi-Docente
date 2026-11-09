import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildEvidenceRecoveryInventory } from './evidenceRecoveryInventory.js';
import { listEvidenceTombstoneKeys } from './evidenceMirrorIndex.js';

const contained = (root, target) => {
  const relative = path.relative(root, target);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};
const digest = file => {
  const hash = crypto.createHash('sha256'), fd = fs.openSync(file, 'r'), buffer = Buffer.allocUnsafe(1024 * 1024);
  try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
};
const signature = row => JSON.stringify([row.relative_path,row.file_path,row.file_name,row.file_size,row.updated_at]);
const nameKey = name => String(name || '').normalize('NFC').toLowerCase();

export const createEvidenceFolderRecovery = ({db,getContext,relativePath,matches,copy}) => {
  const plans = new Map();
  const analyze = folder => {
    const context = getContext();
    if (!context.automaticMirror) throw new Error('Activa la carpeta espejo antes de recuperar.');
    if (!folder || !path.isAbsolute(folder)) throw new Error('Selecciona una carpeta existente.');
    const root = fs.realpathSync(folder);
    if (!fs.statSync(root).isDirectory()) throw new Error('La ruta seleccionada no es una carpeta.');
    const groups = new Map();
    const inventory = buildEvidenceRecoveryInventory({
      rows: db.prepare('SELECT * FROM evaluacion_evidencias ORDER BY id').all(),
      relativePath, deletedKeys: listEvidenceTombstoneKeys(context.effectivePath),
    });
    for (const group of inventory.groups) {
      const relative = group.relativePath, destination = path.resolve(context.effectivePath, relative);
      if (!relative || !contained(context.effectivePath, destination) || group.rows.every(row => matches(row,destination))) continue;
      groups.set(relative, group.rows);
    }
    const wanted = new Set([...groups].flatMap(([relative,rows])=>[nameKey(path.basename(relative)),...rows.map(row=>nameKey(path.basename(row.file_name || '')))]));
    const files = new Map(), stack = [{folder:root,depth:0}], warnings = []; let count = 0, scannedFiles = 0;
    while (stack.length) {
      const current = stack.pop();
      let children;
      try { children = fs.readdirSync(current.folder,{withFileTypes:true}); }
      catch { if (warnings.length < 20) warnings.push(`No se pudo leer: ${current.folder}`); continue; }
      for (const entry of children) {
        if (++count > 100000) throw new Error('La carpeta es demasiado amplia. Selecciona una subcarpeta de evidencias.');
        if (entry.isSymbolicLink()) continue;
        const file = path.join(current.folder,entry.name);
        if (entry.isDirectory()) {
          if (current.depth < 15) stack.push({folder:file,depth:current.depth+1});
          else if (warnings.length < 20) warnings.push(`Subcarpeta demasiado profunda: ${file}`);
        } else if (entry.isFile()) {
          scannedFiles++;
          if (!wanted.has(nameKey(entry.name))) continue;
          const key = nameKey(entry.name); if (!files.has(key)) files.set(key,[]); files.get(key).push(file);
        }
      }
    }
    const entries = [], unresolved = [];
    for (const [relative,rows] of groups) {
      const storedFiles = files.get(nameKey(path.basename(relative))) || [];
      const originalFiles = [...new Set(rows.flatMap(row=>files.get(nameKey(path.basename(row.file_name || ''))) || []))];
      let candidates = storedFiles.filter(file=>rows.every(row=>matches(row,file)));
      let matchType = 'Nombre guardado y tamaño';
      if (!candidates.length) {
        candidates = originalFiles.filter(file=>rows.every(row=>Number(row.file_size)>0 && matches(row,file)));
        matchType = 'Nombre original y tamaño';
      }
      const exact = path.resolve(root,relative);
      const source = candidates.includes(exact) ? exact : candidates.length === 1 ? candidates[0] : '';
      if (!source) {
        const named = [...new Set([...storedFiles,...originalFiles])];
        unresolved.push({fileName:rows[0].file_name,storedName:path.basename(relative),relativePath:relative,records:rows.length,expectedSize:Number(rows[0].file_size || 0),
          reason:candidates.length?'Varias coincidencias; selecciona una carpeta mas concreta.':named.length?'Se encontró el nombre, pero no coincide el tamaño esperado o falta ese dato. No se enlaza automáticamente.':'No se encontró el nombre guardado ni el original en esta carpeta.',
          candidates:named.slice(0,10).map(file=>{try{return {path:file,size:fs.statSync(file).size};}catch{return {path:file,size:null};}})});
        continue;
      }
      const destination = path.resolve(context.effectivePath,relative);
      if (fs.existsSync(destination)) { unresolved.push({fileName:rows[0].file_name,relativePath:relative,records:rows.length,reason:'Ya existe un archivo en el destino. Se conserva sin sobrescribir.'}); continue; }
      entries.push({fileName:rows[0].file_name,source,destination,relativePath:relative,matchType,size:fs.statSync(source).size,hash:digest(source),records:rows.map(row=>({id:row.id,signature:signature(row)}))});
    }
    for (const [key,plan] of plans) if (plan.expires < Date.now()) plans.delete(key);
    if (plans.size >= 10) plans.delete(plans.keys().next().value);
    const token = crypto.randomUUID();
    plans.set(token,{root,mirror:context.effectivePath,entries,expires:Date.now()+15*60*1000});
    return {token,folder:root,scannedFiles,warnings,historicalFiles:inventory.historicalFiles,duplicateRecords:inventory.duplicateRecords,deletedRecords:inventory.deletedRecords,files:entries.length,records:entries.reduce((n,e)=>n+e.records.length,0),items:entries.map(({hash,records,...entry})=>({...entry,records:records.length})),unresolved};
  };
  const recover = token => {
    const plan = plans.get(token), context = getContext();
    if (!plan || plan.expires < Date.now()) throw new Error('El analisis vencio. Analiza de nuevo la carpeta.');
    plans.delete(token);
    if (!context.automaticMirror || context.effectivePath !== plan.mirror) throw new Error('La carpeta espejo cambio. Analiza de nuevo.');
    const inventory = buildEvidenceRecoveryInventory({ rows: db.prepare('SELECT * FROM evaluacion_evidencias ORDER BY id').all(), relativePath, deletedKeys: listEvidenceTombstoneKeys(context.effectivePath) });
    const activeIds = new Set(inventory.groups.flatMap(group => group.rows.map(row => row.id)));
    const failures = []; let files = 0, records = 0;
    for (const entry of plan.entries) {
      try {
        if (!contained(plan.root,fs.realpathSync(entry.source)) || digest(entry.source)!==entry.hash) throw new Error('El original cambio desde el analisis.');
        let ancestor = path.dirname(entry.destination);
        while (!fs.existsSync(ancestor)) {
          const parent = path.dirname(ancestor);
          if (parent === ancestor) throw new Error('No se pudo verificar el destino.');
          ancestor = parent;
        }
        if (!contained(fs.realpathSync(plan.mirror),fs.realpathSync(ancestor))) throw new Error('La ruta del destino sale de la carpeta espejo.');
        for (const record of entry.records) {
          const row = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id=?').get(record.id);
          if (!row || !activeIds.has(record.id) || signature(row)!==record.signature) throw new Error('El registro cambio desde el analisis.');
        }
        copy(entry.source,entry.destination);
        if (digest(entry.destination)!==entry.hash) throw new Error('La copia no coincide con el archivo analizado.');
        db.transaction(()=>{for(const record of entry.records) db.prepare("UPDATE evaluacion_evidencias SET file_path='',relative_path=?,file_size=? WHERE id=?").run(entry.relativePath,entry.size,record.id);})();
        files++; records+=entry.records.length;
      } catch(error) { failures.push({fileName:entry.fileName,reason:error.message}); }
    }
    return {files,records,failures};
  };
  return {analyze,recover};
};
