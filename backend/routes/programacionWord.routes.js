
import express from 'express';
import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';
import { exec, execFile } from 'child_process';
import db from '../db.js';
import { resolveTemplatePath, tempRoot } from '../paths.js';


const router = express.Router();
let generationProgress = {
    active: false,
    total: 0,
    current: 0,
    lastFile: '',
    error: null,
    outputPath: '',
    generatedCount: 0,
    missingIds: []
};
router.get('/programacion-word/status', (req, res) => { res.json(generationProgress); });

const getProgramacionTemplatePath = () => resolveTemplatePath('programacion_anual.docx');

const splitGroupedSections = (value) => {
    return Array.from(new Set(
        String(value || '')
            .split(/,| y /i)
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ));
};

const buildSectionTitle = (grade, section) => `${grade || ''} grado "${section || ''}"`.trim();

const normalizeText = (value) => String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const getProgramYear = (row, fallbackYear) => {
    const rawId = String(row?.id_programa || '');
    const fromId = rawId.split('-')[0];
    if (/^\d{4}$/.test(fromId)) return fromId;
    const fallback = String(fallbackYear || '').trim();
    return /^\d{4}$/.test(fallback) ? fallback : String(new Date().getFullYear());
};

const getCountByLevel = (meta, level) => {
    if (level === 'AD') return Number(meta?.cant_destacado || 0);
    if (level === 'A') return Number(meta?.cant_esperado || 0);
    if (level === 'B') return Number(meta?.cant_proceso || 0);
    if (level === 'C') return Number(meta?.cant_inicio || 0);
    return Number(meta?.cant_no_evaluado || 0);
};

const formatPercent = (numerator, denominator) => {
    if (!denominator || denominator <= 0) return '0%';
    const value = ((Number(numerator || 0) / Number(denominator || 1)) * 100).toFixed(1);
    return `${value.endsWith('.0') ? value.slice(0, -2) : value}%`;
};

const formatGenerationDateLong = (date = new Date()) => {
    const day = String(date.getDate());
    const month = date.toLocaleDateString('es-ES', { month: 'long' }).toUpperCase();
    const year = String(date.getFullYear());
    return `${day} DE ${month} DE ${year}`;
};

const formatDateSlash = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return raw;
    return `${match[3]}/${match[2]}/${match[1]}`;
};

const sanitizeFileLabel = (value, fallback = 'archivo') => {
    const cleaned = String(value ?? fallback)
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || fallback;
};

