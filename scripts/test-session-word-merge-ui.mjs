import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const root = path.resolve('artifacts/session-word-merge-ui'); fs.mkdirSync(root, { recursive: true });
const rows = Object.fromEntries([1, 2, 3].flatMap(unit => [1, 2, 3].map(session => {
  const id = `u${unit}s${session}`;
  return [id, { id, areaId: 'ept', areaName: 'Educación para el Trabajo', grade: '5to', section: 'A y B', unitNumber: String(unit), sessionNumber: String(session), title: `Sesión ${session} de la unidad ${unit}: desarrollamos un emprendimiento sostenible` }];
})));
const fields = ['docente', 'institucion', 'competencia_priorizada', 'capacidad_priorizada', 'evaluacion_estrategias', 'instrumento_evaluacion', '%anexo_1_imagen', 'otro_marcador_personalizado_con_un_nombre_extremadamente_largo_para_probar_que_no_desborde_la_tarjeta'];
fs.writeFileSync(path.join(root, 'entry.ts'), `import React from 'react';import ReactDOM from 'react-dom/client';
import {SessionTemplateMergeView} from '/components/SessionTemplateMergeView.tsx';import '/index.css';
Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.copiedMarker=value}}});
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(SessionTemplateMergeView,{onBack:()=>{},selectedAreaId:'ept',selectedGrade:'5to',selectedSection:'A'}));`);
let vite;
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/datos-generales') return res.end(JSON.stringify({ success: true, data: { id: 1, path_word_default: 'C:\\Documentos\\Exportaciones\\Sesiones' } }));
    if (req.url === '/api/sesion-word/template-fields') return res.end(JSON.stringify({ success: true, fields, sessionMarkers: [...fields, 'proposito_sesion', '#ejes_tematicos_regionales'] }));
    if (req.url === '/api/sesiones') return res.end(JSON.stringify({ success: true, data: rows }));
    res.statusCode = 404; return res.end('{}');
  }
  if (req.url === '/merge-test') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(await vite.transformIndexHtml('/merge-test', `<html><head><style>body{margin:0;background:#eaebef}.layout{display:grid;grid-template-columns:240px minmax(0,1fr)}aside{background:#111827;color:white;padding:25px}main{min-width:0;padding:24px}@media(max-width:1023px){.layout{grid-template-columns:minmax(0,1fr)}aside{display:none}}</style></head><body><div class="layout"><aside>ARMI Docente</aside><main id="root"></main></div><script type="module" src="/artifacts/session-word-merge-ui/entry.ts"></script></body></html>`));
  }
  vite.middlewares(req, res, () => { res.statusCode = 404; res.end(); });
});
vite = await createServer({ configFile: false, cacheDir: path.join(root, 'vite-cache'), plugins: [react()], appType: 'custom', server: { middlewareMode: true, hmr: { server }, watch: { ignored: ['**/artifacts/**'] } }, optimizeDeps: { entries: [path.join(root, 'entry.ts')], include: ['react', 'react-dom/client'] }, define: { __APP_VERSION__: JSON.stringify('test') } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, ARMI_MERGE_UI_URL: `http://127.0.0.1:${server.address().port}/merge-test`, ARMI_MERGE_UI_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
try {
  const status = await new Promise((resolve, reject) => {
    const child = spawn(createRequire(import.meta.url)('electron'), ['scripts/test-session-word-merge-ui-electron.cjs'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr); child.once('error', reject); child.once('exit', resolve);
  });
  process.exitCode = Number(status) || 0;
} finally { await vite.close(); await new Promise(resolve => server.close(resolve)); }
