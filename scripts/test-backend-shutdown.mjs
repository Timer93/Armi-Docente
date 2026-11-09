import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-lifecycle-'));
fs.writeFileSync(path.join(root, 'fixture.mjs'), `
import fs from 'node:fs';import http from 'node:http';
const server=http.createServer((_req,res)=>res.end('ok'));
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.env.ARMI_TEST_READY,JSON.stringify({pid:process.pid,port:server.address().port})));
export const shutdownServer=()=>process.env.ARMI_TEST_HANG==='1'?new Promise(()=>{}):new Promise(resolve=>{
  server.close(()=>{fs.writeFileSync(process.env.ARMI_TEST_STOPPED,'closed');resolve();});server.closeAllConnections();
});
`);
try {
  const env = { ...process.env, ARMI_LIFECYCLE_TEST_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(createRequire(import.meta.url)('electron'), ['scripts/test-backend-shutdown-electron.cjs'], {
    env, windowsHide: true, encoding: 'utf8', timeout: 35000,
  });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { fs.rmSync(root, { recursive: true, force: true }); }
