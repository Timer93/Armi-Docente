import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { exportPortableIdentitySnapshot } from '../backend/incrementalMirrorSync.js';
import { createSyncReferenceIdentity } from '../backend/syncReferenceIdentity.js';
import { identityDigest,identityFingerprints,IDENTITY_PARENT_TABLES,IDENTITY_REPLACED_TABLES } from '../backend/identityMigration.js';
import { consolidatedThirdBimester } from './plan-mirror-reconciliation.mjs';

const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const normalize=value=>String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const validDni=value=>/^\d{8}$/.test(String(value || '')) && !/^(\d)\1{7}$/.test(String(value));
export function buildVerifiedLegacyAliases(db,rosters) {
  const identity=createSyncReferenceIdentity(db),catalog=identity.catalog();
  const current=db.prepare('SELECT * FROM db_estudiantes').all();
  const activeIds=new Set(current.map(row=>String(row.id))),possible=new Map();
  for(const roster of rosters) for(const source of roster.rows) {
    if(activeIds.has(String(source.id))) continue;
    let matches=validDni(source.dni) ? current.filter(row=>String(row.dni)===String(source.dni)) : [];
    if(!matches.length) matches=current.filter(row=>normalize(row.estudiantes)===normalize(source.estudiantes)
      && String(row.grado || '')===String(source.grado || '') && String(row.secc || '')===String(source.secc || '')
      && !(validDni(source.dni) && validDni(row.dni) && String(row.dni)!==String(source.dni)));
    if(matches.length!==1) continue;
    const target=matches[0],ref=catalog.students[String(target.id)];
    const entry={...ref,targetId:target.id,source:roster.source,rosterSha256:identityDigest(roster.rows),
      proof:validDni(source.dni)?'DNI unico':'Nombre completo, grado y seccion exactos y unicos en padron historico'};
    if(!possible.has(String(source.id))) possible.set(String(source.id),[]);
    possible.get(String(source.id)).push(entry);
  }
  return Object.fromEntries([...possible].flatMap(([id,entries])=>new Set(entries.map(row=>row.token)).size===1 ? [[id,entries[0]]] : []));
}

