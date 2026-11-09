import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { filterEvidenceByCompetency } from '../backend/evidenceCompetencyScope.js';
const root = path.resolve('artifacts/session-evidence-ui'); fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'entry.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';
import {SessionRegisterPanel} from '/components/sessions-view/SessionRegisterPanel.tsx';import {GradingSectionTabs} from '/components/sessions-view/GradingSectionTabs.tsx';import '/index.css';
const names=['BOBADILLA OLOYA, Viqueli Delmira','Estudiante sin archivos','Estudiante con evidencia revisada'];
const students=names.map((name,index)=>({id:String(155+index),name,estado:'A',section:'B',group:'Equipo 1'}));
const rows=[{id:'primary-1',source:'primary',competencyName:'Gestiona proyectos de emprendimiento económico y social',capacityName:'Crea propuestas de valor',criterionText:'Recoge información sobre necesidades de usuarios mediante entrevistas y organiza los datos identificando patrones.'},{id:'transversal-1',source:'transversal',competencyName:'Se desenvuelve en los entornos virtuales generados por las TIC',capacityName:'Personaliza entornos virtuales',criterionText:'Optimiza el desarrollo del proyecto configurando entornos virtuales con responsabilidad y eficiencia.'}];
const groups=rows.map(row=>({name:row.competencyName,source:row.source,capacities:[{name:row.capacityName,criteria:[row]}]}));
const props={currentSessionId:'test-session',performanceText:rows[0].criterionText,bimesterLabel:'IV',filteredStudents:students,generalData:{year:'2026',teacher:'Docente'},gradingCanonicalLevels:['c','b','a','ad'].map(id=>({id,label:id.toUpperCase(),short:id.toUpperCase(),color:{c:'bg-rose-600',b:'bg-orange-500',a:'bg-emerald-500',ad:'bg-sky-500'}[id]})),gradingCriteriaRows:rows,gradingLoading:false,gradingRecords:{},gradingSectionTabs:<GradingSectionTabs sections={['A','B']} activeSection="B" students={students} onChange={()=>{}}/>,activeGradingSection:'B',gradingSessionGroups:{groups,criterionBlocks:rows.map((row,index)=>({name:row.competencyName,source:row.source,capacityName:row.capacityName,criterion:row,code:'C'+(index+1)}))},gradingCodeToStoredLevel:value=>value,normalizeGradingLevelToCode:value=>String(value||'').toLowerCase(),sessionData:{title:'Entrevistamos y organizamos datos',competenciaPrio:{comp:rows[0].competencyName,des:rows[0].criterionText,evidence:"Producto del area"},competenciasTrans:[{comp:rows[1].competencyName,evidence:"Producto transversal TIC"}],sessionAssessmentModel:{rows}},selArea:'Educación para el Trabajo',selGrade:'5to',selSection:'A y B',sessionDate:'2026-11-01',sessionNumber:'1',unitNumber:'7',expandedSessionRegisterObservations:{},setExpandedSessionRegisterObservations(){},updateGradingRecord(){},getGradingKey:(id,criterion)=>id+'::'+criterion};
createRoot(document.getElementById('root')).render(<SessionRegisterPanel {...props}/>);`);
let mode = 'pending', lastEvidenceQuery = null, vite;
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/fixture/')) {
    mode = req.url.split('/').at(-1); res.end('ok'); return;
  }
  if (req.url.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('/revision-pendientes/')) {
      if (mode === 'error') { res.statusCode = 500; return res.end(JSON.stringify({ success: false })); }
      return res.end(JSON.stringify({ success: true, data: [{ studentId: '155', evidenceCount: 2, pending: mode === 'pending', pendingCount: mode === 'pending' ? 2 : 0 }, { studentId: '157', evidenceCount: 1, pending: false }] }));
    }
    if (req.url.startsWith('/api/evaluacion/evidencias?')) {
      lastEvidenceQuery = req.url;
      const criteria = new URL(req.url, 'http://localhost').searchParams.get('criteriaId');
      const files = [
        { id: 1, fileName: 'area-evidence.txt', criteria_id: 'summary::primary::gestiona proyectos de emprendimiento economico y social' },
        { id: 2, fileName: 'transversal-evidence.txt', criteria_id: 'summary::transversal::se desenvuelve en los entornos virtuales generados por las tic' },
      ];
      const data = filterEvidenceByCompetency(files, criteria).map(row => ({ ...row, fileType: 'text/plain', studentIds: ['155'], studentNames: ['Viqueli'], available: false }));
      if (mode === 'delay' && criteria?.startsWith('summary::primary::')) await new Promise(resolve => setTimeout(resolve, 700));
      return res.end(JSON.stringify({ success: true, data }));
    }
    return res.end(JSON.stringify({ success: true, data: {} }));
  }
  if (req.url === '/last-query') return res.end(lastEvidenceQuery || '');
  if (req.url === '/register-test') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(await vite.transformIndexHtml(req.url, '<html><head><style>body{margin:0;background:#eaebef;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}.layout{display:grid;grid-template-columns:240px minmax(0,1fr)}aside{padding:24px;background:#111827;color:white}main{min-width:0;padding:24px}.panel{padding:16px;background:white;border-radius:20px}@media(max-width:1023px){.layout{grid-template-columns:1fr}aside{display:none}}</style></head><body><div class="layout"><aside>ARMI Docente</aside><main><div class="panel" id="root"></div></main></div><script type="module" src="/artifacts/session-evidence-ui/entry.tsx"></script></body></html>'));
  }
  vite.middlewares(req, res, () => { res.statusCode = 404; res.end(); });
});
vite = await createServer({ configFile: false, cacheDir: path.resolve('node_modules/.vite-session-evidence-ui'), plugins: [react()], appType: 'custom',
  server: { middlewareMode: true, hmr: { server }, watch: { ignored: ['**/artifacts/**','**/backend/**','**/scripts/**'] } },
  optimizeDeps: { entries: [path.join(root, 'entry.tsx')], include: ['react', 'react-dom/client','recharts','lucide-react'] }, define: { __APP_VERSION__: JSON.stringify('test') } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, ARMI_EVIDENCE_UI_URL: `http://127.0.0.1:${server.address().port}/register-test`, ARMI_EVIDENCE_UI_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
try {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(createRequire(import.meta.url)('electron'), ['scripts/test-session-evidence-ui-electron.cjs'], { env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr); child.once('error', reject); child.once('exit', resolve);
  });
  process.exitCode = Number(result) || 0;
} finally { await vite.close(); await new Promise(resolve => server.close(resolve)); }
