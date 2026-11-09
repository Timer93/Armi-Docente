import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';
import {sessionPlainText,normalizeSessionPlainFields} from '../backend/shared/sessionPlainText.js';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
assert.equal(sessionPlainText('<p>Que los estudiantes <strong>comercialicen</strong> productos.</p>'),'Que los estudiantes comercialicen productos.');
assert.equal(sessionPlainText('&amp;lt;p&amp;gt;Situaci&oacute;n: costo &lt; 20.&amp;lt;/p&amp;gt;'),'Situación: costo < 20.');
assert.equal(sessionPlainText('<p>Primera idea.</p><p>Segunda<br>Continuación.</p>'),'Primera idea.\nSegunda\nContinuación.');
assert.equal(sessionPlainText('<ul><li>Investigar.</li><li>Comparar.</li></ul>'),'• Investigar.\n• Comparar.');
assert.equal(sessionPlainText('Escribir  \n  un paso '),'Escribir  \n  un paso ');
assert.equal(sessionPlainText('Costo < 20 y utilidad > 5; [PRODUCTO]'),'Costo < 20 y utilidad > 5; [PRODUCTO]');
const content={purpose:'<p>Propósito</p>',situation:'<p>Reto</p>',title:'Título',extension:'<p>Compartir</p>',competenciaPrio:{des:'<p><strong>Criterio</strong></p>'},secuencia:{inicio:{saberes:'<p>¿Qué sabemos?</p>'}}};
const cleaned=normalizeSessionPlainFields(content);
assert.equal(content.purpose,'<p>Propósito</p>','Do not mutate a stored source object');
assert.equal(cleaned.competenciaPrio,content.competenciaPrio,'Keep rich criteria untouched');
assert.equal(cleaned.secuencia,content.secuencia,'Keep rich activities untouched');
assert.deepEqual(normalizeSessionPlainFields(cleaned),cleaned);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'armi-session-plain-'));
try{
 const modules=[];
 for(const entry of ['shared.tsx','sessionAiResponse.ts','SessionCoreDetailsPanel.tsx']){const outfile=path.join(root,entry+'.mjs');await build({entryPoints:[path.resolve('components/sessions-view',entry)],outfile,bundle:true,platform:'node',format:'esm',logLevel:'silent'});modules.push(await import(pathToFileURL(outfile).href));}
 const [{cloneInitialSessionData,ensureSessionAssessmentModel},{applySessionAiResponse},{SessionCoreDetailsPanel}]=modules;
 const saved={...cloneInitialSessionData(),...content};
 const restored=ensureSessionAssessmentModel(saved);
 assert.equal(restored.purpose,'Propósito');assert.equal(restored.situation,'Reto');
 const view=renderToStaticMarkup(React.createElement(SessionCoreDetailsPanel,{themeColor:'#004c6c',sessionData:saved,handleInputChange:()=>{}}));
 assert.ok(view.includes('Propósito'));assert.ok(view.includes('Reto'));assert.ok(!view.includes('&lt;p&gt;'),'The actual textarea panel must also clean an already loaded session');
 const generated=applySessionAiResponse({aiData:{purpose:'<p>Aplicar <em>TIC</em>.</p>',situation:'&lt;p&gt;Resolver el reto.&lt;/p&gt;',extension:'<ul><li>Compartir.</li></ul>'},sessionData:cloneInitialSessionData(),targetInstrumentRows:[],areaId:'EPT',selGrade:'5to',selSection:'A y B',unitNumber:'7',sessionNumber:'6',bimesterLabel:'IV',currentProgram:{}});
 assert.equal(generated.purpose,'Aplicar TIC.');assert.equal(generated.situation,'Resolver el reto.');assert.equal(generated.extension,'• Compartir.');
 console.log('OK: saved sessions and actual AI response use plain text; entities, paragraphs, lists, ordinary editing and rich fields preserved.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
