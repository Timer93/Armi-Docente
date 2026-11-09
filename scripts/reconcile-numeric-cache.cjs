const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const [dataRoot, applicationRoot, resultPath] = process.argv.slice(2);
const key = 'armi_hybrid_numeric_scores_v1';
const protectedTables = ['db_estudiantes','evaluacion_registros','evaluacion_conclusiones','evaluacion_evidencias','asistencia_registros','sesiones'];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const save = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(value,null,2)); };
(async () => {
  const Database = require(path.join(path.resolve(applicationRoot), 'node_modules/better-sqlite3'));
  const db = new Database(path.join(dataRoot, 'database/armi.db'));
  try {
    assert.equal(db.pragma('quick_check', {simple:true}), 'ok');
    const backupRoot = path.join(dataRoot,'repair-backups',`cache-reconciliation-${Date.now()}`);
    fs.mkdirSync(backupRoot, {recursive:true});
    await db.backup(path.join(backupRoot,'before.db'));
    for (const relative of ['sync-runtime/incremental-identity-state.json','sync-runtime/sync-identity-pending.json','sync-runtime/state/frontend-local-storage.json','sync-runtime/state/frontend-local-storage.json.observed.json']) {
      const source = path.join(dataRoot,relative);
      if(fs.existsSync(source)) { const dest=path.join(backupRoot,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest); }
    }
    const fingerprint = () => Object.fromEntries(protectedTables.map(table => [table, sha(JSON.stringify(db.prepare(`SELECT * FROM "${table}"`).all().map(row=>JSON.stringify(row)).sort()))]));
    let report;
    db.transaction(() => {
      const before = fingerprint();
      const old = db.prepare('SELECT * FROM armi_frontend_state WHERE key=?').get(key);
      assert.ok(old, 'No existe la cache que se iba a conciliar.');
      const cache = JSON.parse(old.value);
      assert.ok(cache && typeof cache === 'object' && !Array.isArray(cache));
      const students = new Set(db.prepare('SELECT id FROM db_estudiantes').all().map(row=>String(row.id)));
      const canonical = {};
      for(const row of db.prepare("SELECT * FROM evaluacion_registros WHERE grading_mode='hybrid_vigesimal' ORDER BY updated_at,id").all()) {
        if(row.numeric_score == null) continue;
        assert.ok(students.has(String(row.student_id)), 'Un registro oficial no tiene estudiante verificable; se requiere revision.');
        canonical[`${row.session_id}::${row.student_id}::${row.criteria_id}`] = Number(row.numeric_score);
      }
      assert.ok(Object.keys(canonical).length, 'No hay notas oficiales para reconstruir la cache.');
      const archivedAlternatives = Object.fromEntries(Object.entries(cache).filter(([k,v])=>!Object.hasOwn(canonical,k)||canonical[k]!==v));
      save(path.join(backupRoot,'original-cache.json'),old);
      save(path.join(backupRoot,'archived-alternatives.json'),archivedAlternatives);
      db.prepare('UPDATE armi_frontend_state SET value=?,updated_at=? WHERE key=?').run(JSON.stringify(canonical),new Date().toISOString(),key);
      const after = fingerprint();
      assert.deepEqual(after,before,'La conciliacion no puede modificar datos academicos.');
      report={success:true,backupRoot,previousEntries:Object.keys(cache).length,officialEntries:Object.keys(canonical).length,archivedAlternatives:Object.keys(archivedAlternatives).length,academicUnchanged:true,academicHashes:after};
    }).immediate();
    save(path.join(backupRoot,'receipt.json'),report);
    save(resultPath,report);
  } finally { db.close(); }
})().catch(error=>{save(resultPath,{success:false,error:error.message,stack:error.stack});process.exitCode=1;});
