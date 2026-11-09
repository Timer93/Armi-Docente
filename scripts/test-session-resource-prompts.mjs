import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-resource-prompts-'));
try {
    const entries = ['resource-prompts/sessionResourceCurriculum', 'resource-prompts/cleanResourceText', 'resource-prompts/buildCopyableResourcePrompt', 'resource-prompts/buildResourcePlanPrompt', 'resource-prompts/buildResourceImagePrompt', 'resourceGeneration'];
    const modules = await Promise.all(entries.map(async (entry, index) => {
        const output = path.join(temporary, `${index}.mjs`);
        await build({ entryPoints: [path.resolve(`components/sessions-view/${entry}.ts`)], outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
        return import(pathToFileURL(output).href);
    }));
    const [{ buildSessionResourceCurricularRows, getSessionResourceCurriculum, readSessionResourceItems }, { cleanSessionResourceText: clean }, { buildCopyableSessionResourcePrompt: copy }, { buildSessionResourcePlanPrompt: plan }, { buildSessionResourceImagePrompt: image }, { normalizeSessionResourcePlan: normalize }] = modules;
    // Textarea decoding double; the production rich-text cleaner itself runs here.
    globalThis.document = { createElement: () => ({ innerHTML: '', get value() { return this.innerHTML.replace(/&nbsp;/g, '\u00a0').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); } }) };
    const primaryCriterion = 'Diseña y aplica indicadores para el seguimiento y mejora de los procesos del proyecto.';
    const transversalCriterion = 'Crea contenidos multimedia y soluciones lógicas mediante programación para resolver problemas.';
    const evidences = [
        'Cuadro de indicadores de proceso (tiempo, calidad, costos).',
        'Reporte de acciones correctivas tomadas a partir de la evaluación de los indicadores.',
        'Proyecto multimedia (video, animación o material interactivo).',
        'Programa o código fuente con secuencias lógicas que resuelva una situación problemática planteada.'
    ];
    const sessionData = {
        competenciaPrio: { comp: 'Gestiona proyectos de emprendimiento económico y social.', cap: 'Evalúa los resultados del proyecto de emprendimiento', des: `<p>${primaryCriterion}</p>`, evidence: `<p>- ${evidences[0]}</p><p>- ${evidences[1]}</p>` },
        competenciasTrans: [
            { comp: 'Se desenvuelve en los entornos virtuales generados por las TIC', cap: 'Crea objetos virtuales en diversos formatos.', des: `<p>${transversalCriterion}</p>`, evidence: `<ul><li>${evidences[2]}</li><li>${evidences[3]}</li></ul>` },
            { comp: 'Competencia transversal sin seleccionar', cap: '', des: '<p><br></p>', evidence: '<p><br></p>' }
        ]
    };
    const rows = buildSessionResourceCurricularRows(sessionData, clean);
    assert.equal(rows.length, 2, 'Do not include blank, unselected transversal rows');
    const context = { area: 'EPT', grade: '2do', section: 'A', unit: '6', bimester: 'III', session: '6', sessionTotal: 8, duration: '90 minutos', title: 'Evaluar los procesos de producción mediante indicadores de control y recursos multimedia para plantear mejoras al proyecto.', purpose: 'Evaluar la eficiencia de los procesos de producción.', situation: 'Productos para el aniversario institucional.', competency: clean(sessionData.competenciaPrio.comp), capacity: clean(sessionData.competenciaPrio.cap), criterion: clean(sessionData.competenciaPrio.des), evidence: clean(sessionData.competenciaPrio.evidence), thematicField: 'Indicadores y recursos multimedia.', instrument: 'Rúbrica', curricularRows: rows, learningSequence: { priorKnowledge: '', cognitiveConflict: '', construction: '', application: '', metacognition: '', assessment: '' } };
    const curriculum = getSessionResourceCurriculum(context);
    assert.deepEqual(curriculum.criteria.map((item) => item.text), [primaryCriterion, transversalCriterion]);
    assert.deepEqual(curriculum.evidences.map((item) => item.text), evidences, 'Comma-separated examples and alternatives must stay within their single evidence');
    assert.deepEqual(readSessionResourceItems('1. Primer producto\n2. Segundo producto (a, b o c)', clean), ['Primer producto', 'Segundo producto (a, b o c)']);
    assert.deepEqual(readSessionResourceItems('<p>Diagnóstico &amp; propuesta.</p><p>Informe final.</p>', clean), ['Diagnóstico & propuesta.', 'Informe final.']);
    const resource = { kind: 'project', aspectRatio: '3:4', title: 'Anexo 2', pinned: false, imageUrl: '' };
    for (const kind of ['project', 'worksheet', 'form', 'gamification']) {
        const prompt = copy('annex2', { ...resource, kind }, context);
        assert.match(prompt, /CRITERIOS REALES: 2/); assert.match(prompt, /EVIDENCIAS REALES: 4/);
        evidences.forEach((evidence, index) => assert.ok(prompt.includes(`Evidencia ${index + 1} [${index < 2 ? 'Área' : 'Transversal'}]: ${evidence}`)));
        assert.ok(prompt.includes(`Criterio 2 [Transversal]: ${transversalCriterion}`));
        assert.match(prompt, /Copia LITERALMENTE/); assert.match(prompt, /espacio de producción|espacios de producción/);
        assert.match(prompt, /SESIÓN 6\/8/); assert.match(prompt, /EXACTAMENTE 1 IMAGEN/);
    }
    assert.match(plan(context, 'annex2', resource), /EVIDENCIAS REALES: 4/);
    const normalized = normalize({ heading: 'Reto de producción', sections: Array.from({ length: 9 }, (_, index) => ({ label: `Espacio ${index}`, body: 'Consigna de trabajo', visualFormat: 'workspace' })), sessionInfo: { criterion: 'Criterio inventado por IA', evidence: 'Entrega inventada por IA' } }, context, 'annex2');
    assert.equal(normalized.content.sections.length, 9, 'Do not discard later evidence workspaces by truncating to seven sections');
    assert.equal(normalized.content.sessionInfo.criterion, primaryCriterion);
    assert.deepEqual(normalized.content.sessionInfo.curricularRows, rows);
    for (const prompt of [image('annex2', resource, normalized.content, context), image('annex2', resource, normalized.content)]) {
        assert.match(prompt, /CRITERIOS REALES: 2/); assert.match(prompt, /EVIDENCIAS REALES: 4/);
        assert.ok(prompt.includes(evidences[3])); assert.ok(prompt.includes(transversalCriterion));
    }
    assert.doesNotMatch(copy('annex1', { ...resource, kind: 'youtube' }, context), /FUENTE CURRICULAR OBLIGATORIA DEL ANEXO 2/);
    assert.match(copy('instructive', resource, context), /FICHA INFORMATIVA AUTÓNOMA/);
    assert.doesNotMatch(plan(context, 'annex1', resource), /EVIDENCIAS REALES:/);
    const legacy = getSessionResourceCurriculum({ ...context, curricularRows: undefined, evidence: '• Evidencia antigua 1\n• Evidencia antigua 2' });
    assert.equal(legacy.evidences.length, 2, 'Legacy contexts still work without curricularRows');
    console.log('OK: Anexo 2 con criterios literales, cuatro evidencias del área y transversales, listas HTML, todos los subtipos, planificación e imagen; instructivo y Anexo 1 conservados.');
} finally {
    delete globalThis.document;
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5 });
}