const toProperName = (value) => {
    const smallWords = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'o', 'u']);
    return String(value || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .map((word, index) => {
            if (index > 0 && smallWords.has(word)) return word;
            return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ');
};

const getMineduDuration = (startStr, endStr) => {
    if (!startStr || !endStr) return '';
    const [sYear, sMonth, sDay] = String(startStr).split('-').map(Number);
    const [eYear, eMonth, eDay] = String(endStr).split('-').map(Number);
    const start = new Date(sYear, sMonth - 1, sDay);
    const end = new Date(eYear, eMonth - 1, eDay);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return '';
    let workingDays = 0;
    const currentDate = new Date(start);
    while (currentDate <= end) {
        const dayOfWeek = currentDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) workingDays++;
        currentDate.setDate(currentDate.getDate() + 1);
    }
    const weeks = Math.floor(workingDays / 5);
    const days = workingDays % 5;
    return `${weeks} sem. y ${days} d.`;
};

const countWeekdaysBetween = (startStr, endStr) => {
    if (!startStr || !endStr) return 0;
    const [sYear, sMonth, sDay] = String(startStr).split('-').map(Number);
    const [eYear, eMonth, eDay] = String(endStr).split('-').map(Number);
    const start = new Date(sYear, sMonth - 1, sDay);
    const end = new Date(eYear, eMonth - 1, eDay);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0;
    let total = 0;
    const current = new Date(start);
    while (current <= end) {
        const dow = current.getDay();
        if (dow !== 0 && dow !== 6) total++;
        current.setDate(current.getDate() + 1);
    }
    return total;
};

const extractWeeksFromDuration = (duration) => {
    const match = String(duration || '').match(/^(\d+)\s+sem/);
    return match ? Number(match[1]) : 0;
};

const addWorkingDaysInclusive = (startStr, totalWorkingDays) => {
    if (!startStr || !totalWorkingDays || totalWorkingDays < 1) return '';
    const [year, month, day] = String(startStr).split('-').map(Number);
    const current = new Date(year, month - 1, day);
    if (Number.isNaN(current.getTime())) return '';
    let remaining = Number(totalWorkingDays) - 1;
    while (remaining > 0) {
        current.setDate(current.getDate() + 1);
        const dow = current.getDay();
        if (dow !== 0 && dow !== 6) remaining -= 1;
    }
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const TRANSVERSAL_COMPETENCY_NAMES = [
    'SE DESENVUELVE EN ENTORNOS VIRTUALES GENERADOS POR LAS TIC',
    'SE DESENVUELVE EN LOS ENTORNOS VIRTUALES GENERADOS POR LAS TIC',
    'GESTIONA SU APRENDIZAJE DE MANERA AUTONOMA'
];

const extractTemplateFields = () => {
    const templatePath = getProgramacionTemplatePath();
    if (!fs.existsSync(templatePath)) throw new Error('Plantilla no encontrada.');

    const zip = new PizZip(fs.readFileSync(templatePath));
    const xmlNames = Object.keys(zip.files).filter((name) => name.startsWith('word/') && name.endsWith('.xml'));
    const fieldSet = new Set();
    const placeholderRegex = /<<\s*([^<>]+?)\s*>>/g;

    xmlNames.forEach((name) => {
        const xml = zip.file(name)?.asText() || '';
        let match;
        while ((match = placeholderRegex.exec(xml)) !== null) {
            const fieldName = String(match[1] || '').trim();
            if (fieldName) fieldSet.add(fieldName);
        }
    });

    return Array.from(fieldSet).sort((a, b) => String(a).localeCompare(String(b), 'es'));
};

const extractRouteTemplateKeys = () => {
    const filePath = path.resolve('backend/routes/programacionWord.routes.js');
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, 'utf8');
    const keys = new Set();

    const extractKeysFromBlock = (startLabel) => {
        const blockRegex = new RegExp(`${startLabel}\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\};`, 'm');
        const blockMatch = content.match(blockRegex);
        if (!blockMatch) return;
        const propRegex = /^\s*([a-zA-Z0-9_]+)\s*:/gm;
        let propMatch;
        while ((propMatch = propRegex.exec(blockMatch[1])) !== null) {
            const key = String(propMatch[1] || '').trim();
            if (key) keys.add(key);
        }
    };

    extractKeysFromBlock('const DATOS_GENERALES');
    extractKeysFromBlock('const RECURSOS');
    extractKeysFromBlock('const calendario');
    extractKeysFromBlock('const vinculacionPlano');

    const setDataMatch = content.match(/doc\.setData\(\{([\s\S]*?)\n\s*\}\);/m);
    if (setDataMatch) {
        const propRegex = /^\s*([a-zA-Z0-9_]+)\s*:/gm;
        let propMatch;
        while ((propMatch = propRegex.exec(setDataMatch[1])) !== null) {
            const key = String(propMatch[1] || '').trim();
            if (key) keys.add(key);
        }
    }

    [
        'metas_por_seccion',
        'metas_secciones',
        'meta_seccion_orden',
        'meta_seccion_indice',
        'meta_seccion_grado',
        'meta_seccion_seccion',
        'meta_seccion_titulo',
        'meta_seccion_subtitulo',
        'metas_competencias',
        'meta_competencia',
        'meta_competencia_seccion',
        'meta_competencia_titulo',
        'meta_current_year',
        'meta_prev_year',
        'current_year',
        'prev_year',
        'meta_total_estudiantes',
        'meta_total_lb',
        'meta_total_diag',
        'meta_total_meta',
        'meta_total_lb_display',
        'meta_total_diag_display',
        'meta_total_meta_display',
        'meta_total_lb_percent',
        'meta_total_diag_percent',
        'meta_total_meta_percent',
        'meta_niveles',
        'nivel_logro',
        'lb_cantidad',
        'lb_porcentaje',
        'dg_cantidad',
        'dg_porcentaje',
        'mt_cantidad',
        'mt_porcentaje',
        'lb_ad',
        'lb_ad_percent',
        'lb_a',
        'lb_a_percent',
        'lb_b',
        'lb_b_percent',
        'lb_c',
        'lb_c_percent',
        'lb_ne',
        'lb_ne_percent',
        'dg_ad',
        'dg_ad_percent',
        'dg_a',
        'dg_a_percent',
        'dg_b',
        'dg_b_percent',
        'dg_c',
        'dg_c_percent',
        'dg_ne',
        'dg_ne_percent',
        'mt_ad',
        'mt_ad_percent',
        'mt_a',
        'mt_a_percent',
        'mt_b',
        'mt_b_percent',
        'mt_c',
        'mt_c_percent',
        'mt_ne'
        ,
        'mt_ne_percent',
        'diagnostico_por_seccion',
        'diagnostico_seccion_orden',
        'diagnostico_seccion_indice',
        'diagnostico_seccion_grado',
        'diagnostico_seccion_seccion',
        'diagnostico_seccion_titulo',
        'diagnostico_seccion_subtitulo',
        'diagnostico_competencias',
        'diagnostico_competencia',
        'diagnostico_competencia_titulo',
        'diagnostico_estudiantes',
        'diagnostico_estudiante_numero',
        'diagnostico_estudiante_numero_2d',
        'diagnostico_estudiante_nombre',
        'diagnostico_estudiante_nl',
        'diagnostico_estudiante_conclusion',
        'competencias_estandares_bloques',
        'compest_bloque_tipo',
        'compest_bloque_titulo',
        'compest_bloque_sigla',
        'compest_competencias',
        'compest_competencia',
        'compest_estandar',
        'compest_capacidades',
        'compest_capacidad',
        'compest_capacidades_texto',
        'compest_cap_1',
        'compest_cap_2',
        'compest_cap_3',
        'compest_cap_4',
        'compest_cap_5',
        'compest_cap_6',
        'compest_has_cap_1',
        'compest_has_cap_2',
        'compest_has_cap_3',
        'compest_has_cap_4',
        'compest_has_cap_5',
        'compest_has_cap_6',
        'compest_filas',
        'compest_fila_capacidad',
        'compest_fila_competencia',
        'compest_fila_estandar',
        'compest_fila_es_primera',
        'compest_fila_competencia_repetida',
        'compest_fila_estandar_repetido'
    ].forEach((key) => keys.add(key));

    return Array.from(keys).sort((a, b) => String(a).localeCompare(String(b), 'es'));
};

router.post('/programacion-word/generate', async (req, res) => {
    const { ids, customPath, anchorPath } = req.body;
    const normalizedIds = Array.isArray(ids)
        ? ids.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
    if (normalizedIds.length === 0) return res.status(400).json({ success: false, message: "No se seleccionaron registros." });

    const outputPath = customPath ? path.resolve(customPath) : tempRoot;

    if (anchorPath) {
        try { db.prepare("UPDATE datos_generales SET path_word_default = ? WHERE id = (SELECT id FROM datos_generales LIMIT 1)").run(outputPath); } 
        catch (e) { console.error("Error al anclar ruta:", e.message); }
    }
    if (!fs.existsSync(outputPath)) {
        try { fs.mkdirSync(outputPath, { recursive: true }); } 
        catch (e) { return res.status(500).json({ success: false, message: "No se pudo acceder a la ruta." }); }
    }
    generationProgress = {
        active: true,
        total: normalizedIds.length,
        current: 0,
        lastFile: '',
        error: null,
        outputPath,
        generatedCount: 0,
        missingIds: []
    };
    res.json({ success: true, message: "Generación iniciada." });

    try {
        const placeholders = normalizedIds.map(() => '?').join(',');
        const rows = db.prepare(`SELECT * FROM programacion_anual WHERE id_programa IN (${placeholders})`).all(...normalizedIds);
        const foundIds = new Set(rows.map((row) => String(row.id_programa)));
        generationProgress.missingIds = normalizedIds.filter((id) => !foundIds.has(id));
        if (rows.length === 0) throw new Error("No se encontraron programaciones válidas para exportar.");
        
        const dg = db.prepare(`
            SELECT *
            FROM datos_generales
            LIMIT 1
        `).get() || {};

        const DATOS_GENERALES = {
            ie: dg.institution || '',
            institution: dg.institution || '',
            ugel: dg.ugel || '',
            department: dg.department || '',
            province: toProperName(dg.province || ''),
            district: toProperName(dg.district || ''),
            lugar: dg.lugar || '',
            level: dg.level || '',
            school_shift: dg.school_shift || '',
            motto: dg.motto || '',
            year_name: dg.year_name || '',
            nombre_del_ano: dg.year_name || '',
            year: dg.year || '',
            fecha_generacion_larga: formatGenerationDateLong(),
            generation_date_long: formatGenerationDateLong(),
            docente: dg.teacher || '',
            teacher: dg.teacher || '',
            director: dg.director || '',
            sub_director: dg.subdirector || '',
            coord_ped: dg.pedagogical_coordinator || '',
            coord_tut: dg.toe_coordinator || '',
            context_description: dg.context_description || '',
            insignia: dg.insignia || '',
            logo: dg.logo || '',
            b1_start: dg.b1_start || '',
            b1_end: dg.b1_end || '',
            b2_start: dg.b2_start || '',
            b2_end: dg.b2_end || '',
            b3_start: dg.b3_start || '',
            b3_end: dg.b3_end || '',
            b4_start: dg.b4_start || '',
            b4_end: dg.b4_end || '',
            vac_start: dg.vac_start || '',
            vac_end: dg.vac_end || '',
            u1_start: dg.u1_start || '',
            u1_end: dg.u1_end || '',
            u2_start: dg.u2_start || '',
            u2_end: dg.u2_end || '',
            u3_start: dg.u3_start || '',
            u3_end: dg.u3_end || '',
            u4_start: dg.u4_start || '',
            u4_end: dg.u4_end || '',
            u5_start: dg.u5_start || '',
            u5_end: dg.u5_end || '',
            u6_start: dg.u6_start || '',
            u6_end: dg.u6_end || '',
            u7_start: dg.u7_start || '',
            u7_end: dg.u7_end || '',
            u8_start: dg.u8_start || '',
            u8_end: dg.u8_end || '',
            u_vac_start: dg.u_vac_start || '',
            u_vac_end: dg.u_vac_end || ''
        };

        for (const row of rows) {
            const matrix = JSON.parse(row.matrix_checks || '{}');
            const tempCurr = JSON.parse(row.temp_curr_area || '{}');
            const currentYear = getProgramYear(row, dg.year);
            const prevYear = String(Number(currentYear) - 1);
            const currentLevel = String(dg.level || '').trim();
            const CHECK = '✓';
            const EMPTY = '-';
            const crearChecks = () => ({ u0: EMPTY, u1: EMPTY, u2: EMPTY, u3: EMPTY, u4: EMPTY, u5: EMPTY, u6: EMPTY, u7: EMPTY });
            const competenciasMap = {};
            
            Object.entries(matrix).forEach(([key, value]) => {
                if (typeof value !== 'boolean' || !value) return;
                if (!key.startsWith('comp-') && !key.startsWith('cap-')) return;
                const parts = key.split('-'); const unidad = parseInt(parts.pop(), 10);
                if (isNaN(unidad) || unidad < 0 || unidad > 7) return;
                const tipo = parts.shift(); let compId = null; let capNombre = null;
                if (tipo === 'comp') compId = parts.join('-');
                if (tipo === 'cap') { compId = parts.slice(0, -1).join('-'); capNombre = parts[parts.length - 1]; }
                if (!competenciasMap[compId]) {
                    competenciasMap[compId] = { nombre: compId.replace(/-/g, ' ').toUpperCase(), checks: crearChecks(), capacidades: [] };
                }
                if (tipo === 'comp') { competenciasMap[compId].checks[`u${unidad}`] = CHECK; }
                if (tipo === 'cap') {
                    let cap = competenciasMap[compId].capacidades.find(c => c.nombre === capNombre);
                    if (!cap) { cap = { nombre: capNombre.replace(/-/g, ' '), checks: crearChecks() }; competenciasMap[compId].capacidades.push(cap); }
                    cap.checks[`u${unidad}`] = CHECK;
                }
            });

            const filas = [];
            Object.values(competenciasMap).forEach((comp, i) => {
                filas.push({ numero: i + 1, nombre: comp.nombre, c0: comp.checks.u0, c1: comp.checks.u1, c2: comp.checks.u2, c3: comp.checks.u3, c4: comp.checks.u4, c5: comp.checks.u5, c6: comp.checks.u6, c7: comp.checks.u7 });
                comp.capacidades.forEach((cap, j) => {
                    filas.push({ numero: `  ${i + 1}.${j + 1}`, nombre: cap.nombre, c0: cap.checks.u0, c1: cap.checks.u1, c2: cap.checks.u2, c3: cap.checks.u3, c4: cap.checks.u4, c5: cap.checks.u5, c6: cap.checks.u6, c7: cap.checks.u7 });
                });
            });

            const normalizarParrafos = (texto) => {
                if (!texto || typeof texto !== 'string') return [];
                return texto.replace(/\r\n/g, '\n').replace(/•/g, '\n').split('\n').map(t => t.trim()).filter(Boolean).map(t => ({ item: t }));
            };

            const rec = db.prepare(`SELECT * FROM programacion_recursos WHERE id_programa = ?`).get(row.id_programa) || {};

            const RECURSOS = {
                medios: normalizarParrafos(rec.medios),
                materiales: normalizarParrafos(rec.materiales),
                recursos: normalizarParrafos(rec.recursos),
                espacios: normalizarParrafos(rec.espacios),
                apps: normalizarParrafos(rec.apps),
                softwares: normalizarParrafos(rec.softwares),
                plataformas: normalizarParrafos(rec.plataformas),
                referencias: normalizarParrafos(rec.referencias),
                linkografia: normalizarParrafos(rec.linkografia)
            };

            const temp = JSON.parse(row.temp_curr_area || '{}');
            const resumenSecciones = Array.isArray(temp?.resumenSecciones) ? temp.resumenSecciones : [];
            const preferredSections = splitGroupedSections(row.section);
            const temporalizacionRef = preferredSections
                .map((sectionName) => resumenSecciones.find((item) => String(item?.seccion || '').trim() === sectionName))
                .find(Boolean) || resumenSecciones[0] || {};
            const bimRows = Array.isArray(temporalizacionRef?.bimestres) ? temporalizacionRef.bimestres : [];
            const lectiveBims = bimRows.filter((item) => item?.target === 'A');
            const managementBlocks = bimRows.filter((item) =>
                item?.target === 'B' &&
                countWeekdaysBetween(item?.start || '', item?.end || '') >= 5
            );
            const diagnosticaStartIso = String(dg.b1_start || '').trim();
            const diagnosticaEndIso = addWorkingDaysInclusive(diagnosticaStartIso, 10);
            const diagnosticaDuration = getMineduDuration(diagnosticaStartIso, diagnosticaEndIso);
            const totalGestionWeeks = managementBlocks.reduce((acc, item) => acc + extractWeeksFromDuration(item?.weeks), 0);
            const totalEffectiveWeeks = lectiveBims.reduce((acc, item) => acc + extractWeeksFromDuration(item?.weeks), 0);
            const unitRanges = Array.from({ length: 8 }, (_, index) => {
                const unitNumber = index + 1;
                const start = String(dg[`u${unitNumber}_start`] || '').trim();
                const end = String(dg[`u${unitNumber}_end`] || '').trim();
                return {
                    start,
                    end,
                    weeks: getMineduDuration(start, end)
                };
            });
            const unitVacationWeeks = getMineduDuration(dg.u_vac_start, dg.u_vac_end);
            const calendario = {
                bim1_inicio: formatDateSlash(lectiveBims[0]?.start || ''),
                bim1_fin: formatDateSlash(lectiveBims[0]?.end || ''),
                bim1_semanas: lectiveBims[0]?.weeks || '',
                bim1_dias: lectiveBims[0]?.days || '',
                bim1_horas: lectiveBims[0]?.hours || '',
                bim2_inicio: formatDateSlash(lectiveBims[1]?.start || ''),
                bim2_fin: formatDateSlash(lectiveBims[1]?.end || ''),
                bim2_semanas: lectiveBims[1]?.weeks || '',
                bim2_dias: lectiveBims[1]?.days || '',
                bim2_horas: lectiveBims[1]?.hours || '',
                vac_inicio: formatDateSlash(dg.vac_start || managementBlocks[2]?.start || ''),
                vac_fin: formatDateSlash(dg.vac_end || managementBlocks[2]?.end || ''),
                vac_semanas: getMineduDuration(dg.vac_start || managementBlocks[2]?.start || '', dg.vac_end || managementBlocks[2]?.end || '') || managementBlocks[2]?.weeks || '',
                vac_dias: managementBlocks[2]?.days || '',
                vac_horas: managementBlocks[2]?.hours || '',
                bim3_inicio: formatDateSlash(lectiveBims[2]?.start || ''),
                bim3_fin: formatDateSlash(lectiveBims[2]?.end || ''),
                bim3_semanas: lectiveBims[2]?.weeks || '',
                bim3_dias: lectiveBims[2]?.days || '',
                bim3_horas: lectiveBims[2]?.hours || '',
                bim4_inicio: formatDateSlash(lectiveBims[3]?.start || ''),
                bim4_fin: formatDateSlash(lectiveBims[3]?.end || ''),
                bim4_semanas: lectiveBims[3]?.weeks || '',
                bim4_dias: lectiveBims[3]?.days || '',
                bim4_horas: lectiveBims[3]?.hours || '',
                gestion1_inicio: formatDateSlash(managementBlocks[0]?.start || ''),
                gestion1_fin: formatDateSlash(managementBlocks[0]?.end || ''),
                gestion1_semanas: managementBlocks[0]?.weeks || '',
                gestion2_inicio: formatDateSlash(managementBlocks[1]?.start || ''),
                gestion2_fin: formatDateSlash(managementBlocks[1]?.end || ''),
                gestion2_semanas: managementBlocks[1]?.weeks || '',
                gestion3_inicio: formatDateSlash(managementBlocks[2]?.start || ''),
                gestion3_fin: formatDateSlash(managementBlocks[2]?.end || ''),
                gestion3_semanas: managementBlocks[2]?.weeks || '',
                gestion4_inicio: formatDateSlash(managementBlocks[3]?.start || ''),
                gestion4_fin: formatDateSlash(managementBlocks[3]?.end || ''),
                gestion4_semanas: managementBlocks[3]?.weeks || '',
                gestion5_inicio: formatDateSlash(managementBlocks[4]?.start || ''),
                gestion5_fin: formatDateSlash(managementBlocks[4]?.end || ''),
                gestion5_semanas: managementBlocks[4]?.weeks || '',
                g1_start: formatDateSlash(managementBlocks[0]?.start || ''),
                g1_end: formatDateSlash(managementBlocks[0]?.end || ''),
                g1_weeks: managementBlocks[0]?.weeks || '',
                g2_start: formatDateSlash(managementBlocks[1]?.start || ''),
                g2_end: formatDateSlash(managementBlocks[1]?.end || ''),
                g2_weeks: managementBlocks[1]?.weeks || '',
                g3_start: formatDateSlash(managementBlocks[2]?.start || ''),
                g3_end: formatDateSlash(managementBlocks[2]?.end || ''),
                g3_weeks: managementBlocks[2]?.weeks || '',
                g4_start: formatDateSlash(managementBlocks[3]?.start || ''),
                g4_end: formatDateSlash(managementBlocks[3]?.end || ''),
                g4_weeks: managementBlocks[3]?.weeks || '',
                g5_start: formatDateSlash(managementBlocks[4]?.start || ''),
                g5_end: formatDateSlash(managementBlocks[4]?.end || ''),
                g5_weeks: managementBlocks[4]?.weeks || '',
                diagnostica_inicio: formatDateSlash(diagnosticaStartIso),
                diagnostica_fin: formatDateSlash(diagnosticaEndIso),
                diagnostica_semanas: diagnosticaDuration || '2 sem. y 0 d.',
                diag_start: formatDateSlash(diagnosticaStartIso),
                diag_end: formatDateSlash(diagnosticaEndIso),
                diag_weeks: diagnosticaDuration || '2 sem. y 0 d.',
                total_semanas_diagnostico: extractWeeksFromDuration(diagnosticaDuration || '2 sem. y 0 d.'),
                total_semanas_gestion: totalGestionWeeks,
                total_semanas_efectivas: totalEffectiveWeeks,
                total_diagnostico: `${extractWeeksFromDuration(diagnosticaDuration || '2 sem. y 0 d.')} semanas de diagnóstico`,
                total_gestion: `${totalGestionWeeks} semanas de gestión`,
                total_efectivas: `${totalEffectiveWeeks} semanas efectivas`,
                u1_start: formatDateSlash(unitRanges[0]?.start || ''),
                u1_end: formatDateSlash(unitRanges[0]?.end || ''),
                u1_weeks: unitRanges[0]?.weeks || '',
                u2_start: formatDateSlash(unitRanges[1]?.start || ''),
                u2_end: formatDateSlash(unitRanges[1]?.end || ''),
                u2_weeks: unitRanges[1]?.weeks || '',
                u3_start: formatDateSlash(unitRanges[2]?.start || ''),
                u3_end: formatDateSlash(unitRanges[2]?.end || ''),
                u3_weeks: unitRanges[2]?.weeks || '',
                u4_start: formatDateSlash(unitRanges[3]?.start || ''),
                u4_end: formatDateSlash(unitRanges[3]?.end || ''),
                u4_weeks: unitRanges[3]?.weeks || '',
                u5_start: formatDateSlash(unitRanges[4]?.start || ''),
                u5_end: formatDateSlash(unitRanges[4]?.end || ''),
                u5_weeks: unitRanges[4]?.weeks || '',
                u6_start: formatDateSlash(unitRanges[5]?.start || ''),
                u6_end: formatDateSlash(unitRanges[5]?.end || ''),
                u6_weeks: unitRanges[5]?.weeks || '',
                u7_start: formatDateSlash(unitRanges[6]?.start || ''),
                u7_end: formatDateSlash(unitRanges[6]?.end || ''),
                u7_weeks: unitRanges[6]?.weeks || '',
                u8_start: formatDateSlash(unitRanges[7]?.start || ''),
                u8_end: formatDateSlash(unitRanges[7]?.end || ''),
                u8_weeks: unitRanges[7]?.weeks || '',
                u_vac_start: formatDateSlash(dg.u_vac_start || ''),
                u_vac_end: formatDateSlash(dg.u_vac_end || ''),
                u_vac_weeks: unitVacationWeeks || '',
                unidades_total_semanas: totalEffectiveWeeks,
                units_total_weeks: totalEffectiveWeeks,
                total_horas: temp.totalEfectivas || temporalizacionRef.totalEfectivas || ''
            };

            const EJES_CHECK = '✓';
            const EJES_EMPTY = '-';
            const ejesMap = {};
            Object.entries(matrix).forEach(([key, value]) => {
                if (typeof value !== 'boolean' || !key.startsWith('ejeReg-')) return;
                const parts = key.split('-'); const unidad = parseInt(parts.pop(), 10);
                const nombre = parts.slice(1).join('-').replace(/-/g, ' ');
                if (!ejesMap[nombre]) {
                    ejesMap[nombre] = { nombre, checks: { u0: EJES_EMPTY, u1: EJES_EMPTY, u2: EJES_EMPTY, u3: EJES_EMPTY, u4: EJES_EMPTY, u5: EJES_EMPTY, u6: EJES_EMPTY, u7: EJES_EMPTY } };
                }
                ejesMap[nombre].checks[`u${unidad}`] = value ? EJES_CHECK : EJES_EMPTY;
            });
            const filasEjes = Object.values(ejesMap).map(f => ({ nombre: f.nombre, c0: f.checks.u0, c1: f.checks.u1, c2: f.checks.u2, c3: f.checks.u3, c4: f.checks.u4, c5: f.checks.u5, c6: f.checks.u6, c7: f.checks.u7 }));

            const ENFOQUE_CHECK = '✓';
            const ENFOQUE_EMPTY = '-';
            const enfoquesMap = {};
            Object.entries(matrix).forEach(([key, value]) => {
                if (typeof value !== 'boolean' || !key.startsWith('enfoque-')) return;
                const parts = key.split('-'); const unidad = parseInt(parts.pop(), 10);
                const nombre = parts.slice(1).join('-').replace(/-/g, ' ');
                if (!enfoquesMap[nombre]) {
                    enfoquesMap[nombre] = { nombre, checks: { u0: ENFOQUE_EMPTY, u1: ENFOQUE_EMPTY, u2: ENFOQUE_EMPTY, u3: ENFOQUE_EMPTY, u4: ENFOQUE_EMPTY, u5: ENFOQUE_EMPTY, u6: ENFOQUE_EMPTY, u7: ENFOQUE_EMPTY } };
                }
                enfoquesMap[nombre].checks[`u${unidad}`] = value ? ENFOQUE_CHECK : ENFOQUE_EMPTY;
            });

            const vinculacionPlano = { vinculacion_c0: '', vinculacion_c1: '', vinculacion_c2: '', vinculacion_c3: '', vinculacion_c4: '', vinculacion_c5: '', vinculacion_c6: '', vinculacion_c7: '' };
            Object.entries(matrix).forEach(([key, value]) => {
                if (!key.startsWith('vinculacion-')) return;
                const unidad = Number(key.split('-')[1]);
                if (!Number.isInteger(unidad) || unidad < 0 || unidad > 7) return;
                if (!Array.isArray(value)) return;
                vinculacionPlano[`vinculacion_c${unidad}`] = value.join(', ');
            });

            const filasEnfoques = Object.values(enfoquesMap).map(f => ({ nombre: f.nombre, c0: f.checks.u0, c1: f.checks.u1, c2: f.checks.u2, c3: f.checks.u3, c4: f.checks.u4, c5: f.checks.u5, c6: f.checks.u6, c7: f.checks.u7 }));

            // --- PROCESAMIENTO DE METAS DE APRENDIZAJE ---
            const metasCrudas = JSON.parse(row.metas_datos || '[]');
            const metasMap = [];
            // Agrupar metas por competencia y sección para la plantilla
            const seccionesMetas = Array.from(new Set(
                metasCrudas
                    .map((m) => String(m?.seccion || '').trim())
                    .filter(Boolean)
            ));
            const seccionesGuardadas = splitGroupedSections(row.section);
            const secciones = Array.from(new Set([
                ...seccionesGuardadas,
                ...seccionesMetas
            ].filter(Boolean)));
            const competenciasMetas = Array.from(new Set(
                metasCrudas
                    .map((m) => String(m?.competencia || '').trim())
                    .filter(Boolean)
            ));
            
            competenciasMetas.forEach(comp => {
                secciones.forEach(sec => {
                    const lb = metasCrudas.find(m => m.competencia === comp && m.seccion === sec && m.tipo === 'LINEA_BASE') || {};
                    const diag = metasCrudas.find(m => m.competencia === comp && m.seccion === sec && m.tipo === 'DIAGNOSTICO') || {};
                    const meta = metasCrudas.find(m => m.competencia === comp && m.seccion === sec && m.tipo === 'META') || {};
                    
                    metasMap.push({
                        competencia: comp,
                        meta_competencia: comp,
                        seccion: sec,
                        meta_competencia_seccion: sec,
                        // Cantidades
                        lb_ad: lb.cant_destacado || 0, lb_a: lb.cant_esperado || 0, lb_b: lb.cant_proceso || 0, lb_c: lb.cant_inicio || 0, lb_ne: lb.cant_no_evaluado || 0,
                        dg_ad: diag.cant_destacado || 0, dg_a: diag.cant_esperado || 0, dg_b: diag.cant_proceso || 0, dg_c: diag.cant_inicio || 0, dg_ne: diag.cant_no_evaluado || 0,
                        mt_ad: meta.cant_destacado || 0, mt_a: meta.cant_esperado || 0, mt_b: meta.cant_proceso || 0, mt_c: meta.cant_inicio || 0, mt_ne: meta.cant_no_evaluado || 0
                    });
                });
            });

            const enrollmentRows = db.prepare(`
                SELECT secc, COUNT(*) AS cantidad
                FROM db_estudiantes
                WHERE TRIM(UPPER(grado)) = TRIM(UPPER(?))
                  AND TRIM(UPPER(estado)) != 'R'
                GROUP BY secc
            `).all(row.grade);

            const enrollmentBySection = {};
            enrollmentRows.forEach((item) => {
                enrollmentBySection[normalizeText(item.secc)] = Number(item.cantidad || 0);
            });

            const diagnosticoRows = db.prepare(`
                SELECT seccion, competencia, nivel_logro, COUNT(*) AS cantidad
                FROM "resultados_diagnóstico"
                WHERE TRIM(UPPER(area)) = TRIM(UPPER(?))
                  AND TRIM(UPPER(grado)) = TRIM(UPPER(?))
                  AND TRIM(UPPER("año")) = TRIM(UPPER(?))
                  AND (? = '' OR TRIM(UPPER(nivel)) = TRIM(UPPER(?)))
                GROUP BY seccion, competencia, nivel_logro
            `).all(row.area_curricular, row.grade, currentYear, currentLevel, currentLevel);

            const lineaBaseRows = db.prepare(`
                SELECT seccion, competencia, nivel_logro, COUNT(*) AS cantidad
                FROM "resultados_diagnóstico"
                WHERE TRIM(UPPER(area)) = TRIM(UPPER(?))
                  AND TRIM(UPPER(grado)) = TRIM(UPPER(?))
                  AND TRIM(UPPER("año")) = TRIM(UPPER(?))
                  AND (? = '' OR TRIM(UPPER(nivel)) = TRIM(UPPER(?)))
                GROUP BY seccion, competencia, nivel_logro
            `).all(row.area_curricular, row.grade, prevYear, currentLevel, currentLevel);

            const diagnosticoDetalleRows = db.prepare(`
                SELECT seccion, competencia, estudiante_nombre, nivel_logro, conclusion_descriptiva
                FROM "resultados_diagnóstico"
                WHERE TRIM(UPPER(area)) = TRIM(UPPER(?))
                  AND TRIM(UPPER(grado)) = TRIM(UPPER(?))
                  AND TRIM(UPPER("año")) = TRIM(UPPER(?))
                  AND (? = '' OR TRIM(UPPER(nivel)) = TRIM(UPPER(?)))
                ORDER BY seccion, competencia, estudiante_nombre
            `).all(row.area_curricular, row.grade, currentYear, currentLevel, currentLevel);

            const competenciasDbRows = db.prepare('SELECT * FROM db_competencias').all()
                .filter((item) => normalizeText(item.grado || '').includes(normalizeText(row.grade || '')));

            const estandaresDbRows = db.prepare('SELECT * FROM db_estandares').all()
                .filter((item) => normalizeText(item.grado || '').includes(normalizeText(row.grade || '')));

            const isTransversalCompetency = (value) => {
                const normalizedValue = normalizeText(value);
                return TRANSVERSAL_COMPETENCY_NAMES.some((target) =>
                    normalizedValue === target ||
                    normalizedValue.includes(target) ||
                    target.includes(normalizedValue)
                );
            };

            const buildCompetencyStandardGroups = (baseRows, standardRows) => {
                const grouped = {};

                baseRows.forEach((item) => {
                    const competencia = String(item?.competencias || '').trim();
                    const capacidad = String(item?.capacidades || '').trim();
                    if (!competencia) return;
                    if (!grouped[competencia]) {
                        const estandarMatch = standardRows.find((standard) =>
                            normalizeText(standard?.competencias || '') === normalizeText(competencia)
                        );
                        grouped[competencia] = {
                            compest_competencia: competencia,
                            compest_estandar: String(estandarMatch?.estandar || 'No se halló estándar registrado para esta competencia.').trim(),
                            compest_capacidades: []
                        };
                    }
                    const existingCapacity = grouped[competencia].compest_capacidades.some((entry) =>
                        normalizeText(entry.compest_capacidad) === normalizeText(capacidad)
                    );
                    if (capacidad && !existingCapacity) {
                        grouped[competencia].compest_capacidades.push({ compest_capacidad: capacidad });
                    }
                });

                return Object.values(grouped).map((group) => {
                    const capacities = group.compest_capacidades.map((item) => item.compest_capacidad);
                    const fixedCapacities = Array.from({ length: 6 }, (_, index) => String(capacities[index] || '').trim());
                    return {
                        ...group,
                        compest_capacidades_texto: capacities.join('\n'),
                        compest_cap_1: fixedCapacities[0],
                        compest_cap_2: fixedCapacities[1],
                        compest_cap_3: fixedCapacities[2],
                        compest_cap_4: fixedCapacities[3],
                        compest_cap_5: fixedCapacities[4],
                        compest_cap_6: fixedCapacities[5],
                        compest_has_cap_1: !!fixedCapacities[0],
                        compest_has_cap_2: !!fixedCapacities[1],
                        compest_has_cap_3: !!fixedCapacities[2],
                        compest_has_cap_4: !!fixedCapacities[3],
                        compest_has_cap_5: !!fixedCapacities[4],
                        compest_has_cap_6: !!fixedCapacities[5],
                        compest_filas: group.compest_capacidades.map((item, capacityIndex) => ({
                            compest_fila_capacidad: item.compest_capacidad,
                            compest_fila_competencia: capacityIndex === 0 ? group.compest_competencia : '',
                            compest_fila_estandar: capacityIndex === 0 ? group.compest_estandar : '',
                            compest_fila_es_primera: capacityIndex === 0,
                            compest_fila_competencia_repetida: group.compest_competencia,
                            compest_fila_estandar_repetido: group.compest_estandar
                        }))
                    };
                });
            };

            const areaCompetenciasRows = competenciasDbRows.filter((item) =>
                normalizeText(item.area || '') === normalizeText(row.area_curricular || '') &&
                !isTransversalCompetency(item.competencias)
            );

            const areaEstandaresRows = estandaresDbRows.filter((item) =>
                normalizeText(item.area || '') === normalizeText(row.area_curricular || '') &&
                !isTransversalCompetency(item.competencias)
            );

            const transversalCompetenciasRows = competenciasDbRows.filter((item) =>
                isTransversalCompetency(item.competencias) || isTransversalCompetency(item.area)
            );

            const transversalEstandaresRows = estandaresDbRows.filter((item) =>
                isTransversalCompetency(item.competencias) || isTransversalCompetency(item.area)
            );

            const competenciasEstandaresBloques = [
                {
                    compest_bloque_tipo: 'AREA',
                    compest_bloque_titulo: `DEL AREA DE ${String(row.area_curricular || '').trim()}`,
                    compest_bloque_sigla: String(row.area_id || row.area_curricular || '').trim(),
                    compest_competencias: buildCompetencyStandardGroups(areaCompetenciasRows, areaEstandaresRows)
                },
                {
                    compest_bloque_tipo: 'TRANSVERSAL',
                    compest_bloque_titulo: 'TRANSVERSALES',
                    compest_bloque_sigla: 'TRANSVERSALES',
                    compest_competencias: buildCompetencyStandardGroups(transversalCompetenciasRows, transversalEstandaresRows)
                }
            ].filter((block) => Array.isArray(block.compest_competencias) && block.compest_competencias.length > 0);

            const metasPorSeccion = secciones.map((sec, index) => {
                const tituloSeccion = buildSectionTitle(row.grade, sec);
                const sectionKey = normalizeText(sec);
                const totalEstudiantes = Number(enrollmentBySection[sectionKey] || 0);

                const competenciasSeccion = Array.from(new Set([
                    ...metasMap
                        .filter((item) => normalizeText(item.seccion) === sectionKey)
                        .map((item) => String(item.competencia || '').trim()),
                    ...diagnosticoRows
                        .filter((item) => normalizeText(item.seccion) === sectionKey)
                        .map((item) => String(item.competencia || '').trim()),
                    ...lineaBaseRows
                        .filter((item) => normalizeText(item.seccion) === sectionKey)
                        .map((item) => String(item.competencia || '').trim())
                ].filter(Boolean)));

                const metasCompetencias = competenciasSeccion.map((competencia) => {
                    const competenciaKey = normalizeText(competencia);
                    const metaManual = metasCrudas.find((item) =>
                        normalizeText(item?.seccion) === sectionKey &&
                        normalizeText(item?.competencia) === competenciaKey &&
                        String(item?.tipo || '').trim().toUpperCase() === 'META'
                    ) || {};

                    const diagManual = metasCrudas.find((item) =>
                        normalizeText(item?.seccion) === sectionKey &&
                        normalizeText(item?.competencia) === competenciaKey &&
                        String(item?.tipo || '').trim().toUpperCase() === 'DIAGNOSTICO'
                    ) || {};

                    const lbManual = metasCrudas.find((item) =>
                        normalizeText(item?.seccion) === sectionKey &&
                        normalizeText(item?.competencia) === competenciaKey &&
                        String(item?.tipo || '').trim().toUpperCase() === 'LINEA_BASE'
                    ) || {};

                    const niveles = [
                        { code: 'AD', label: 'Destacado' },
                        { code: 'A', label: 'Esperado' },
                        { code: 'B', label: 'En proceso' },
                        { code: 'C', label: 'En inicio' },
                        { code: 'NE', label: 'No Evaluados' }
                    ].map((level) => {
                        const lbAuto = lineaBaseRows.find((item) =>
                            normalizeText(item.seccion) === sectionKey &&
                            normalizeText(item.competencia) === competenciaKey &&
                            normalizeText(item.nivel_logro) === level.code
                        );
                        const dgAuto = diagnosticoRows.find((item) =>
                            normalizeText(item.seccion) === sectionKey &&
                            normalizeText(item.competencia) === competenciaKey &&
                            normalizeText(item.nivel_logro) === level.code
                        );

                        const lbCantidad = Number(lbAuto?.cantidad || getCountByLevel(lbManual, level.code));
                        const dgCantidad = Number(dgAuto?.cantidad || getCountByLevel(diagManual, level.code));
                        const mtCantidad = Number(getCountByLevel(metaManual, level.code));

                        return {
                            nivel_logro: level.label,
                            nivel_codigo: level.code,
                            lb_cantidad: lbCantidad,
                            lb_porcentaje: formatPercent(lbCantidad, [ 'AD', 'A', 'B', 'C', 'NE' ].reduce((acc, lvl) => acc + Number(
                                lineaBaseRows.find((item) =>
                                    normalizeText(item.seccion) === sectionKey &&
                                    normalizeText(item.competencia) === competenciaKey &&
                                    normalizeText(item.nivel_logro) === lvl
                                )?.cantidad || getCountByLevel(lbManual, lvl)
                            ), 0)),
                            dg_cantidad: dgCantidad,
                            dg_porcentaje: formatPercent(dgCantidad, totalEstudiantes),
                            mt_cantidad: mtCantidad,
                            mt_porcentaje: formatPercent(mtCantidad, totalEstudiantes)
                        };
                    });

                    const metaTotalLb = niveles.reduce((acc, item) => acc + Number(item.lb_cantidad || 0), 0);
                    const metaTotalDiag = niveles.reduce((acc, item) => acc + Number(item.dg_cantidad || 0), 0);
                    const metaTotalMeta = niveles.reduce((acc, item) => acc + Number(item.mt_cantidad || 0), 0);

                    return {
                        meta_competencia: competencia,
                        meta_competencia_seccion: sec,
                        meta_competencia_titulo: competencia,
                        meta_current_year: currentYear,
                        meta_prev_year: prevYear,
                        meta_total_estudiantes: totalEstudiantes,
                        meta_total_lb: metaTotalLb,
                        meta_total_diag: metaTotalDiag,
                        meta_total_meta: metaTotalMeta,
                        meta_total_lb_display: `${metaTotalLb}/${metaTotalLb}`,
                        meta_total_diag_display: `${metaTotalDiag}/${totalEstudiantes}`,
                        meta_total_meta_display: `${metaTotalMeta}/${totalEstudiantes}`,
                        meta_total_lb_percent: formatPercent(metaTotalLb, metaTotalLb),
                        meta_total_diag_percent: formatPercent(metaTotalDiag, totalEstudiantes),
                        meta_total_meta_percent: formatPercent(metaTotalMeta, totalEstudiantes),
                        lb_ad: niveles.find((item) => item.nivel_codigo === 'AD')?.lb_cantidad || 0,
                        lb_ad_percent: niveles.find((item) => item.nivel_codigo === 'AD')?.lb_porcentaje || '0%',
                        lb_a: niveles.find((item) => item.nivel_codigo === 'A')?.lb_cantidad || 0,
                        lb_a_percent: niveles.find((item) => item.nivel_codigo === 'A')?.lb_porcentaje || '0%',
                        lb_b: niveles.find((item) => item.nivel_codigo === 'B')?.lb_cantidad || 0,
                        lb_b_percent: niveles.find((item) => item.nivel_codigo === 'B')?.lb_porcentaje || '0%',
                        lb_c: niveles.find((item) => item.nivel_codigo === 'C')?.lb_cantidad || 0,
                        lb_c_percent: niveles.find((item) => item.nivel_codigo === 'C')?.lb_porcentaje || '0%',
                        lb_ne: niveles.find((item) => item.nivel_codigo === 'NE')?.lb_cantidad || 0,
                        lb_ne_percent: niveles.find((item) => item.nivel_codigo === 'NE')?.lb_porcentaje || '0%',
                        dg_ad: niveles.find((item) => item.nivel_codigo === 'AD')?.dg_cantidad || 0,
                        dg_ad_percent: niveles.find((item) => item.nivel_codigo === 'AD')?.dg_porcentaje || '0%',
                        dg_a: niveles.find((item) => item.nivel_codigo === 'A')?.dg_cantidad || 0,
                        dg_a_percent: niveles.find((item) => item.nivel_codigo === 'A')?.dg_porcentaje || '0%',
                        dg_b: niveles.find((item) => item.nivel_codigo === 'B')?.dg_cantidad || 0,
                        dg_b_percent: niveles.find((item) => item.nivel_codigo === 'B')?.dg_porcentaje || '0%',
                        dg_c: niveles.find((item) => item.nivel_codigo === 'C')?.dg_cantidad || 0,
                        dg_c_percent: niveles.find((item) => item.nivel_codigo === 'C')?.dg_porcentaje || '0%',
                        dg_ne: niveles.find((item) => item.nivel_codigo === 'NE')?.dg_cantidad || 0,
                        dg_ne_percent: niveles.find((item) => item.nivel_codigo === 'NE')?.dg_porcentaje || '0%',
                        mt_ad: niveles.find((item) => item.nivel_codigo === 'AD')?.mt_cantidad || 0,
                        mt_ad_percent: niveles.find((item) => item.nivel_codigo === 'AD')?.mt_porcentaje || '0%',
                        mt_a: niveles.find((item) => item.nivel_codigo === 'A')?.mt_cantidad || 0,
                        mt_a_percent: niveles.find((item) => item.nivel_codigo === 'A')?.mt_porcentaje || '0%',
                        mt_b: niveles.find((item) => item.nivel_codigo === 'B')?.mt_cantidad || 0,
                        mt_b_percent: niveles.find((item) => item.nivel_codigo === 'B')?.mt_porcentaje || '0%',
                        mt_c: niveles.find((item) => item.nivel_codigo === 'C')?.mt_cantidad || 0,
                        mt_c_percent: niveles.find((item) => item.nivel_codigo === 'C')?.mt_porcentaje || '0%',
                        mt_ne: niveles.find((item) => item.nivel_codigo === 'NE')?.mt_cantidad || 0,
                        mt_ne_percent: niveles.find((item) => item.nivel_codigo === 'NE')?.mt_porcentaje || '0%',
                        meta_niveles: niveles
                    };
                });

                return {
                    meta_seccion_orden: index + 1,
                    meta_seccion_indice: `5.${index + 1}.`,
                    meta_seccion_grado: row.grade || '',
                    meta_seccion_seccion: sec,
                    meta_seccion_titulo: tituloSeccion,
                    meta_seccion_subtitulo: `5.${index + 1}. ${tituloSeccion}`,
                    metas_competencias: metasCompetencias
                };
            });

            const diagnosticoPorSeccion = secciones.map((sec, index) => {
                const tituloSeccion = buildSectionTitle(row.grade, sec);
                const sectionKey = normalizeText(sec);
                const competenciasDiagnostico = Array.from(new Set(
                    diagnosticoDetalleRows
                        .filter((item) => normalizeText(item.seccion) === sectionKey)
                        .map((item) => String(item.competencia || '').trim())
                        .filter(Boolean)
                ));

                return {
                    diagnostico_seccion_orden: index + 1,
                    diagnostico_seccion_indice: `6.${index + 1}.`,
                    diagnostico_seccion_grado: row.grade || '',
                    diagnostico_seccion_seccion: sec,
                    diagnostico_seccion_titulo: tituloSeccion,
                    diagnostico_seccion_subtitulo: `6.${index + 1}. ${tituloSeccion}`,
                    diagnostico_competencias: competenciasDiagnostico.map((competencia) => {
                        const competenciaKey = normalizeText(competencia);
                        const estudiantes = diagnosticoDetalleRows
                            .filter((item) =>
                                normalizeText(item.seccion) === sectionKey &&
                                normalizeText(item.competencia) === competenciaKey
                            )
                            .map((item, studentIndex) => ({
                                diagnostico_estudiante_numero: studentIndex + 1,
                                diagnostico_estudiante_numero_2d: String(studentIndex + 1).padStart(2, '0'),
                                diagnostico_estudiante_nombre: String(item.estudiante_nombre || '').trim(),
                                diagnostico_estudiante_nl: String(item.nivel_logro || '').trim(),
                                diagnostico_estudiante_conclusion: String(item.conclusion_descriptiva || '').trim()
                            }));

                        return {
                            diagnostico_competencia: competencia,
                            diagnostico_competencia_titulo: competencia,
                            diagnostico_estudiantes: estudiantes
                        };
                    })
                };
            });

            const templatePath = getProgramacionTemplatePath();
            if (!fs.existsSync(templatePath)) throw new Error("Plantilla no encontrada.");

            const imageModule = new ImageModule({
                centered: true,
                getImage(tagValue) {
                    if (!tagValue) return null;
                    const base64 = tagValue.startsWith('data:') ? tagValue.replace(/^data:image\/\w+;base64,/, '') : tagValue;
                    return Buffer.from(base64, 'base64');
                },
                getSize() { return [85, 85]; }
            });

            const content = fs.readFileSync(templatePath);
            const zip = new PizZip(content);
            const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: '<<', end: '>>' }, modules: [imageModule] });

            doc.setData({
                ...DATOS_GENERALES,
                area_curricular: row.area_curricular,
                area_curricular_mayus: (row.area_curricular || '').toUpperCase(),
                grado: row.grade, grade: row.grade, seccion: row.section, section: row.section,
                current_year: currentYear,
                prev_year: prevYear,
                nro_pa: row.nro_pa || '01',
                area_standards: row.area_standards || '',
                area_purpose: row.area_purpose || '',
                area_enfoque: row.area_enfoque || '',
                caracterizacion_context: row.caracterizacion_context || '',
                caracterizacion_adolecente: row.caracterizacion_adolecente || '',
                alumnos: row.alumnos || '', ciclo: row.ciclo || '', horas_sem: row.horas_sem || '',
                ...RECURSOS,
                titulo_u1: row.titulo_u1 || '', titulo_u2: row.titulo_u2 || '', titulo_u3: row.titulo_u3 || '', titulo_u4: row.titulo_u4 || '',
                titulo_u5: row.titulo_u5 || '', titulo_u6: row.titulo_u6 || '', titulo_u7: row.titulo_u7 || '', titulo_u8: row.titulo_u8 || '',
                st_cont_u1: row.st_cont_u1 || '', st_cont_u2: row.st_cont_u2 || '', st_cont_u3: row.st_cont_u3 || '', st_cont_u4: row.st_cont_u4 || '',
                st_cont_u5: row.st_cont_u5 || '', st_cont_u6: row.st_cont_u6 || '', st_cont_u7: row.st_cont_u7 || '', st_cont_u8: row.st_cont_u8 || '',
                i_bim_i: row.inicio_bim_i, i_bim_ii: row.inicio_bim_ii, i_bim_iii: row.inicio_bim_iii, i_bim_iv: row.inicio_bim_iv,
                f_bim_i: row.fin_bim_i, f_bim_ii: row.fin_bim_ii, f_bim_iii: row.fin_bim_iii, f_bim_iv: row.fin_bim_iv,
                competencias: filas, enfoques: filasEnfoques, ...vinculacionPlano, ejes_tematicos: filasEjes, ...calendario,
                metas: metasMap,
                metas_por_seccion: metasPorSeccion,
                metas_secciones: metasPorSeccion,
                diagnostico_por_seccion: diagnosticoPorSeccion,
                competencias_estandares_bloques: competenciasEstandaresBloques
            });

            try {
                doc.render();
            } catch (e) {
                console.error('❌ ERROR DOCXTEMPLATER:', e);
                throw e;
            }
            
            const fileName = `PA - ${sanitizeFileLabel(row.area_curricular, 'Area')} - ${sanitizeFileLabel(row.grade, 'Grado')} ${sanitizeFileLabel(row.section, 'Seccion')}.docx`;
            const finalPath = path.join(outputPath, fileName);
            const tempPath = finalPath + '.tmp';
            const buffer = doc.getZip().generate({ type: 'nodebuffer' });
            fs.writeFileSync(tempPath, buffer);
            fs.renameSync(tempPath, finalPath);
            generationProgress.current++; 
            generationProgress.lastFile = fileName;
            generationProgress.generatedCount++;
        }

        if (generationProgress.generatedCount === 0) throw new Error("La exportación terminó sin generar archivos.");
        if (process.platform === 'win32') {
            const bringFrontScript = [
                `$path = '${outputPath.replace(/'/g, "''")}'`,
                `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class WinApi { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); }'`,
                'Start-Process explorer.exe $path | Out-Null',
                '$shell = New-Object -ComObject Shell.Application',
                '$target = (Resolve-Path $path).Path',
                '$targetNormalized = ($target -replace "[\\\\/]+$", "")',
                '$matchedWindow = $null',
                'for ($i = 0; $i -lt 20 -and -not $matchedWindow; $i++) {',
                '  Start-Sleep -Milliseconds 250',
                '  foreach ($window in $shell.Windows()) {',
                '    try {',
                '      $docPath = $window.Document.Folder.Self.Path',
                '      $docPathNormalized = ($docPath -replace "[\\\\/]+$", "")',
                '      if ($docPath -and $docPathNormalized -ieq $targetNormalized) {',
                '        $matchedWindow = $window',
                '        break',
                '      }',
                '    } catch { }',
                '  }',
                '}',
                'if ($matchedWindow) {',
                '  $hwnd = [IntPtr]::new([int64]$matchedWindow.HWND)',
                '  [WinApi]::ShowWindowAsync($hwnd, 9) | Out-Null',
                '  Start-Sleep -Milliseconds 100',
                '  [WinApi]::SetForegroundWindow($hwnd) | Out-Null',
                '}'
            ].join('; ');
            execFile('powershell.exe', ['-NoProfile', '-Command', bringFrontScript], { windowsHide: true }, () => {});
        } else {
            const command = process.platform === 'darwin' ? `open "${outputPath}"` : `xdg-open "${outputPath}"`;
            exec(command);
        }
        generationProgress.active = false;
    } catch (e) { generationProgress.error = e.message; generationProgress.active = false; }
});

