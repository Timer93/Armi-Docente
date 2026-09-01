import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-transversal-test-'));
const bundledModule = path.join(temporaryDirectory, 'shared.mjs');

try {
  await build({
    entryPoints: [path.resolve('components/sessions-view/shared.tsx')],
    outfile: bundledModule,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent'
  });

  const {
    buildSessionAssessmentModel,
    ensureSessionAssessmentModel
  } = await import(`${pathToFileURL(bundledModule).href}?v=${Date.now()}`);

  const transversalCriterion = 'Organiza información digital aplicando criterios de clasificación y seguridad.';
  const transversalEvidence = 'Captura de pantalla del portafolio digital organizado.';
  const descriptorC = 'Organiza parcialmente la información y requiere acompañamiento.';
  const fixture = {
    competenciaPrio: {
      comp: 'Gestiona proyectos de emprendimiento económico o social',
      cap: 'Crea propuestas de valor',
      des: '<p>Formula una propuesta de valor pertinente.</p>',
      evidence: '<p>Propuesta de valor terminada.</p>',
      inst: 'Rúbrica'
    },
    competenciasTrans: [{
      comp: 'Se desenvuelve en los entornos virtuales generados por las TIC',
      cap: 'Personaliza entornos virtuales',
      des: `<p>${transversalCriterion}</p>`,
      evidence: `<p>${transversalEvidence}</p>`,
      inst: 'Rúbrica',
      rowColor: '#007c59'
    }],
    instrumentoTemplate: { type: 'rubrica', name: 'Rúbrica' },
    instrumento: [
      { id: 1, criterio: 'Formula una propuesta de valor pertinente.', source: 'primary', c: '', b: '', a: '', ad: '' },
      { id: 2, criterio: transversalEvidence, source: 'transversal', c: descriptorC, b: 'B', a: 'A', ad: 'AD' }
    ]
  };

  const model = buildSessionAssessmentModel(fixture, {});
  const transversalRow = model.rows.find((row) => row.source === 'transversal');
  assert.ok(transversalRow, 'Debe existir una fila transversal.');
  assert.equal(transversalRow.criterionText, transversalCriterion);
  assert.notEqual(transversalRow.criterionText, transversalEvidence);
  assert.equal(transversalRow.evidenceText, `<p>${transversalEvidence}</p>`);

  const repaired = ensureSessionAssessmentModel(fixture, {});
  assert.equal(repaired.instrumento[1].criterio, transversalCriterion);
  assert.equal(repaired.instrumento[1].c, descriptorC, 'La reparación debe conservar los descriptores existentes.');
  assert.equal(repaired.instrumento[1].source, 'transversal');

  console.log('OK: la rúbrica transversal usa criterios de evaluación y conserva la evidencia por separado.');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
