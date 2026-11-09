import assert from 'node:assert/strict';
import {templatePedagogyContext,templateEvidenceBrief} from '../backend/evidenceTemplatePedagogy.js';
import {evidenceTemplatePrompt,combinedEvidenceTemplatePrompt} from '../backend/evidenceTemplateContract.js';
const data={title:'Descubrimos necesidades reales',purpose:'Aplicar observación y entrevistas para una campaña navideña sostenible.',situation:'Emprendimientos navideños sostenibles y prevención frente al Fenómeno El Niño.',
 competenciaPrio:{comp:'GESTIONA PROYECTOS',cap:'Crea propuestas de valor',des:'<p>Aplica&nbsp;técnicas de observación y entrevistas estructuradas.</p>'},competenciasTrans:[{comp:'Se desenvuelve en los entornos virtuales',cap:'Personaliza entornos virtuales',des:'Organiza aplicaciones y materiales según su utilidad.'}],
 secuencia:{proceso:{construccion:'<p>Los equipos simulan la observación y consolidan una guía preliminar.</p>',aplicacion:'Elaboran el producto en laptop o PC dentro del aula.',tiempo:"15'"}}};
const context=templatePedagogyContext(data);
assert.equal(context.criteria[0].criterion,'Aplica técnicas de observación y entrevistas estructuradas.');
const evidences=[{id:'e1',source:'primary',competency:'Gestiona proyectos.',text:'Guía de entrevista estructurada aplicada a potenciales usuarios.'},{id:'e2',source:'primary',competency:'Gestiona proyectos',text:'Registro de observaciones de campo sobre las necesidades del público objetivo.'},{id:'e3',source:'transversal',competency:'Se desenvuelve en los entornos virtuales',text:'Capturas de pantalla o reporte de organización de archivos y aplicaciones.'}];
const interview=templateEvidenceBrief(evidences[0],context),observation=templateEvidenceBrief(evidences[1],context),organization=templateEvidenceBrief(evidences[2],context);
assert.match(interview.layout,/Pregunta \/ Respuesta registrada \/ Necesidad detectada/);assert.match(interview.essentials,/ensayo no acredita una entrevista real/);
assert.match(observation.layout,/Hecho observado \/ Necesidad o problema \/ Sustento observable/);assert.match(observation.essentials,/No agregues priorización/);
assert.match(organization.layout,/Ubicación real/);assert.match(organization.essentials,/capturas O reporte/);
assert.equal(organization.criteria.length,1);assert.equal(organization.criteria[0].criterion,'Organiza aplicaciones y materiales según su utilidad.');
const single=evidenceTemplatePrompt(evidences[0],{...context,grade:'2do',imageNames:['bot_atento.png']});
for(const text of ['Fenómeno El Niño','Los equipos simulan','15\'','Aplica técnicas','Observaciones pertenece al encabezado','No solicites nombres','bot_atento.png','8 a 14 campos'])assert.ok(single.includes(text),text);
assert.ok(!single.includes('Organiza aplicaciones y materiales según su utilidad.'),'another competency must not supply this evidence criterion');
const bulk=combinedEvidenceTemplatePrompt(evidences,context,{e2:{mode:'group'}});
assert.equal((bulk.match(/Los equipos simulan/g) || []).length,1,'share the lesson sequence once');
assert.equal((bulk.match(/^ARCHIVO \d:/gm) || []).length,3);assert.match(bulk,/Modalidad: grupal/);
const third=bulk.split('ARCHIVO 3:')[1];assert.match(third,/Organiza aplicaciones y materiales según su utilidad/);assert.ok(!third.includes('Aplica técnicas de observación y entrevistas estructuradas.'));
assert.ok(!templateEvidenceBrief({text:'Modelo de una célula',source:'primary',competency:'Ciencias'},{}).layout.includes('entrevista'),'do not impose this lesson technique on other subjects');
console.log('OK: U8 S1 criterion alignment, saved lesson situation/sequence, real versus simulated work, minimal visual briefs, valid report alternative, legacy criteria and individual/combined prompt parity.');
