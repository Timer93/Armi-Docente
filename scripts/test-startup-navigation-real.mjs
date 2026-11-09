import {spawnSync} from 'node:child_process';import {createRequire} from 'node:module';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'armi-nav-real-'));
const env={...process.env,ARMI_NAV_TEST_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
try{
 const child=spawnSync(createRequire(import.meta.url)('electron'),['scripts/test-startup-navigation-electron.cjs'],{cwd:path.resolve(import.meta.dirname,'..'),windowsHide:true,encoding:'utf8',timeout:60000,env});
 process.stdout.write(child.stdout||'');process.stderr.write(child.stderr||'');
 if(child.error)throw child.error;
 process.exitCode=child.status??1;
}finally{if(path.dirname(path.resolve(root))===path.resolve(os.tmpdir()))fs.rmSync(root,{recursive:true,force:true});}
