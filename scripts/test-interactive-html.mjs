import assert from 'node:assert/strict';
import { buildInteractiveHtmlPrompt, buildSandboxedHtml, validateInteractiveHtml } from '../components/sessions-view/interactiveHtml.ts';
import { normalizeInteractiveResult, sandboxInteractiveHtml, validateStoredInteractiveActivity } from '../backend/interactiveHtml.js';

const validHtml = `<!doctype html><html><head><title>Reto matemático</title><meta name="armi-activity-version" content="1"><style>body{font-family:sans-serif}</style></head><body><header>Reto</header><main><button id="done">Finalizar</button></main><footer>Actividad compatible con ARMI Docente</footer><script>window.ARMI_PRACTICE.register({getState:()=>({question:3}),restoreState:()=>{},getResult:()=>({score:18,maxScore:20})});done.onclick=()=>window.parent.postMessage({type:'armi:activity-result',version:1,completed:true,score:18,maxScore:20,answersSummary:'4 de 5 retos'},'*')</script></body></html>`;

const validation = validateInteractiveHtml(validHtml);
assert.equal(validation.valid, true);
assert.equal(validation.title, 'Reto matemático');
assert.equal(validateStoredInteractiveActivity({ id: 'a1', enabled: true, criterionId: 'c1', html: validHtml }), true);
assert.equal(validateInteractiveHtml(validHtml.replace('name="armi-activity-version" content="1"', 'content="1" name="armi-activity-version"')).valid, true);

const unsafeHtml = validHtml.replace('<main>', '<main><script src="https://example.com/x.js"></script>');
assert.equal(validateInteractiveHtml(unsafeHtml).valid, false);
assert.equal(validateStoredInteractiveActivity({ id: 'a1', enabled: true, criterionId: 'c1', html: unsafeHtml }), false);

const clientSandbox = buildSandboxedHtml(validHtml);
const serverSandbox = sandboxInteractiveHtml(validHtml);
assert.match(clientSandbox, /Content-Security-Policy/i);
assert.match(serverSandbox, /connect-src 'none'/i);

assert.deepEqual(normalizeInteractiveResult({
  type: 'armi:activity-result', version: 1, completed: true, score: 9, maxScore: 10, answersSummary: 'Buen trabajo'
}), { score: 18, answersSummary: 'Buen trabajo' });
assert.equal(normalizeInteractiveResult({ type: 'armi:activity-result', version: 1, completed: true, score: 21, maxScore: 20 }), null);

const prompt = buildInteractiveHtmlPrompt({ area: 'EPT', grade: '4to', sessionNumber: '2', title: 'Prototipo', purpose: 'Validar', thematicField: 'Diseño', competency: 'Gestiona proyectos', capacity: 'Crea', criterion: 'Valida el prototipo', evidence: 'Prototipo probado', mode: 'group' });
assert.match(prompt, /armi:activity-result/);
assert.match(prompt, /Valida el prototipo/);
assert.match(prompt, /No uses fetch/);
assert.match(prompt, /Modalidad: grupal/);
assert.match(prompt, /ARMI_PRACTICE.register/);
assert.match(prompt, /una sola continuación de 5 minutos/);
assert.doesNotMatch(prompt, /botón para comenzar o reiniciar/);
assert.match(serverSandbox, /restoreState/);
assert.equal(validateInteractiveHtml(validHtml.replace('window.ARMI_PRACTICE.register', 'window.other.register')).valid, false);
assert.equal(validateStoredInteractiveActivity({ id: 'a1', enabled: true, criterionId: 'c1', mode: 'group', html: validHtml }), true);
assert.equal(validateStoredInteractiveActivity({ id: 'a1', enabled: true, criterionId: 'c1', mode: 'otro', html: validHtml }), false);

console.log('OK: importación HTML, aislamiento, contrato de resultados y prompt validados.');
