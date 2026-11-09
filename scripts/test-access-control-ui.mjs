import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { createAccessControlRouter } from '../backend/routes/accessControl.routes.js';
import { createAccessExtensionService } from '../backend/accessExtension.js';
import { createAccessExtensionRouter } from '../backend/routes/accessExtension.routes.js';
import {createStudentAgentService} from '../backend/studentAgent.js';
import {createStudentAgentRouter} from '../backend/routes/studentAgent.routes.js';
const root = path.resolve('artifacts/access-control-ui'); fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'entry.tsx'), `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{Sidebar}from'/components/Sidebar.tsx';import{AccessControlView}from'/components/AccessControlView.tsx';import{DatabaseManager}from'/components/DatabaseManager.tsx';import{AuthProvider}from'/components/auth/AuthContext.tsx';import{INITIAL_MODULE_STATUS}from'/constants.ts';import'/index.css';
function Preview(){const[section,setSection]=useState('control_acceso');const[collapsed,setCollapsed]=useState(false);return <><Sidebar status={INITIAL_MODULE_STATUS} currentModule="database_admin" currentSection={section} onNavigate={(_,s)=>setSection(s||'bases_datos')} teacherName="Docente" isCollapsed={collapsed} toggleCollapse={()=>setCollapsed(!collapsed)}/><main style={{marginLeft:collapsed?80:288,minWidth:0}}>{section==='control_acceso'?<AccessControlView/>:<DatabaseManager/>}</main></>}createRoot(document.getElementById('root')).render(<AuthProvider><Preview/></AuthProvider>);`);
const db = new Database(':memory:'); db.exec('CREATE TABLE armi_frontend_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)');
const local = new Database(':memory:');
const extensionService = createAccessExtensionService({ db, localDatabase: local });
const agentDb=new Database(':memory:');
let agentClockOffset=0;
const agentService=createStudentAgentService({db,localDatabase:agentDb,runtimeFolder:root,now:()=>Date.now()+agentClockOffset});
const app = express(); app.use(express.json());
let accessReads=0;
app.use((req,_res,next)=>{if(req.method==='GET'&&req.path.startsWith('/api/admin/access-control'))accessReads++;next();});
app.get('/api/test/access-reads',(_req,res)=>res.json({count:accessReads}));
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
app.use('/api/admin/access-control', createAccessControlRouter({ db, teacherPort: server.address().port, extensionService, agentService }));
app.use('/api/access-extension', createAccessExtensionRouter(extensionService));
app.use('/api/student-agent', createStudentAgentRouter(agentService));
app.post('/api/test/advance-agent-clock',(req,res)=>{agentClockOffset+=Number(req.body.advance)||0;res.json({success:true});});
app.use('/api', (req, res) => res.json({ success: true, data: req.path.startsWith('/sync/') ? {
  config: { mode: 'local', remoteUser: null, autoSyncOnClose: false, syncUserKey: 'test', syncUserLabel: 'Docente' },
  localManifest: { files: [], summary: { entities: {} } }, comparison: 'in-sync', hasUnsyncedChanges: false,
} : [] }));
const vite = await createServer({ configFile: false, plugins: [react()], appType: 'custom', cacheDir: path.join(root, 'vite-cache'),
  server: { middlewareMode: true, hmr: { server }, watch: { ignored: ['**/artifacts/**'] } },
  optimizeDeps: { entries: [path.join(root, 'entry.tsx')], include: ['react', 'react-dom/client'] }, define: { __APP_VERSION__: JSON.stringify('11.4.15') } });
app.get('/access-preview', async (_req, res) => res.type('html').send(await vite.transformIndexHtml('/access-preview', '<html><head><meta charset="utf-8"/><style>body{margin:0;background:#f3f5f7}</style></head><body><div id="root"></div><script type="module" src="/artifacts/access-control-ui/entry.tsx"></script></body></html>')));
app.use(vite.middlewares);
const env = { ...process.env, ARMI_ACCESS_UI_ROOT: root, ARMI_ACCESS_UI_URL: `http://127.0.0.1:${server.address().port}/access-preview` }; delete env.ELECTRON_RUN_AS_NODE;
try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(createRequire(import.meta.url)('electron'), ['scripts/test-access-control-ui-electron.cjs'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr); child.once('error', reject); child.once('exit', resolve);
  });
  process.exitCode = Number(code) || 0;
} finally { await vite.close(); await new Promise(resolve => server.close(resolve)); agentDb.close(); local.close(); db.close(); }