router.post('/programacion-word/open-folder', (req, res) => {
    const { customPath } = req.body; const outputPath = customPath || tempRoot;
    const command = process.platform === 'win32' ? `explorer "${outputPath}"` : process.platform === 'darwin' ? `open "${outputPath}"` : `xdg-open "${outputPath}"`;
    exec(command); res.json({ success: true });
});

router.get('/programacion-word/pick-folder', (req, res) => {
    if (process.platform !== 'win32') {
        return res.status(400).json({ success: false, message: 'Selector nativo de carpeta disponible solo en Windows.' });
    }

    const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        '$owner = New-Object System.Windows.Forms.Form',
        "$owner.Text = 'ARMI_FolderOwner'",
        '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
        '$owner.Size = New-Object System.Drawing.Size(1, 1)',
        '$owner.ShowInTaskbar = $false',
        '$owner.TopMost = $true',
        '$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None',
        '$owner.Opacity = 0.01',
        '$owner.Show()',
        '$owner.Activate()',
        '$owner.BringToFront()',
        '[System.Windows.Forms.Application]::DoEvents()',
        '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
        "$dialog.Description = 'Seleccione la carpeta de exportacion'",
        '$dialog.ShowNewFolderButton = $true',
        '$result = $dialog.ShowDialog($owner)',
        '$owner.Close()',
        '$owner.Dispose()',
        'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
        '  Write-Output $dialog.SelectedPath',
        '}'
    ].join('; ');

    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ success: false, message: stderr?.trim() || error.message || 'No se pudo abrir el selector de carpetas.' });
        }

        const selectedPath = String(stdout || '').trim();
        if (!selectedPath) {
            return res.json({ success: false, cancelled: true, message: 'Selección cancelada.' });
        }

        return res.json({ success: true, path: selectedPath });
    });
});

router.get('/programacion-word/template-fields', (req, res) => {
    try {
        const fields = extractTemplateFields();
        const sessionMarkers = extractRouteTemplateKeys();
        res.json({ success: true, delimiters: { start: '<<', end: '>>' }, fields, sessionMarkers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message, fields: [], sessionMarkers: [] });
    }
});

export default router;
