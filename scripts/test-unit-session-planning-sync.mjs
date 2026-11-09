import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { prepareInstallerDatabase } from './prepare-installer-database.mjs';
import { buildUnitSessionPlanning, mergeUnitSessionPlanning, resolveSelectedUnitSessionItems, UNIT_TRANSVERSAL_NAMES } from '../backend/shared/unitSessionPlanning.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-unit-lesson-'));
const port = 40500 + process.pid % 400, base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let db, child, logs = '';
const meta = { year: '2026', areaId: 'EPT', grade: '2do', section: 'A y B', unitNumber: '6' };
const query = (section = meta.section, number = '6') => new URLSearchParams({ ...meta, section, sessionNumber: number });
const call = async (route, data) => { const response = await fetch(`${base}/api/${route}`, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : undefined); const payload = await response.json(); assert.equal(response.status, 200, payload.message); assert.equal(payload.success, true, payload.message); return payload.data; };
const lessonId = (section, number = '6') => `${meta.year}-${meta.areaId}-${meta.grade}-${section}-U6-S${number}`;
const criterionId = 'area-emprendimiento-3', transCriterionId = 'trans-tic-0';
const originalUnit = {
    ...meta, title: 'Unidad de emprendimiento', purpose: '', product: '', situation: '',
    criterios: { 3: 'Diseña y aplica indicadores para el seguimiento y mejora de los procesos del proyecto.' },
    evidencias: { 3: '• Cuadro de indicadores de proceso (tiempo, calidad, costos).\n• Reporte de acciones correctivas.' }, instrumentos: { 3: 'Rúbrica' },
    criteriosTrans: { 0: 'Crea contenidos multimedia y soluciones lógicas mediante programación para resolver problemas.' },
    evidenciasTrans: { 0: '• Proyecto multimedia (video) como avance de elaboración de video time-lapse.\n• Programa o código fuente con secuencias lógicas.' }, instrumentosTrans: { 0: 'Rúbrica' },
    sesiones: [{
        id: 6, title: 'Evaluar procesos', competencia: 'Gestiona proyectos de emprendimiento', capacidades: ['Evalúa los resultados del proyecto de emprendimiento', 'Crea objetos virtuales en diversos formatos'], transversales: [UNIT_TRANSVERSAL_NAMES[0]],
        con: 'Indicadores y contenidos multimedia', eval: 'Rúbrica', criteriaSelectionTouched: true, selectedCriteriaIds: [criterionId, transCriterionId],
        criteriaItems: [{ text: 'Criterio viejo', color: 'text-black', sourceCriteriaId: criterionId, capacidad: 'Evalúa los resultados del proyecto de emprendimiento' }, { text: 'Criterio transversal viejo', color: 'text-[#007c59]', sourceCriteriaId: transCriterionId, capacidad: 'Crea objetos virtuales en diversos formatos' }],
        evidenceDistributionMode: 'manual', selectedEvidenceIds: ['area-3-0', 'trans-0-0'],
        evidenceItems: [{ text: 'Cuadro desactualizado', color: 'text-black', sourceEvidenceId: 'area-3-0', sourceCriteriaId: criterionId }, { text: 'Video desactualizado', color: 'text-[#007c59]', sourceEvidenceId: 'trans-0-0', sourceCriteriaId: transCriterionId }],
    }], recursos: {}, bibliografia: {}, evaluacion: '',
};
const savedLesson = {
    title: 'Título viejo', purpose: 'Propósito redactado por el docente', situation: 'Situación propia de la sesión', situationSource: 'manual',
    competenciaPrio: { comp: 'Gestiona proyectos de emprendimiento', cap: 'Evalúa los resultados del proyecto de emprendimiento', des: '<p>Criterio anterior</p>', evidence: '<p>Cuadro anterior</p><p>Reporte anterior que ya no se seleccionó</p>', field: 'Campo anterior', inst: 'Rúbrica' },
    competenciasTrans: [{ comp: UNIT_TRANSVERSAL_NAMES[0], cap: 'Crea objetos virtuales en diversos formatos', des: '<p>Criterio transversal anterior</p>', evidence: '<p>Video anterior</p><p>Código anterior que ya no se seleccionó</p>', inst: 'Lista de Cotejo' }],
    secuencia: { proceso: { aplicacion: 'Actividad personalizada que debe conservarse' } },
    learningResources: { annex2: { imageUrl: '/uploads/prueba.png', kind: 'project', pinned: true } },
    interactiveActivities: [{ id: 'practica-1', html: '<html>Práctica guardada</html>' }],
    instrumento: [{ id: 1, criterio: 'Criterio anterior', c: 'Descriptor C propio', b: 'Descriptor B propio', a: 'Descriptor A propio', ad: 'Descriptor AD propio' }],
    assessmentModel: { competencia: 'Gestiona proyectos de emprendimiento', capacidades: ['Evalúa los resultados del proyecto de emprendimiento'], criterios: [{ id: '1', text: 'Criterio anterior' }] },
    sessionAssessmentModel: { rows: [{ id: 'primary-1', source: 'primary', competencyName: 'Gestiona proyectos de emprendimiento', criterionText: 'Criterio anterior', evidenceText: 'Anterior', levelDescriptors: { c: 'Nivel C propio' } }, { id: 'transversal-1-1', source: 'transversal', competencyName: UNIT_TRANSVERSAL_NAMES[0], criterionText: 'Transversal anterior', evidenceText: 'Anterior' }] },
};
const assertProtected = (data) => {
    for (const field of ['purpose', 'situation', 'secuencia', 'learningResources', 'interactiveActivities', 'instrumento']) assert.deepEqual(data[field], savedLesson[field], `Protect lesson-owned ${field}`);
    assert.deepEqual(data.sessionAssessmentModel.rows[0].levelDescriptors, savedLesson.sessionAssessmentModel.rows[0].levelDescriptors);
};
try {
    const planning = buildUnitSessionPlanning(originalUnit, 6);
    assert.match(planning.competenciaPrio.evidence, /Cuadro de indicadores/); assert.doesNotMatch(planning.competenciaPrio.evidence, /Reporte/);
    assert.match(planning.competenciasTrans[0].evidence, /time-lapse/); assert.doesNotMatch(planning.competenciasTrans[0].evidence, /código/);
    assert.equal(resolveSelectedUnitSessionItems(originalUnit, originalUnit.sesiones[0], 'evidence').length, 2);
    const empty = structuredClone(originalUnit); empty.sesiones[0].selectedEvidenceIds = []; empty.sesiones[0].evidenceItems = [];
    const emptyPlan = buildUnitSessionPlanning(empty, 6); assert.equal(emptyPlan.competenciaPrio.evidence, '<p></p>'); assert.equal(emptyPlan.competenciasTrans[0].evidence, '<p></p>');
    assert.equal(buildUnitSessionPlanning(originalUnit, 7), null, 'Never use a different slot when a numbered session is absent');
    const reconciled = mergeUnitSessionPlanning(savedLesson, originalUnit, 6); assertProtected(reconciled);
    const customized = { ...reconciled, competenciaPrio: { ...reconciled.competenciaPrio, des: '<p>Criterio ajustado en Sesiones</p>' } };
    assert.equal(mergeUnitSessionPlanning(customized, originalUnit, 6).competenciaPrio.des, customized.competenciaPrio.des, 'An unchanged unit preserves a later lesson edit');

    const dbPath = path.join(root, 'database/armi.db'); await prepareInstallerDatabase(path.resolve('database/armi.db'), dbPath); db = new Database(dbPath);
    db.prepare('INSERT INTO datos_generales(id,year) VALUES(1,?)').run('2026');
    child = spawn(process.execPath, ['backend/server.js'], { windowsHide: true, env: { ...process.env, ARMI_DATA_ROOT: root, ARMI_BACKEND_PORT: String(port), ARMI_STUDENT_PORTAL_PORT: String(port + 1), ARMI_USE_VITE_MIDDLEWARE: '0', ARMI_DISABLE_DRIVE_LAUNCH: '1', NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => { logs += chunk; }); child.stderr.on('data', (chunk) => { logs += chunk; });
    const deadline = Date.now() + 45000; while (true) { assert.equal(child.exitCode, null, logs); try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} if (Date.now() > deadline) throw new Error(logs); await wait(150); }
    await call('unidades-didacticas', originalUnit);
    const insertLesson = db.prepare('INSERT INTO sesiones(id_sesion,year,area_id,grade,section,unit_number,session_number,session_data) VALUES(?,?,?,?,?,?,?,?)');
    for (const section of ['A y B', 'A', 'B', 'C']) insertLesson.run(lessonId(section), '2026', 'EPT', '2do', section, '6', '6', JSON.stringify(savedLesson));
    insertLesson.run(lessonId('A y B', '7'), '2026', 'EPT', '2do', 'A y B', '6', '7', JSON.stringify(savedLesson));
    const grade = db.prepare("INSERT INTO evaluacion_registros(student_id,session_id,criteria_id,level) VALUES('100',?,'primary-1','A')").run(lessonId('A y B'));
    const loaded = await call(`sesiones?${query()}`); assertProtected(loaded);
    assert.equal(loaded.competenciaPrio.evidence, planning.competenciaPrio.evidence); assert.equal(loaded.competenciasTrans[0].evidence, planning.competenciasTrans[0].evidence);
    const persisted = JSON.parse(db.prepare('SELECT session_data FROM sesiones WHERE id_sesion=?').get(lessonId('A y B')).session_data); assert.equal(persisted.competenciasTrans[0].evidence, planning.competenciasTrans[0].evidence);
    const editedUnit = structuredClone(originalUnit); editedUnit.sesiones[0].title = 'Título actualizado en la unidad'; editedUnit.evidencias[3] = '• Cuadro actualizado y justificado.\n• Reporte NO seleccionado.'; editedUnit.evidenciasTrans[0] = '• Video actualizado con avance time-lapse.\n• Código NO seleccionado.';
    const updated = await call('unidades-didacticas', editedUnit); assert.equal(updated.updatedLessons, 3, 'Update combined and covered A/B lessons, leaving C and session 7 alone');
    for (const section of ['A y B', 'A', 'B']) {
        const data = JSON.parse(db.prepare('SELECT session_data FROM sesiones WHERE id_sesion=?').get(lessonId(section)).session_data);
        assert.equal(data.title, editedUnit.sesiones[0].title); assert.match(data.competenciaPrio.evidence, /Cuadro actualizado/); assert.doesNotMatch(data.competenciaPrio.evidence, /Reporte/); assert.match(data.competenciasTrans[0].evidence, /Video actualizado/); assert.doesNotMatch(data.competenciasTrans[0].evidence, /Código/); assertProtected(data);
        assert.equal(data.sessionAssessmentModel.rows[0].evidenceText, data.competenciaPrio.evidence);
    }
    assert.deepEqual(JSON.parse(db.prepare('SELECT session_data FROM sesiones WHERE id_sesion=?').get(lessonId('C')).session_data), savedLesson);
    assert.deepEqual(JSON.parse(db.prepare('SELECT session_data FROM sesiones WHERE id_sesion=?').get(lessonId('A y B', '7')).session_data), savedLesson);
    assert.equal(db.prepare('SELECT level FROM evaluacion_registros WHERE id=?').get(grade.lastInsertRowid).level, 'A');
    // A stale open editor must not put the previous unit wording back.
    await call('sesiones', { ...meta, sessionNumber: '6', sessionData: loaded });
    const reopened = await call(`sesiones?${query()}`); assert.match(reopened.competenciaPrio.evidence, /Cuadro actualizado/);
    const manual = { ...reopened, competenciaPrio: { ...reopened.competenciaPrio, evidence: '<p>Detalle añadido directamente en Sesiones</p>' } };
    await call('sesiones', { ...meta, sessionNumber: '6', sessionData: manual });
    assert.equal((await call(`sesiones?${query()}`)).competenciaPrio.evidence, manual.competenciaPrio.evidence);
    const titleOnly = structuredClone(editedUnit); titleOnly.sesiones[0].title = 'Otro título'; await call('unidades-didacticas', titleOnly);
    assert.equal((await call(`sesiones?${query()}`)).competenciaPrio.evidence, manual.competenciaPrio.evidence, 'A title-only unit edit preserves unrelated evidence edits in the lesson');
    titleOnly.evidencias[3] = ''; titleOnly.evidenciasTrans[0] = ''; await call('unidades-didacticas', titleOnly);
    const cleared = await call(`sesiones?${query()}`); assert.equal(cleared.competenciaPrio.evidence, '<p></p>'); assert.equal(cleared.competenciasTrans[0].evidence, '<p></p>'); assertProtected(cleared);
    console.log('OK: unidad y sesiones coinciden, selección parcial y vacía, actualización persistida, secciones A/B, protección de lecciones/notas, ediciones directas y guardado desde una pestaña antigua.');
} finally {
    db?.close();
    if (child && child.exitCode === null) { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await Promise.race([exited, wait(5000)]); if (child.exitCode === null) { child.kill('SIGKILL'); await exited; } }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
