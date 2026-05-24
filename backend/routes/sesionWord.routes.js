import express from 'express';
import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';
import { exec, execFile } from 'child_process';
import db from '../db.js';
import { resolveTemplatePath, tempRoot } from '../paths.js';
import { sanitizeDocxDrawingIds } from './wordDocxUtils.js';

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

const getSessionTemplatePath = () => resolveTemplatePath('sesion_aprendizaje.docx');

const TRANSVERSAL_NAMES = [
    'Se desenvuelve en los entornos virtuales generados por las TIC',
    'Gestiona su aprendizaje de manera autónoma'
];

const ENFOQUE_DETAILS = {
    'Enfoque de derechos': {
        valores: 'Conciencia de derechos, Libertad y responsabilidad, Diálogo y concertación',
        acciones: 'Disposición a conocer, comprender y valorar los derechos individuales y colectivos.\nDisposición a elegir de manera voluntaria y responsable la propia forma de actuar dentro de una sociedad.',
        demuestra: 'Los docentes promueven el conocimiento de los Derechos Humanos y la Convención sobre los Derechos del Niño para empoderar a los estudiantes en su ejercicio democrático.'
    },
    'Enfoque Inclusivo o de Atención a la diversidad': {
        valores: 'Respeto por las diferencias, Equidad en la enseñanza, Confianza en la persona',
        acciones: 'Reconocimiento al valor inherente de cada persona y de sus derechos, por encima de cualquier diferencia.\nDisposición a enseñar ofreciendo a los estudiantes las condiciones y oportunidades que cada uno necesita.',
        demuestra: 'Docentes y estudiantes demuestran altas expectativas sobre todos los estudiantes, sin distinguir habilidades o procedencia.'
    },
    'Enfoque Intercultural': {
        valores: 'Respeto a la identidad cultural, Justicia, Diálogo intercultural',
        acciones: 'Reconocimiento al valor de las diversas identidades culturales y relaciones de pertenencia de los estudiantes.\nDisposición a actuar de manera justa, respetando el derecho de todos.',
        demuestra: 'Los docentes y estudiantes acogen con respeto a todos, sin menospreciar ni excluir a nadie en razón de su lengua, su manera de hablar, su forma de vestir, sus costumbres o sus creencias.'
    },
    'Enfoque Igualdad de Género': {
        valores: 'Igualdad y Dignidad, Justicia, Empatía',
        acciones: 'Reconocimiento al valor inherente de cada persona, más allá de su género.\nDisposición a actuar de modo que se dé a cada quien lo que le corresponde, en especial a quienes se ven perjudicados por la desigualdad de género.',
        demuestra: 'Docentes y estudiantes no hacen distinciones discriminatorias entre varones y mujeres.'
    },
    'Enfoque ambiental': {
        valores: 'Solidaridad planetaria y equidad intergeneracional, Justicia y solidaridad, Respeto a toda forma de vida',
        acciones: 'Disposición para colaborar con el bienestar y la calidad de vida de las generaciones presentes y futuras.\nDisposición a evaluar los impactos y costos ambientales de las acciones cotidianas.',
        demuestra: 'Docentes y estudiantes promueven la preservación de entornos saludables, a favor del cuidado del medio ambiente.'
    },
    'Enfoque orientación al bien común': {
        valores: 'Equidad y justicia, Solidaridad, Empatía, Responsabilidad',
        acciones: 'Disposición a reconocer que ante situaciones de inicio diferentes, se requieren compensaciones.\nDisposición a apoyar incondicionalmente a personas en situaciones comprometidas o difíciles.',
        demuestra: 'Los estudiantes comparten siempre los bienes disponibles para ellos en los espacios educativos con sentido de equidad y justicia.'
    },
    'Enfoque búsqueda de la Excelencia': {
        valores: 'Flexibilidad y apertura, Superación personal',
        acciones: 'Disposición para adaptarse a los cambios, modificando si fuera necesario la propia conducta.\nDisposición a adquirir cualidades que mejorarán el propio desempeño.',
        demuestra: 'Docentes y estudiantes comparan, adquieren y emplean estrategias útiles para aumentar la eficacia de sus esfuerzos en el logro de los objetivos que se proponen.'
    }
};

const MINUTE_DISTRIBUTIONS = {
    45: [3, 2, 12, 22, 6],
    90: [5, 5, 30, 40, 10]
};

