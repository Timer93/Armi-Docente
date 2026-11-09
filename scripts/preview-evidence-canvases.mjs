import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const folder=path.resolve(process.argv[2] || '');if(!process.argv[2])throw new Error('Indica la carpeta con evidencia-1.html, evidencia-2.html y evidencia-3.html.');
const output=path.resolve('artifacts/corrected-evidence-canvases');fs.mkdirSync(output,{recursive:true});
const env={...process.env,ARMI_CANVAS_FOLDER:folder,ARMI_CANVAS_PREVIEW:output};delete env.ELECTRON_RUN_AS_NODE;
process.exitCode=await new Promise((resolve,reject)=>{const p=spawn(createRequire(import.meta.url)('electron'),['scripts/preview-evidence-canvases-electron.cjs'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});p.stdout.pipe(process.stdout);p.stderr.pipe(process.stderr);p.once('error',reject);p.once('exit',resolve);});
