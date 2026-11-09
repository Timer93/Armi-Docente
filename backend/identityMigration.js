import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readMirrorJson } from './mirrorJsonReader.js';

export const IDENTITY_MIGRATION_MARKER = '.armi-sync/identity-migration-v4.json';
export const IDENTITY_LOCAL_TABLES = ['armi_sync_identity_map','armi_sync_migration_archive','armi_sync_migration_log'];
export const IDENTITY_REPLACED_TABLES = ['sesiones','evaluacion_registros','evaluacion_conclusiones',
  'student_deletion_tombstones',
  'asistencia_registros','asistencia_rostros','evaluacion_evidencias','interactive_activity_results',
  'interactive_activity_attempts','student_achievement_points','student_forum_posts','student_forum_attachments',
  'student_forum_comments','student_forum_reports','student_forum_notifications','student_forum_drafts',
  'student_learning_journal','resultados_diagnóstico','db_egresados','evaluacion_ventanas_entrega'];
export const IDENTITY_PARENT_TABLES = ['db_estudiantes','evaluacion_instrumentos'];
export const identityStable = value => Array.isArray(value) ? value.map(identityStable) : value && typeof value==='object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,identityStable(value[key])])) : value;
export const identityDigest = value => crypto.createHash('sha256').update(JSON.stringify(identityStable(value))).digest('hex');
const quote = value => '"'+String(value).replaceAll('"','""')+'"';
const has = (db,table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
const read = (file,fallback=null) => {try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}};
export const atomicIdentityJson = async (file,value) => {
  await fs.promises.mkdir(path.dirname(file),{recursive:true});
  const temporary=`${file}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temporary,JSON.stringify(value));await fs.promises.rename(temporary,file);
};
export const identityTableRows = (db,table) => {
  if(!has(db,table)) return [];
  const keys=db.prepare(`PRAGMA table_info(${quote(table)})`).all().filter(row=>row.pk).sort((a,b)=>a.pk-b.pk).map(row=>quote(row.name));
  return db.prepare(`SELECT * FROM ${quote(table)}${keys.length?' ORDER BY '+keys.join(','):''}`).all();
};
export const identityFingerprints = (db,tables) => Object.fromEntries(tables.filter(table=>has(db,table)).map(table=>[table,identityDigest(identityTableRows(db,table))]));
// These fields are local storage details, not academic edits. Row multiplicity,
// every grade/text and every referenced student ID remain protected. Original
// storage IDs and save timestamps remain available in the backup and archive.
const semanticExcluded = {evaluacion_registros:['id','updated_at'],evaluacion_conclusiones:['id','updated_at'],
  student_forum_drafts:['updated_at'],db_estudiantes:['password_recovery_cipher']};
export const identitySemanticFingerprints = (db,tables) => Object.fromEntries(tables.filter(table=>has(db,table)).map(table=>{
  const excluded=new Set(semanticExcluded[table] || []);
  const hashes=identityTableRows(db,table).map(row=>identityDigest(Object.fromEntries(Object.entries(row).filter(([key])=>!excluded.has(key))))).sort();
  return [table,{count:hashes.length,sha256:identityDigest(hashes)}];
}));
export const legacyIdentityRowHash = (table,row) => {
  const excluded={datos_generales:['path_word_default','evidence_storage_path'],db_estudiantes:['password_recovery_cipher'],
    evaluacion_registros:['id'],evaluacion_evidencias:['file_path','id']}[table] || [];
  const portable=Object.fromEntries(Object.entries(row).filter(([key])=>!excluded.includes(key)));
  if(table==='evaluacion_evidencias' && (portable.student_dni || portable.student_names)) {delete portable.student_id;delete portable.student_ids;}
  return identityDigest(portable);
};
const pending = (message,requiresAction=false) => {
  const error=new Error(message);error.code='ARMI_IDENTITY_PENDING';
  error.syncTask={kind:'identity-migration',label:'Verificación de la reparación',detail:message,requiresAction};
  throw error;
};

export async function applyPreparedIdentityMigration({db,runtimeFolder,mirrorPath,deviceId,saved,importSnapshot}) {
  const markerPath=path.join(mirrorPath,IDENTITY_MIGRATION_MARKER);
  if(!fs.existsSync(markerPath)) return {applied:false,saved};
  const marker=await readMirrorJson(markerPath);
  if(!marker) pending('ARMI no pudo completar la lectura de identity-migration-v4.json. Reintentará automáticamente; los datos locales se conservan.');
  if(marker.format!==1 || !/^[a-zA-Z0-9-]+$/.test(marker.id || '') || !/^[a-f0-9]{64}$/.test(marker.payloadSha256 || '')) pending('El manifiesto de migracion no es valido.');
  const log=has(db,'armi_sync_migration_log') ? db.prepare('SELECT * FROM armi_sync_migration_log WHERE migration_id=?').get(marker.id) : null;
  if(log && log.payload_sha256!==marker.payloadSha256) pending('La migracion ya aplicada tiene una huella diferente.');
  if(log && saved?.identityMigrationId===marker.id) return {applied:false,saved};
  const folder=path.join(mirrorPath,'.armi-sync','identity-migrations');
  const file=path.resolve(mirrorPath,String(marker.payloadPath || ''));
  const relative=path.relative(path.resolve(folder),file);
  if(relative.startsWith('..') || path.isAbsolute(relative)) pending('La ruta de migracion no pertenece al espejo.');
  let payload=await readMirrorJson(file);
  if(!payload) pending('ARMI no pudo completar la lectura del paquete de reparación. Reintentará automáticamente; los datos locales se conservan.');
  if(payload.id!==marker.id || payload.format!==1 || identityDigest(payload)!==marker.payloadSha256) pending('La union recibida no coincide con su verificacion de integridad.');
  let authorityUpdateSha256=null;
  let observedVersions={};
  if(marker.authorityUpdate?.deviceId===deviceId) {
    const updatePath=path.resolve(mirrorPath,String(marker.authorityUpdate.path || ''));
    const inside=path.relative(path.join(folder,marker.id),updatePath);
    if(inside.startsWith('..') || path.isAbsolute(inside)) pending('La revisión de la reparación tiene una ruta inválida.',true);
    const update=await readMirrorJson(updatePath);
    if(!update) pending('ARMI está leyendo la revisión que conserva los cambios recientes. Reintentará automáticamente.');
    if(update.migrationId!==marker.id || update.basePayloadSha256!==marker.payloadSha256
      || update.deviceId!==deviceId || identityDigest(update)!==marker.authorityUpdate.sha256) pending('La revisión de la reparación no coincide con su verificación.',true);
    authorityUpdateSha256=marker.authorityUpdate.sha256;
    observedVersions=update.observedVersions || {};
    payload={...payload,snapshot:update.snapshot,createdAt:update.createdAt,
      devices:{...payload.devices,[deviceId]:update.policy},summary:{...payload.summary,authorityRevision:update.summary}};
  }
  const covered=new Set(payload.coveredBatches || []);
  const allTables=[...IDENTITY_PARENT_TABLES,...IDENTITY_REPLACED_TABLES];
  let applied=false;
  let validatedAuthority=null;
  if(!log) {
    const policy=payload.devices?.[deviceId];
    const empty=['db_estudiantes','evaluacion_registros','evaluacion_conclusiones','asistencia_registros','evaluacion_evidencias']
      .filter(table=>has(db,table)).every(table=>identityTableRows(db,table).length===0);
    if(!policy && !empty) pending('Esta computadora no pertenece a la conciliacion verificada; sus datos se conservaron.',true);
    if(policy?.mode==='exact') {
      validatedAuthority=db.transaction(()=>{
        const actual=identityFingerprints(db,Object.keys(policy.fingerprints));
        if(identityDigest(actual)!==identityDigest(policy.fingerprints)) {
          const equivalent=policy.semanticFingerprints && identityDigest(identitySemanticFingerprints(db,Object.keys(policy.fingerprints)))===identityDigest(policy.semanticFingerprints);
          if(!equivalent) pending('Hay trabajo local posterior a la copia conciliada. Se conserva antes de continuar la migracion.',true);
        }
        return actual;
      })();
    } else if(policy?.mode==='published-baseline') {
      if(!saved?.initialized || !saved.baseline) pending('Falta el punto de sincronizacion anterior para comprobar el trabajo de esta PC.',true);
      const uncovered=(saved.appliedBatches || []).filter(id=>!covered.has(id));
      if(uncovered.length) pending(`Esta PC conserva ${uncovered.length} paquetes posteriores a la conciliacion. Se esperara su incorporacion sin descartarlos.`,true);
      const unsent=[];
      for(const table of allTables.filter(table=>has(db,table))) {
        const expected=new Set(Object.values(saved.baseline[table] || {}));
        for(const row of identityTableRows(db,table)) if(!expected.has(legacyIdentityRowHash(table,row))) unsent.push({table,id:row.id});
      }
      if(unsent.length) {
        await atomicIdentityJson(path.join(runtimeFolder,'identity-local-changes-preserved.json'),{migrationId:marker.id,rows:unsent});
        pending(`Hay ${unsent.length} registros locales sin comprobar en el ultimo envio. No se reemplazaron sus datos.`,true);
      }
    }
    const before=validatedAuthority || identityFingerprints(db,allTables);
    const backupFolder=path.join(runtimeFolder,'identity-upgrade-backups',marker.id);
    await fs.promises.mkdir(backupFolder,{recursive:true});
    const backup=path.join(backupFolder,'before.db');
    if(!fs.existsSync(backup) && db.name && db.name!==':memory:') {
      const temporary=backup+'.tmp'; await db.backup(temporary);await fs.promises.rename(temporary,backup);
      if(saved) await atomicIdentityJson(path.join(backupFolder,'before-state.json'),saved);
      for(const name of ['state/frontend-local-storage.json','state/frontend-local-storage.json.observed.json']) {
        const source=path.join(runtimeFolder,name);
        if(fs.existsSync(source)) {const destination=path.join(backupFolder,name);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);}
      }
    }
    if(identityDigest(before)!==identityDigest(identityFingerprints(db,allTables))) pending('Los datos cambiaron durante el respaldo; se reintentara sin reemplazarlos.');
    const foreignKeys=db.pragma('foreign_keys',{simple:true}); db.pragma('foreign_keys=OFF');
    try {
      db.transaction(()=>{
        db.exec(`CREATE TABLE IF NOT EXISTS armi_sync_migration_archive (
          migration_id TEXT NOT NULL,table_name TEXT NOT NULL,row_key TEXT NOT NULL,row_json TEXT NOT NULL,
          PRIMARY KEY(migration_id,table_name,row_key));
          CREATE TABLE IF NOT EXISTS armi_sync_migration_log (
          migration_id TEXT PRIMARY KEY,payload_sha256 TEXT NOT NULL,applied_at TEXT NOT NULL,report_json TEXT NOT NULL)`);
        const archive=db.prepare('INSERT OR IGNORE INTO armi_sync_migration_archive VALUES(?,?,?,?)');
        const counts={};
        for(const table of allTables.filter(table=>has(db,table))) {
          const rows=identityTableRows(db,table);counts[table]=rows.length;
          rows.forEach((row,index)=>archive.run(marker.id,table,String(index),JSON.stringify(row)));
        }
        importSnapshot(payload,policy);
        db.prepare('INSERT INTO armi_sync_migration_log VALUES(?,?,?,?)').run(marker.id,marker.payloadSha256,new Date().toISOString(),JSON.stringify({archivedRows:counts,authorityUpdateSha256,summary:payload.summary}));
      })();
      applied=true;
    } finally {db.pragma(`foreign_keys=${foreignKeys?'ON':'OFF'}`);}
  }
  // A crash after the SQLite commit but before this JSON write resumes here.
  // The log prevents a second import from overwriting subsequent teacher work.
  const lastCoveredSequence=Math.max(0,...[...covered].filter(id=>String(id).split('-')[2]===deviceId).map(id=>Number(String(id).split('-')[1]) || 0));
  const next={format:2,identityRevision:4,identityMigrationId:marker.id,initialized:true,deviceId,
    sequence:Math.max(Number(saved?.sequence || 0),lastCoveredSequence),baseline:{},versions:observedVersions,
    appliedBatches:[...new Set([...(saved?.appliedBatches || []),...covered])],conflicts:[],legacyBootstrapPending:false};
  await atomicIdentityJson(path.join(runtimeFolder,'incremental-identity-state.json'),next);
  await fs.promises.rm(path.join(runtimeFolder,'incremental-identity-fast-state.json'),{force:true});
  return {applied,saved:next,migrationId:marker.id};
}
