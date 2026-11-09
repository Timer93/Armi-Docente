import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Execute the production initialization effect with deferred API responses.
const source = fs.readFileSync('components/SessionsView.tsx', 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('    useEffect(() => {\n        let active = true;');
assert.ok(start >= 0);
const end = source.indexOf('}, [initialSelection.year]);', start) + '}, [initialSelection.year]);'.length;
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const run = new Function('env', `with(env){${code}}`);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const make = () => {
  const general = deferred(), programs = deferred(), students = deferred();
  const calls = [], updates = [];
  let cleanup;
  const env = { useEffect: effect => { cleanup = effect(); },
    localStorage: { getItem: () => '[]' }, initialSelection: {}, navigationTarget: null,
    withSessionRegisterScope: value => value,
    getDatosGenerales: () => { calls.push('general'); return general.promise; },
    getProgramacionesAnuales: () => { calls.push('programs'); return programs.promise; },
    getEstudiantes: () => { calls.push('students'); return students.promise; },
  };
  for (const name of ['setAssignments', 'setAssignmentsLoaded', 'setGeneralData', 'setYear', 'setAllSavedPrograms', 'setSessionSourcesReady', 'setStudents']) {
    env[name] = value => updates.push([name, value]);
  }
  run(env);
  return { general, programs, students, calls, updates, stop: () => cleanup() };
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const first = make();
assert.deepEqual(first.calls, ['general', 'programs', 'students'], 'All independent requests must start without waiting for a response');
first.general.resolve({ year: '2026' }); first.programs.resolve({ lesson: {} });
await flush();
assert.ok(first.updates.some(([name, value]) => name === 'setSessionSourcesReady' && value === true), 'A slow student roster must not block the lesson editor');
assert.equal(first.updates.some(([name]) => name === 'setStudents'), false);
first.students.resolve([{ id: 1 }]); await flush();
assert.deepEqual(first.updates.at(-1), ['setStudents', [{ id: 1 }]]);
first.stop();
const abandoned = make();
abandoned.stop(); const count = abandoned.updates.length;
abandoned.general.resolve({ year: '2026' }); abandoned.programs.resolve({}); abandoned.students.resolve([]);
await flush();
assert.equal(abandoned.updates.length, count, 'Leaving the module must ignore late responses');
console.log('OK: parallel lesson startup, editor ready before slow roster, and ignored responses after exit.');