const sanitizeFileLabel = (value, fallback = 'archivo') => String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeText = (value) => String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const normalizeLooseText = (value) => normalizeText(value).replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const toProperName = (value) => {
    const stopWords = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
    return String(value || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map((word, index) => {
            if (!word) return '';
            if (index > 0 && stopWords.has(word)) return word;
            return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ');
};

const getUnitBimester = (unitNumber) => {
    const unit = Number(unitNumber);
    if (unit <= 2) return 'I';
    if (unit <= 4) return 'II';
    if (unit <= 6) return 'III';
    return 'IV';
};

const formatGenerationDateLong = (date = new Date()) => {
    const day = String(date.getDate());
    const month = date.toLocaleDateString('es-ES', { month: 'long' }).toUpperCase();
    const year = String(date.getFullYear());
    return `${day} DE ${month} DE ${year}`;
};

const formatDateSlash = (value) => {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const [y, m, d] = text.split('-');
        return `${d}/${m}/${y}`;
    }
    return text;
};

const normalizeParagraphText = (value) => String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/â€¢/g, '\n')
    .replace(/[•●◆■▪◦]/g, '\n')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .join('\n');

const extractRichTextItems = (value) => decodeHtmlEntities(
    String(value || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<li[^>]*>/gi, '\n• ')
        .replace(/<[^>]*>/g, ' ')
)
    .split(/\r?\n|•|;+/)
    .map((part) => String(part || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

const mergeUniqueMultilineText = (...values) => {
    const seen = new Set();
    const lines = [];
    values.forEach((value) => {
        String(value || '')
            .split(/\r?\n/)
            .map((line) => String(line || '').trim())
            .filter(Boolean)
            .forEach((line) => {
                const key = normalizeLooseText(line);
                if (!key || seen.has(key)) return;
                seen.add(key);
                lines.push(line);
            });
    });
    return lines.join('\n');
};

const buildSessionResourceDefaults = (sessionData = {}, annualDefaults = {}) => {
    const resources = { rec: [], med: [], mat: [], soft: [], esp: [] };
    const seen = {
        rec: new Set(),
        med: new Set(),
        mat: new Set(),
        soft: new Set(),
        esp: new Set()
    };

    const pushTo = (bucket, value) => {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) return;
        const key = normalizeLooseText(text);
        if (!key || seen[bucket].has(key)) return;
        seen[bucket].add(key);
        resources[bucket].push(text);
    };

    extractRichTextItems(annualDefaults.recursos || '').forEach((item) => pushTo('rec', item));
    extractRichTextItems(annualDefaults.medios || '').forEach((item) => pushTo('med', item));
    extractRichTextItems(annualDefaults.materiales || '').forEach((item) => pushTo('mat', item));
    extractRichTextItems([annualDefaults.apps, annualDefaults.softwares, annualDefaults.plataformas].filter(Boolean).join('\n'))
        .forEach((item) => pushTo('soft', item));
    extractRichTextItems(annualDefaults.espacios || '').forEach((item) => pushTo('esp', item));

    const phaseResourceValues = [
        sessionData?.secuencia?.inicio?.saberes_recursos,
        sessionData?.secuencia?.inicio?.conflicto_recursos,
        sessionData?.secuencia?.proceso?.construccion_recursos,
        sessionData?.secuencia?.proceso?.aplicacion_recursos,
        sessionData?.secuencia?.proceso?.metacognicion_recursos,
        sessionData?.secuencia?.salida?.evaluacion_recursos
    ];

    const classifyDynamicItem = (item) => {
        const text = String(item || '').replace(/\s+/g, ' ').trim();
        const norm = normalizeLooseText(text);
        if (!norm) return;

        if (/^(software|app|web)\s*\/\s*/i.test(text)) return pushTo('soft', text);
        if (/^ANEXO N \d+$/i.test(norm)) return pushTo('rec', text);
        if (/^INSTRUCTIVO N \d+$/i.test(norm)) return pushTo('mat', text);

        if (
            norm.includes('RUBRICA')
            || norm.includes('LISTA DE COTEJO')
            || norm.includes('GUIA DE OBSERVACION')
            || norm.includes('ESCALA DE ESTIMACION')
            || norm.includes('FICHA DE AUTOEVALUACION')
            || norm.includes('FICHA DE COEVALUACION')
            || norm.includes('FICHA INFORMATIVA')
            || norm.includes('CUESTIONARIO')
            || norm.includes('EXAMEN')
            || norm.includes('PORTAFOLIO DE EVIDENCIAS')
            || norm.includes('REGISTRO ANECDOTICO')
            || norm.includes('DIARIO DE CLASE')
            || norm.includes('PRUEBA DE DESEMPENO')
            || norm.includes('PRUEBA DE EJECUCION')
        ) {
            return pushTo('mat', text);
        }
    };

    phaseResourceValues.forEach((value) => {
        extractRichTextItems(value || '').forEach(classifyDynamicItem);
    });

    return {
        rec: resources.rec.join('\n'),
        med: resources.med.join('\n'),
        mat: resources.mat.join('\n'),
        soft: resources.soft.join('\n'),
        esp: resources.esp.join('\n')
    };
};

const formatLabeledBlock = (pairs) => (Array.isArray(pairs) ? pairs : [])
    .map(({ label, value }) => {
        const clean = normalizeParagraphText(value);
        return clean ? `${label}:\n${clean}` : '';
    })
    .filter(Boolean)
    .join('\n\n');

const formatSessionCreationDate = (row) => {
    const updated = String(row?.updated_at || '').trim();
    if (!updated) return '';
    const isoMatch = updated.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
    return updated;
};

const decodeHtmlEntities = (value) => String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

const htmlToPlainText = (value) => decodeHtmlEntities(String(value || ''))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<li[^>]*>/gi, 'o ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/(ul|ol|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const parseDurationLabel = (value, fallbackHoursSem = '') => {
    const text = String(value || '').trim();
    const minuteMatch = text.match(/(\d+)\s*min/i);
    if (minuteMatch) {
        const minutes = Number(minuteMatch[1]);
        return { text, minutes };
    }
    const hourMatch = text.match(/(\d+)\s*h/i);
    if (hourMatch) {
        const hours = Number(hourMatch[1]);
        return { text, minutes: hours * 45 };
    }
    const sem = Number(String(fallbackHoursSem || '').replace(/[^\d.]/g, ''));
    if (Number.isFinite(sem) && sem > 0) {
        const minutes = sem >= 2 ? 90 : 45;
        return { text: sem >= 2 ? '2h (90 min)' : '1h (45 min)', minutes };
    }
    return { text: '', minutes: 90 };
};

const getSequenceTimes = (durationText, fallbackHoursSem = '') => {
    const { text, minutes } = parseDurationLabel(durationText, fallbackHoursSem);
    const distribution = MINUTE_DISTRIBUTIONS[minutes] || MINUTE_DISTRIBUTIONS[90];
    return {
        duracion_sesion: text || (minutes === 45 ? '1h (45 min)' : '2h (90 min)'),
        tiempo_saberes_previos: `${distribution[0]} min`,
        tiempo_conflicto_cognitivo: `${distribution[1]} min`,
        tiempo_construccion_conocimiento: `${distribution[2]} min`,
        tiempo_aplicacion_aprendido: `${distribution[3]} min`,
        tiempo_evaluacion: `${distribution[4]} min`,
        tiempos_secuencia: distribution.map((item) => `${item} min`)
    };
};

const getStandardForCompetence = (rows, grade, competence) => {
    const normalizedGrade = normalizeLooseText(grade || '');
    const normalizedCompetence = normalizeLooseText(competence || '');
    if (!normalizedCompetence) return '';

    const match = (Array.isArray(rows) ? rows : []).find((item) => {
        const rowGrade = normalizeLooseText(item?.grado || '');
        const rowCompetence = normalizeLooseText(item?.competencias || '');
        const sameGrade = !normalizedGrade || rowGrade === normalizedGrade || rowGrade.includes(normalizedGrade) || normalizedGrade.includes(rowGrade);
        return sameGrade && rowCompetence === normalizedCompetence;
    });
    return String(match?.estandar || '').trim();
};

const extractApproachFromMatrix = (matrixChecks, unitNumber) => {
    const key = Object.keys(ENFOQUE_DETAILS).find((name) => {
        const matrixKey = `enfoque-${name.toLowerCase().replace(/[^a-z0-9]/gi, '')}-${Math.max(0, Number(unitNumber || 1) - 1)}`;
        return !!matrixChecks?.[matrixKey];
    });
    if (!key) return { enfoque: '', valor: '', acciones: '', demuestra: '' };
    const details = ENFOQUE_DETAILS[key] || {};
    return {
        enfoque: key,
        valor: String(details.valores || '').trim(),
        acciones: String(details.acciones || '').trim(),
        demuestra: String(details.demuestra || '').trim()
    };
};

const extractApproachForSession = (sessionApproach, matrixChecks, unitNumber) => {
    const sessionValue = sessionApproach && typeof sessionApproach === 'object' ? {
        enfoque: String(sessionApproach.enfoque || '').trim(),
        valor: String(sessionApproach.valor || '').trim(),
        acciones: String(sessionApproach.acciones || '').trim(),
        demuestra: String(sessionApproach.demuestra || '').trim()
    } : null;

    if (sessionValue && (sessionValue.enfoque || sessionValue.valor || sessionValue.acciones || sessionValue.demuestra)) {
        return sessionValue;
    }

    return extractApproachFromMatrix(matrixChecks, unitNumber);
};

const extractRegionalAxes = (matrixChecks, unitNumber) => {
    const unitIndex = Math.max(0, Number(unitNumber || 1) - 1);
    return Object.entries(matrixChecks || {})
        .filter(([key, value]) => typeof value === 'boolean' && !!value && key.startsWith('ejeReg-'))
        .map(([key]) => {
            const parts = key.split('-');
            const unit = Number(parts.pop());
            const nombre = parts.slice(1).join('-').replace(/-/g, ' ').trim();
            return { unit, nombre };
        })
        .filter((item) => item.unit === unitIndex && item.nombre)
        .map((item) => ({
            eje_tematico_regional: item.nombre,
            eje_integrador_regional: item.nombre
        }));
};

const getSessionTemplateFields = () => ([
    'ie',
    'institution',
    'ugel',
    'lugar',
    'district',
    'distrito',
    'province',
    'provincia',
    'lema',
    'motto',
    'bimestre',
    'unidad',
    'sesion_numero',
    'sesiones_total_unidad',
    'nombre_del_ano',
    'titulo_sesion',
    '%insignia',
    '%logo',
    'area_curricular',
    'grado',
    'seccion',
    'ciclo',
    'estudiantes',
    'fecha_sesion',
    'duracion_sesion',
    'docente',
    'coord_ped',
    'sub_director',
    'director',
    'proposito_sesion',
    'actividades_extension',
    'extension',
    'bloque_actividades_extension',
    'seccion_actividades_extension',
    'competencia_priorizada',
    'estandar_competencia_priorizada',
    'capacidad_priorizada',
    'desempeno_priorizado',
    'evidencia_priorizada',
    'instrumento_priorizado',
    'competencia_transversal_1',
    'estandar_competencia_transversal_1',
    'capacidad_transversal_1',
    'desempeno_transversal_1',
    'evidencia_transversal_1',
    'instrumento_transversal_1',
    'competencia_transversal_2',
    'estandar_competencia_transversal_2',
    'capacidad_transversal_2',
    'desempeno_transversal_2',
    'evidencia_transversal_2',
    'instrumento_transversal_2',
    'enfoque_transversal',
    'enfoque',
    'valor_enfoque_transversal',
    'valor',
    'acciones_enfoque_transversal',
    'acciones',
    'se_demuestra_cuando_enfoque',
    'demuestra',
    '#ejes_tematicos_regionales',
    'eje_tematico_regional',
    'eje_integrador_regional',
    '/ejes_tematicos_regionales',
    'saberes_previos_estrategias',
    'saberes_previos_recursos',
    'saberes_previos_tiempo',
    'conflicto_cognitivo_estrategias',
    'conflicto_cognitivo_recursos',
    'conflicto_cognitivo_tiempo',
    'construccion_conocimiento_estrategias',
    'construccion_conocimiento_recursos',
    'construccion_conocimiento_tiempo',
    'aplicacion_aprendido_estrategias',
    'aplicacion_aprendido_recursos',
    'aplicacion_aprendido_tiempo',
    'metacognicion_estrategias',
    'metacognicion_recursos',
    'metacognicion_tiempo',
    'evaluacion_estrategias',
    'evaluacion_recursos',
    'evaluacion_tiempo',
    'recursos_utilizar',
    'medios_utilizar',
    'materiales_utilizar',
    'apps_o_softwares',
    'espacios_aprendizaje',
    'bloque_recursos_medios_materiales_apps_softwares_espacios_aprendizaje',
    'seccion_recursos_medios_materiales',
    'bibliografia',
    'referencias_bibliograficas',
    'linkografia',
    'bloque_bibliografia_linkografia',
    'seccion_bibliografia_linkografia',
    'fecha_creacion_sesion'
]);

const formatTemplateError = (error) => {
    const message = String(error?.message || error || '').trim();
    const code = String(error?.code || '').trim().toUpperCase();
    const props = error?.properties || {};
    const explanations = Array.isArray(props.errors)
        ? props.errors
            .map((item) => String(item?.properties?.explanation || item?.message || item?.properties?.id || '').trim())
            .filter(Boolean)
        : [];
    const fullText = [message, ...explanations].join(' | ');

    if ((code === 'EPERM' || code === 'EACCES') && /rename/i.test(message) && /\.docx(?:\.tmp)?/i.test(message)) {
        const targetMatch = message.match(/->\s*'([^']+\.docx)'/i);
        const targetPath = targetMatch?.[1] || '';
        const fileName = path.basename(targetPath || '').trim();
        return fileName
            ? `No se pudo reemplazar el archivo Word porque está abierto o bloqueado por otro programa. Cierre "${fileName}" y vuelva a intentarlo.`
            : 'No se pudo reemplazar el archivo Word porque está abierto o bloqueado por otro programa. Cierre el documento y vuelva a intentarlo.';
    }

    const brokenStartRegex = /beginning with ['"]([^'"]+)['"]/i;
    const brokenStartMatch = fullText.match(brokenStartRegex);
    if (brokenStartMatch?.[1]) {
        const fragment = brokenStartMatch[1].trim();
        return `La plantilla Word tiene un marcador mal formado o sin cerrar. Fragmento detectado: ${fragment}.`;
    }

    const markerRegex = /(?:tag|placeholder)\s+["']?([^"'|.]+)["']?/ig;
    const markers = new Set();
    let markerMatch;
    while ((markerMatch = markerRegex.exec(fullText)) !== null) {
        const marker = String(markerMatch[1] || '').trim();
        if (marker && !/^beginning with$/i.test(marker)) markers.add(marker);
    }

    if (markers.size > 0) {
        const list = Array.from(markers).slice(0, 4).map((item) => `<<${item}>>`).join(', ');
        return markers.size > 1
            ? `La plantilla tiene varios marcadores invalidos o inexistentes: ${list}.`
            : `Marcador de plantilla invalido o inexistente: ${list}.`;
    }

    if (/unclosed|closing tag does not match|duplicate open tag|duplicate close tag/i.test(fullText)) {
        return 'La plantilla Word tiene marcadores mal cerrados o mal anidados. Revise las etiquetas <<...>>.';
    }
    if (/multi error/i.test(message) && explanations.length > 0) {
        return `La plantilla Word tiene varios errores: ${explanations.slice(0, 3).join(' | ')}.`;
    }
    return message || 'Error desconocido al generar el documento Word.';
};

