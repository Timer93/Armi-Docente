import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveSectionSessionDates } from '../backend/shared/sectionSessionDates.js';

if (!process.argv.includes('--fixture')) {
  const { prepareInstallerDatabase } = await import('./prepare-installer-database.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-section-dates-'));
  let child;
  try {
    await prepareInstallerDatabase(path.resolve('database/armi.db'), path.join(root, 'database/armi.db'));
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--fixture'], { windowsHide: true,
      env: { ...process.env, ARMI_DATA_ROOT: root, TZ: 'America/Bogota', ARMI_DISABLE_DRIVE_LAUNCH: '1' }, stdio: ['ignore','pipe','pipe'] });
    let output = ''; child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
    const timeout = setTimeout(() => child.kill(), 30000);
    const code = await new Promise(resolve => child.on('close', resolve)); clearTimeout(timeout);
    assert.equal(code, 0, output);
    console.log(output.split('\n').filter(line => line.startsWith('OK:')).join('\n'));
  } finally {
    if (child?.exitCode === null) child.kill();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('armi-section-dates-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
} else {
  const express = (await import('express')).default;
  const { default: db, setPortalSessionToken } = await import('../backend/db.js');
  const { default: portal } = await import('../backend/routes/studentPortal.routes.js');
  const { default: evidence } = await import('../backend/routes/evidencias.routes.js');
  const { createSectionSessionSchedule } = await import('../backend/sectionSessionSchedule.js');
  const data = { title: 'Proyecto', date: '2026-11-04', selectedSessionDate: '', sessionDateOptions: [
    {value:'2026-11-04',label:'04/11/2026'}, {value:'2026-11-06',label:'06/11/2026'}] };
  db.prepare('UPDATE datos_generales SET year=? WHERE id=1').run('2026');
  const row = {id_sesion:'section-test',year:'2026',area_id:'EPT',grade:'5to',section:'A y B',unit_number:'7',session_number:'8'};
  db.prepare('INSERT INTO sesiones(id_sesion,year,area_id,grade,section,unit_number,session_number,session_data) VALUES(?,?,?,?,?,?,?,?)')
    .run(...Object.values(row), JSON.stringify(data));
  db.prepare('INSERT INTO unidades_didacticas(id_unidad,year,area_id,grade,section,unit_number,sesiones) VALUES(?,?,?,?,?,?,?)')
    .run('unit','2026','EPT','5to','A y B','7',JSON.stringify([{id:8,fechasPorSeccion:['5to A (06/11/2026)','5to B (04/11/2026)']}]));
  const resolver = createSectionSessionSchedule(db);
  assert.deepEqual(resolver.dates(row,data,'A'),['2026-11-06']);
  assert.deepEqual(resolver.dates(row,data,'B'),['2026-11-04']);
  assert.deepEqual(resolver.dates(row,{date:'2026-11-06'},'B'),['2026-11-04'],'A legacy general date must not replace the explicit unit date for B');
  assert.deepEqual(resolveSectionSessionDates(row,data,'B',{scheduleEntries:[{areaId:'EPT',grade:'5to',section:'B',day:'MIÉRCOLES'}]}),['2026-11-04']);
  assert.deepEqual(resolveSectionSessionDates({...row,grade:'3ro'},data,'B',{plannedSession:{fechasPorSeccion:['3ro B (04/11/2026)']}}),['2026-11-04']);
  assert.deepEqual(resolveSectionSessionDates({...row,section:'U'},data,'U'),['2026-11-04','2026-11-06'],'Single-section/multi-day planning keeps its dates');
  const app = express(); app.use(express.json()); app.use('/api',portal); app.use('/api',evidence);
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (route, options={}) => {const response=await fetch(base+route,options);const result=await response.json();assert.equal(response.status,200,result.message);assert.equal(result.success,true,result.message);return result.data;};
  let studentB;
  try {
    for (const section of ['A','B']) {
      const student = db.prepare("INSERT INTO db_estudiantes(dni,estudiantes,grado,secc,estado) VALUES(?,?,?,?, 'A')").run(section==='A'?'99999201':'99999202','Test '+section,'5to',section);
      setPortalSessionToken('token-'+section,{studentId:String(student.lastInsertRowid)});
      if(section==='B')studentB=String(student.lastInsertRowid);
      const result = await request('/student-portal/sessions',{headers:{Authorization:'Bearer token-'+section}});
      const expected = section==='A'?'2026-11-06':'2026-11-04';
      assert.equal(result[0].date,expected);
      const teacher = await request('/evaluacion/ventana-entrega/section-test?section='+section);
      assert.equal(teacher.openAt,result[0].deliveryWindow.openAt,'Teacher and student must show the same opening');
      assert.equal(teacher.onTimeCloseAt,result[0].deliveryWindow.onTimeCloseAt);
      assert.equal(teacher.openAt,expected+'T05:00:00.000Z');
    }
    await request('/evaluacion/ventana-entrega/section-test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({section:'B',enabled:false})});
    assert.equal((await request('/evaluacion/ventana-entrega/section-test?section=B')).enabled,false);
    assert.equal((await request('/evaluacion/ventana-entrega/section-test?section=A')).enabled,true,'Closing B must not close A');
    await request('/evaluacion/ventana-entrega/section-test?section=B',{method:'DELETE'});
    db.prepare('INSERT INTO evaluacion_ventanas_entrega(session_id,enabled,open_from,exceptional) VALUES(?,1,?,1)').run('section-test','2026-11-06T05:00:00.000Z');
    const legacy = await request('/evaluacion/ventana-entrega/section-test?section=B');
    assert.equal(legacy.openAt,'2026-11-04T05:00:00.000Z','An old exceptional A opening cannot postpone B');
    db.prepare('INSERT INTO evaluacion_evidencias(session_id,student_id,source,submitted_at,file_name,file_path) VALUES(?,?,?,?,?,?)')
      .run('section-test',studentB,'student_portal','2026-11-06 12:00:00','test.txt','test.txt');
    const evidences = await request('/evaluacion/evidencias?sessionId=section-test');
    assert.equal(evidences[0].deliveryTiming,'late','Evidence timing must use the same section date as the student portal');
    assert.equal(evidences[0].onTimeCloseAt,'2026-11-06T04:59:59.999Z');
    const {getLocalSyncStatus} = await import('../backend/sync.js');
    const dump = path.join(process.env.ARMI_DATA_ROOT,'sync-runtime/database-dump.json');
    const before = fs.existsSync(dump) ? fs.statSync(dump).mtimeMs : null;
    for(let i=0;i<3;i++){
      const status = await getLocalSyncStatus({lightweight:true});
      assert.equal(status.data.frontendState,undefined,'Frequent status reads must not serialize the complete portable state');
      assert.equal(status.data.localManifest.lightweight,true);
    }
    assert.equal(fs.existsSync(dump)?fs.statSync(dump).mtimeMs:null,before,'Polling must not export the database');
    console.log('OK: section-specific teacher/portal dates, other grades, legacy overrides, independent closing and lightweight status without database exports.');
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
  process.exit(0);
}