export async function prepareIdentityMigration({proposal,snapshot,legacyDump,output,id}) {
  if(fs.existsSync(output)) throw new Error('La carpeta de salida debe ser nueva.');fs.mkdirSync(output,{recursive:true});
  const source=path.join(output,'portable-source.db');fs.copyFileSync(path.join(proposal,'candidate.db'),source);
  const db=new Database(source),before=new Database(path.join(proposal,'before.db'),{readonly:true});
  try {
    const plan=read(path.join(proposal,'proposal.json'));
    const originalThird=consolidatedThirdBimester(db);
    const sourceDevice='584392cf9397665d',authority='a1f0adf49cb2d691';
    const sourceCatalog=read(path.join(snapshot,'catalogos-recuperacion',sourceDevice+'.json'));
    const rosters=[];
    for(const file of fs.readdirSync(path.join(snapshot,'catalogos-recuperacion'))) {
      const catalog=read(path.join(snapshot,'catalogos-recuperacion',file));
      rosters.push({source:catalog.deviceId,rows:(catalog.tables.db_estudiantes || []).map(record=>record.row)});
    }
    const historical=read(legacyDump).tables.db_estudiantes || [];
    rosters.push({source:'historical-complete-mirror',rows:historical});
    const aliases=buildVerifiedLegacyAliases(db,rosters);
    const resolutions=[];
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='student_deletion_tombstones'").get()) {
      const roster=db.prepare('SELECT * FROM db_estudiantes').all();
      for(const tombstone of db.prepare('SELECT * FROM student_deletion_tombstones').all()) {
        if(validDni(tombstone.dni) || String(tombstone.student_id).startsWith('@student:')) continue;
        const matches=roster.filter(row=>normalize(row.estudiantes)===normalize(tombstone.student_name) && String(row.id)!==String(tombstone.student_id));
        if(matches.length!==1) throw new Error('Hay un borrado historico sin identidad suficiente para cerrar la migracion.');
        db.prepare('DELETE FROM student_deletion_tombstones WHERE student_id=?').run(tombstone.student_id);
        resolutions.push({table:'student_deletion_tombstones',key:tombstone.student_id,
          decision:'Marca de un registro antiguo sin DNI reemplazado por una inscripcion activa diferente; se archiva sin eliminar al estudiante reinscrito.'});
      }
    }
    for(const item of plan.review) {
      if(item.table==='db_estudiantes' && item.differences?.every(key=>['password_hash','password_changed_at'].includes(key))) {
        const row=item.row,current=db.prepare('SELECT * FROM db_estudiantes WHERE id=?').get(row.id);
        const stamp=value=>Date.parse(String(value || '').replace(' ','T')+'Z') || 0;
        if(current && String(current.dni)===String(row.dni) && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(String(row.password_hash))
          && stamp(row.password_changed_at)>stamp(current.password_changed_at)) {
          db.prepare('UPDATE db_estudiantes SET password_hash=?,password_changed_at=?,updated_at=?,password_recovery_cipher=NULL WHERE id=?').run(row.password_hash,row.password_changed_at,row.updated_at,current.id);
          resolutions.push({table:item.table,key:item.key,decision:'Preservar la credencial mas reciente configurada en PC2, misma identidad por DNI; sin copiar cifrado local.'});continue;
        }
      }
      resolutions.push({table:item.table,key:item.key || item.sourceKey,decision:'Conservar version validada de PC1; guardar alternativa completa en respaldo de conciliacion.'});
    }
    const portable=await exportPortableIdentitySnapshot(db,{legacyAliases:aliases});
    if(identityDigest(originalThird)!==identityDigest(consolidatedThirdBimester(db))) throw new Error('La preparacion cambio el III bimestre.');
    const state=read(path.join(snapshot,'estado-local-antes.json'));
    const covered=new Set(state.appliedBatches);
    for(const file of read(path.join(snapshot,'eventos-resguardados.json')).files) covered.add(path.parse(file.name).name);
    const tableNames=[...IDENTITY_PARENT_TABLES,...IDENTITY_REPLACED_TABLES];
    const payload={format:1,id,createdAt:new Date().toISOString(),authorityDevice:authority,
      coveredBatches:[...covered].sort(),snapshot:portable,
      devices:{
        [authority]:{mode:'exact',fingerprints:identityFingerprints(before,tableNames),roster:before.prepare('SELECT id,dni,estudiantes,grado,secc FROM db_estudiantes').all()},
        [sourceDevice]:{mode:'published-baseline',roster:sourceCatalog.tables.db_estudiantes.map(record=>record.row).map(({id,dni,estudiantes,grado,secc})=>({id,dni,estudiantes,grado,secc}))}
      },proofs:{legacyAliases:aliases,resolutions},
      summary:{...plan.summary,verifiedLegacyAliases:Object.keys(aliases).length,portableRows:Object.fromEntries(Object.entries(portable.tables).map(([table,rows])=>[table,rows.length])),
        preservedUnresolved:portable.unresolved.length,pendingDecisions:0,backupRequired:true}};
    const payloadSha256=identityDigest(payload);
    fs.writeFileSync(path.join(output,'payload.json'),JSON.stringify(payload));
    fs.writeFileSync(path.join(output,'marker.json'),JSON.stringify({format:1,id,payloadSha256,payloadPath:`.armi-sync/identity-migrations/${id}/payload.json`,createdAt:payload.createdAt}));
    fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(payload.summary,null,2));
    fs.writeFileSync(path.join(output,'canonical-III.json'),JSON.stringify(originalThird));
    return {id,payloadSha256,aliases:Object.keys(aliases).length,unresolved:portable.unresolved,rows:payload.summary.portableRows};
  } finally {db.close();before.close();}
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=Object.fromEntries(process.argv.slice(2).reduce((result,value,index,array)=>index%2===0?[...result,[value.slice(2),array[index+1]]]:result,[]));
  if(!args.proposal || !args.snapshot || !args.legacyDump || !args.output || !args.id) throw new Error('Faltan --proposal, --snapshot, --legacyDump, --output y --id.');
  console.log(JSON.stringify(await prepareIdentityMigration(args),null,2));
}