router.get('/sesion-word/status', (req, res) => {
    res.json(generationProgress);
});

router.post('/sesion-word/generate', async (req, res) => {
    const { ids, customPath, anchorPath } = req.body || {};
    const normalizedIds = Array.isArray(ids) ? ids.map((id) => String(id || '').trim()).filter(Boolean) : [];
    if (normalizedIds.length === 0) {
        return res.status(400).json({ success: false, message: 'No se seleccionaron sesiones.' });
    }

    const outputPath = customPath || tempRoot;
    fs.mkdirSync(outputPath, { recursive: true });

    if (anchorPath) {
        try {
            db.prepare('UPDATE datos_generales SET path_word_default = ? WHERE id = (SELECT id FROM datos_generales LIMIT 1)').run(outputPath);
        } catch {}
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
    res.json({ success: true, message: 'Generación de sesiones iniciada.' });

    try {
        const placeholders = normalizedIds.map(() => '?').join(',');
        const rows = db.prepare(`
            SELECT
                s.*,
                s.session_data,
                u.title AS unit_title,
                u.sesiones AS unit_sessions,
                pa.area_curricular AS area_name,
                pa.alumnos AS program_alumnos,
                pa.ciclo AS program_ciclo,
                pa.horas_sem AS program_horas_sem,
                pa.coord_ped AS program_coord_ped,
                pa.matrix_checks AS program_matrix_checks,
                pr.medios AS program_rec_medios,
                pr.materiales AS program_rec_materiales,
                pr.recursos AS program_rec_recursos,
                pr.espacios AS program_rec_espacios,
                pr.apps AS program_rec_apps,
                pr.softwares AS program_rec_softwares,
                pr.plataformas AS program_rec_plataformas,
                pr.referencias AS program_rec_referencias,
                pr.linkografia AS program_rec_linkografia
            FROM sesiones s
            LEFT JOIN unidades_didacticas u
                ON u.year = s.year
                AND u.area_id = s.area_id
                AND u.grade = s.grade
                AND u.section = s.section
                AND u.unit_number = s.unit_number
            LEFT JOIN programacion_anual pa
                ON pa.area_id = s.area_id
                AND pa.grade = s.grade
                AND pa.section = s.section
            LEFT JOIN programacion_recursos pr
                ON pr.id_programa = pa.id_programa
            WHERE s.id_sesion IN (${placeholders})
        `).all(...normalizedIds);

        const foundIds = new Set(rows.map((row) => String(row.id_sesion)));
        generationProgress.missingIds = normalizedIds.filter((id) => !foundIds.has(id));
        if (rows.length === 0) throw new Error('No se encontraron sesiones válidas para exportar.');

        const dg = db.prepare('SELECT * FROM datos_generales LIMIT 1').get() || {};
        const estandaresDbRows = db.prepare('SELECT * FROM db_estandares').all();
        const templatePath = getSessionTemplatePath();
        if (!fs.existsSync(templatePath)) throw new Error('Plantilla de sesión no encontrada.');

        for (const row of rows) {
            const sessionData = JSON.parse(row.session_data || '{}');
            const unitSessions = JSON.parse(row.unit_sessions || '[]');
            const totalSesionesUnidad = Array.isArray(unitSessions) ? unitSessions.length : 0;
            const areaName = String(row.area_name || '').trim();
            const matrixChecks = JSON.parse(row.program_matrix_checks || '{}');
            const enfoque = extractApproachForSession(sessionData?.enfoqueTrans, matrixChecks, row.unit_number);
            const ejesTematicos = extractRegionalAxes(matrixChecks, row.unit_number);
            const seq = sessionData?.secuencia || {};
            const recursosSesion = sessionData?.recursos || {};
            const bibliografiaSesion = sessionData?.bibliografia || {};
            const annualResourceDefaults = {
                recursos: row.program_rec_recursos || '',
                medios: row.program_rec_medios || '',
                materiales: row.program_rec_materiales || '',
                apps: row.program_rec_apps || '',
                softwares: row.program_rec_softwares || '',
                plataformas: row.program_rec_plataformas || '',
                espacios: row.program_rec_espacios || ''
            };
            const generatedResourceDefaults = buildSessionResourceDefaults(sessionData, annualResourceDefaults);
            const durationInfo = getSequenceTimes(String(sessionData?.duracion || ''), row.program_horas_sem || '');
            const transRows = Array.isArray(sessionData?.competenciasTrans) ? sessionData.competenciasTrans : [];
            const trans1 = transRows[0] || {};
            const trans2 = transRows[1] || {};
            const extensionText = htmlToPlainText(sessionData?.extension || '');
            const recursosText = normalizeParagraphText(mergeUniqueMultilineText(recursosSesion?.rec, generatedResourceDefaults.rec));
            const mediosText = normalizeParagraphText(mergeUniqueMultilineText(recursosSesion?.med, generatedResourceDefaults.med));
            const materialesText = normalizeParagraphText(mergeUniqueMultilineText(recursosSesion?.mat, generatedResourceDefaults.mat));
            const softwareText = normalizeParagraphText(mergeUniqueMultilineText(recursosSesion?.soft, generatedResourceDefaults.soft));
            const espaciosText = normalizeParagraphText(mergeUniqueMultilineText(recursosSesion?.esp, generatedResourceDefaults.esp));
            const bibliografiaText = normalizeParagraphText(bibliografiaSesion?.bib || row.program_rec_referencias || '');
            const linkografiaText = normalizeParagraphText(bibliografiaSesion?.link || row.program_rec_linkografia || '');
            const bloqueRecursos = formatLabeledBlock([
                { label: 'RECURSOS', value: recursosText },
                { label: 'MEDIOS', value: mediosText },
                { label: 'MATERIALES', value: materialesText },
                { label: 'APS O SOFTWARES', value: softwareText },
                { label: 'ESPACIOS DE APRENDIZAJE', value: espaciosText }
            ]);
            const bloqueBibliografia = formatLabeledBlock([
                { label: 'BIBLIOGRAFIA', value: bibliografiaText },
                { label: 'LINKOGRAFIA', value: linkografiaText }
            ]);

            const doc = new Docxtemplater(new PizZip(fs.readFileSync(templatePath)), {
                paragraphLoop: true,
                linebreaks: true,
                delimiters: { start: '<<', end: '>>' },
                modules: [new ImageModule({
                    centered: true,
                    getImage(tagValue) {
                        if (!tagValue) return null;
                        const base64 = String(tagValue).startsWith('data:')
                            ? String(tagValue).replace(/^data:image\/\w+;base64,/, '')
                            : String(tagValue);
                        return Buffer.from(base64, 'base64');
                    },
                    getSize() { return [85, 85]; }
                })]
            });

            doc.setData({
                ie: dg.institution || '',
                institution: dg.institution || '',
                ugel: dg.ugel || '',
                lugar: dg.lugar || '',
                district: toProperName(dg.district || ''),
                distrito: toProperName(dg.district || ''),
                province: toProperName(dg.province || ''),
                provincia: toProperName(dg.province || ''),
                lema: dg.motto || '',
                motto: dg.motto || '',
                insignia: dg.insignia || '',
                logo: dg.logo || '',
                bimestre: getUnitBimester(row.unit_number),
                unidad: row.unit_number || '',
                sesion_numero: row.session_number || '',
                session_number: row.session_number || '',
                sesiones_total_unidad: totalSesionesUnidad,
                nombre_del_ano: dg.year_name || '',
                year_name: dg.year_name || '',
                titulo_sesion: sessionData?.title || '',
                title: sessionData?.title || '',
                area_curricular: areaName,
                area: areaName,
                grado: row.grade || '',
                grade: row.grade || '',
                seccion: row.section || '',
                section: row.section || '',
                ciclo: row.program_ciclo || '',
                estudiantes: row.program_alumnos || '',
                alumnos: row.program_alumnos || '',
                fecha_sesion: formatDateSlash(sessionData?.date || ''),
                duracion_sesion: durationInfo.duracion_sesion,
                docente: dg.teacher || '',
                teacher: dg.teacher || '',
                coord_ped: row.program_coord_ped || '',
                coordinador_pedagogico: row.program_coord_ped || '',
                sub_director: dg.subdirector || '',
                director: dg.director || '',
                proposito_sesion: htmlToPlainText(sessionData?.purpose || ''),
                purpose: htmlToPlainText(sessionData?.purpose || ''),
                actividades_extension: extensionText,
                extension: extensionText,
                bloque_actividades_extension: extensionText,
                seccion_actividades_extension: extensionText,
                competencia_priorizada: sessionData?.competenciaPrio?.comp || '',
                estandar_competencia_priorizada: getStandardForCompetence(estandaresDbRows, row.grade, sessionData?.competenciaPrio?.comp || ''),
                capacidad_priorizada: sessionData?.competenciaPrio?.cap || '',
                desempeno_priorizado: htmlToPlainText(sessionData?.competenciaPrio?.des || ''),
                evidencia_priorizada: htmlToPlainText(sessionData?.competenciaPrio?.evidence || ''),
                instrumento_priorizado: sessionData?.competenciaPrio?.inst || '',
                competencia_transversal_1: trans1?.comp || '',
                estandar_competencia_transversal_1: getStandardForCompetence(estandaresDbRows, row.grade, trans1?.comp || ''),
                capacidad_transversal_1: trans1?.cap || '',
                desempeno_transversal_1: htmlToPlainText(trans1?.des || ''),
                evidencia_transversal_1: htmlToPlainText(trans1?.evidence || ''),
                instrumento_transversal_1: trans1?.inst || '',
                competencia_transversal_2: trans2?.comp || '',
                estandar_competencia_transversal_2: getStandardForCompetence(estandaresDbRows, row.grade, trans2?.comp || ''),
                capacidad_transversal_2: trans2?.cap || '',
                desempeno_transversal_2: htmlToPlainText(trans2?.des || ''),
                evidencia_transversal_2: htmlToPlainText(trans2?.evidence || ''),
                instrumento_transversal_2: trans2?.inst || '',
                enfoque_transversal: enfoque.enfoque || '',
                enfoque: enfoque.enfoque || '',
                valor_enfoque_transversal: enfoque.valor || '',
                valor: enfoque.valor || '',
                acciones_enfoque_transversal: enfoque.acciones || '',
                acciones: enfoque.acciones || '',
                se_demuestra_cuando_enfoque: enfoque.demuestra || '',
                demuestra: enfoque.demuestra || '',
                ejes_tematicos_regionales: ejesTematicos,
                saberes_previos_estrategias: htmlToPlainText(seq?.inicio?.saberes || ''),
                saberes_previos_recursos: htmlToPlainText(seq?.inicio?.saberes_recursos || ''),
                saberes_previos_tiempo: durationInfo.tiempo_saberes_previos,
                conflicto_cognitivo_estrategias: htmlToPlainText(seq?.inicio?.conflicto || ''),
                conflicto_cognitivo_recursos: htmlToPlainText(seq?.inicio?.conflicto_recursos || ''),
                conflicto_cognitivo_tiempo: durationInfo.tiempo_conflicto_cognitivo,
                construccion_conocimiento_estrategias: htmlToPlainText(seq?.proceso?.construccion || ''),
                construccion_conocimiento_recursos: htmlToPlainText(seq?.proceso?.construccion_recursos || ''),
                construccion_conocimiento_tiempo: durationInfo.tiempo_construccion_conocimiento,
                aplicacion_aprendido_estrategias: htmlToPlainText(seq?.proceso?.aplicacion || ''),
                aplicacion_aprendido_recursos: htmlToPlainText(seq?.proceso?.aplicacion_recursos || ''),
                aplicacion_aprendido_tiempo: durationInfo.tiempo_aplicacion_aprendido,
                metacognicion_estrategias: htmlToPlainText(seq?.proceso?.metacognicion || ''),
                metacognicion_recursos: htmlToPlainText(seq?.proceso?.metacognicion_recursos || ''),
                metacognicion_tiempo: '5 min',
                evaluacion_estrategias: htmlToPlainText(seq?.salida?.evaluacion || ''),
                evaluacion_recursos: htmlToPlainText(seq?.salida?.evaluacion_recursos || ''),
                evaluacion_tiempo: durationInfo.tiempo_evaluacion,
                recursos_utilizar: recursosText,
                recursos: recursosText,
                medios_utilizar: mediosText,
                medios: mediosText,
                materiales_utilizar: materialesText,
                materiales: materialesText,
                apps_o_softwares: softwareText,
                apps_software: softwareText,
                espacios_aprendizaje: espaciosText,
                bloque_recursos_medios_materiales_apps_softwares_espacios_aprendizaje: bloqueRecursos,
                seccion_recursos_medios_materiales: bloqueRecursos,
                bibliografia: bibliografiaText,
                referencias_bibliograficas: bibliografiaText,
                linkografia: linkografiaText,
                bloque_bibliografia_linkografia: bloqueBibliografia,
                seccion_bibliografia_linkografia: bloqueBibliografia,
                fecha_creacion_sesion: formatSessionCreationDate(row),
                fecha_registro_sesion: formatSessionCreationDate(row),
                fecha_generacion_larga: formatGenerationDateLong(),
                generation_date_long: formatGenerationDateLong()
            });

            doc.render();

            const fileName = `SES ${sanitizeFileLabel(row.session_number, '1')} - ${sanitizeFileLabel(areaName, 'Area')} - ${sanitizeFileLabel(row.grade, 'Grado')} ${sanitizeFileLabel(row.section, 'Seccion')} - U${sanitizeFileLabel(row.unit_number, '1')}.docx`;
            const finalPath = path.join(outputPath, fileName);
            const tempPath = `${finalPath}.tmp`;
            sanitizeDocxDrawingIds(doc);
            const buffer = doc.getZip().generate({ type: 'nodebuffer' });
            fs.writeFileSync(tempPath, buffer);
            fs.renameSync(tempPath, finalPath);

            generationProgress.current++;
            generationProgress.lastFile = fileName;
            generationProgress.generatedCount++;
        }

        if (generationProgress.generatedCount === 0) throw new Error('La exportación de sesiones terminó sin generar archivos.');
        generationProgress.active = false;
    } catch (e) {
        generationProgress.error = formatTemplateError(e);
        generationProgress.active = false;
    }
});

router.post('/sesion-word/open-folder', (req, res) => {
    const { customPath } = req.body || {};
    const outputPath = customPath || tempRoot;
    const command = process.platform === 'win32'
        ? `explorer "${outputPath}"`
        : process.platform === 'darwin'
            ? `open "${outputPath}"`
            : `xdg-open "${outputPath}"`;
    exec(command);
    res.json({ success: true });
});

router.get('/sesion-word/pick-folder', (req, res) => {
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

router.get('/sesion-word/template-fields', (req, res) => {
    res.json({
        success: true,
        delimiters: { start: '<<', end: '>>' },
        fields: getSessionTemplateFields(),
        sessionMarkers: getSessionTemplateFields()
    });
});

export default router;
