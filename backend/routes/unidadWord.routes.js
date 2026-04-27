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

const getUnitTemplatePath = () => resolveTemplatePath('unidad_aprendizaje.docx');
const LEARNING_GOALS_TABLE_TOKEN = '__ARMI_TABLA_PROPOSITOS__';
const LEARNING_GOALS_TRANS1_TABLE_TOKEN = '__ARMI_TABLA_PROPOSITOS_TRANS1__';
const LEARNING_GOALS_TRANS2_TABLE_TOKEN = '__ARMI_TABLA_PROPOSITOS_TRANS2__';
const TRANSVERSAL_APPROACHES_TABLE_TOKEN = '__ARMI_TABLA_ENFOQUES__';
const LEARNING_SESSIONS_TABLE_TOKEN = '__ARMI_TABLA_SESIONES__';
const EDUCATIONAL_RESOURCES_TABLE_TOKEN = '__ARMI_TABLA_RECURSOS__';
const TRANSVERSAL_NAMES = [
    'Se desenvuelve en los entornos virtuales generados por las TIC',
    'Gestiona su aprendizaje de manera autónoma'
];
const ENFOQUES_LIST = [
    'Enfoque de derechos',
    'Enfoque Inclusivo o de Atención a la diversidad',
    'Enfoque Intercultural',
    'Enfoque Igualdad de Género',
    'Enfoque ambiental',
    'Enfoque orientación al bien común',
    'Enfoque búsqueda de la Excelencia'
];

const sanitizeFilePart = (value, fallback = 'archivo') => String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_');

const sanitizeFileLabel = (value, fallback = 'archivo') => String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeParagraphs = (text) => {
    if (!text || typeof text !== 'string') return [];
    return text
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.replace(/^[>\-•❖✓📚🌐]+\s*/u, '').trim())
        .filter(Boolean)
        .map((item) => ({ item }));
};

const objectEntriesList = (obj) => Object.entries(obj || {})
    .map(([key, value]) => ({ key, value: String(value || '').trim() }))
    .filter((entry) => entry.value);

const formatGenerationDateLong = (date = new Date()) => {
    const day = String(date.getDate());
    const month = date.toLocaleDateString('es-ES', { month: 'long' }).toUpperCase();
    const year = String(date.getFullYear());
    return `${day} DE ${month} DE ${year}`;
};

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

const normalizeText = (value) => String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const normalizeLooseText = (value) => normalizeText(value).replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const superNormalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9 Ã¡Ã©Ã­Ã³ÃºÃ±]/gi, '').trim();
const normalizeApproachName = (value) => normalizeLooseText(value).replace(/^ENFOQUE\s+/i, '').trim();

const escapeXml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const normalizeBrokenModelTokens = (xml, keys) => {
    let next = String(xml || '').replace(/<w:proofErr\b[^>]*\/>/g, '');
    (Array.isArray(keys) ? keys : []).forEach((key) => {
        const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const brokenPattern = new RegExp(
            `<w:t[^>]*>\\[\\[<\\/w:t>[\\s\\S]*?<w:t[^>]*>${escapedKey}<\\/w:t>[\\s\\S]*?<w:t[^>]*>\\]\\]<\\/w:t>`,
            'g'
        );
        next = next.replace(brokenPattern, `<w:r><w:t>[[${key}]]</w:t></w:r>`);

        const tokenChars = `[[${key}]]`.split('').map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const tagGap = '(?:<\\/w:t>[\\s\\S]*?<w:t[^>]*>)*';
        const fragmentedTokenPattern = new RegExp(tokenChars.join(tagGap), 'g');
        next = next.replace(fragmentedTokenPattern, `[[${key}]]`);
    });
    return next;
};

const replaceModelTokens = (xml, replacements) => {
    let next = normalizeBrokenModelTokens(String(xml || ''), Object.keys(replacements || {}));
    Object.entries(replacements || {}).forEach(([key, value]) => {
        const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`\\[\\[\\s*${escapedKey}\\s*\\]\\]`, 'g');
        next = next.replace(pattern, escapeXml(value));
    });
    return next;
};

const withVerticalMergeAtCell = (rowXml, cellIndex, mode) => {
    const cells = String(rowXml || '').match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [];
    if (!cells[cellIndex]) return rowXml;

    const targetCell = cells[cellIndex];
    const mergeTag = mode === 'restart' ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>';
    let updatedCell = targetCell;

    if (/<w:tcPr\b[\s\S]*?<\/w:tcPr>/.test(updatedCell)) {
        updatedCell = updatedCell.replace(/<w:tcPr\b([\s\S]*?)>/, (match) => {
            if (/w:vMerge/.test(targetCell)) return match;
            return `${match}${mergeTag}`;
        });
    } else {
        updatedCell = updatedCell.replace(/<w:tc\b([^>]*)>/, `<w:tc$1><w:tcPr>${mergeTag}</w:tcPr>`);
    }

    if (mode === 'continue') {
        updatedCell = updatedCell
            .replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, '')
            .replace(/<w:r\b[\s\S]*?<\/w:r>/g, '');
        if (!/<w:p\b/.test(updatedCell)) {
            updatedCell = updatedCell.replace('</w:tc>', '<w:p/></w:tc>');
        } else {
            updatedCell = updatedCell.replace(/<w:p\b[\s\S]*?<\/w:p>/, '<w:p/>');
        }
    }

    return String(rowXml).replace(targetCell, updatedCell);
};

const withCellBodyAtIndex = (rowXml, cellIndex, bodyXml) => {
    const cells = String(rowXml || '').match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [];
    if (!cells[cellIndex]) return rowXml;

    const targetCell = cells[cellIndex];
    const tcStartMatch = targetCell.match(/^<w:tc\b[^>]*>/);
    const tcPrMatch = targetCell.match(/<w:tcPr\b[\s\S]*?<\/w:tcPr>/);
    if (!tcStartMatch) return rowXml;

    const nextCell = `${tcStartMatch[0]}${tcPrMatch ? tcPrMatch[0] : ''}${bodyXml}</w:tc>`;
    return String(rowXml).replace(targetCell, nextCell);
};

const cssColorToWordHex = (value) => {
    const text = String(value || '').trim();
    if (!text) return null;
    const hexMatch = text.match(/#([0-9a-fA-F]{6})/);
    if (hexMatch?.[1]) return hexMatch[1].toUpperCase();
    if (/text-black/i.test(text)) return '000000';
    if (/text-slate-700/i.test(text)) return '334155';
    if (/text-slate-600/i.test(text)) return '475569';
    if (/text-blue-800/i.test(text)) return '1E40AF';
    return null;
};

const extractCellTemplateStyle = (rowXml, cellIndex) => {
    const cells = String(rowXml || '').match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [];
    const cell = cells[cellIndex] || '';
    const pPrMatch = cell.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/);
    const rPrMatch = cell.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/);
    return {
        pPrXml: pPrMatch ? pPrMatch[0] : '',
        rPrXml: rPrMatch ? rPrMatch[0] : ''
    };
};

const mergeWordProps = (baseXml, extraTags) => {
    const extras = Array.isArray(extraTags) ? extraTags.filter(Boolean) : [];
    if (!baseXml && extras.length === 0) return '';
    if (!baseXml) return `<w:rPr>${extras.join('')}</w:rPr>`;
    return baseXml.replace(/<\/w:rPr>$/, `${extras.join('')}</w:rPr>`);
};

const mergeParagraphProps = (baseXml, extraTags) => {
    const extras = Array.isArray(extraTags) ? extraTags.filter(Boolean) : [];
    if (!baseXml && extras.length === 0) return '';
    if (!baseXml) return `<w:pPr>${extras.join('')}</w:pPr>`;
    return baseXml.replace(/<\/w:pPr>$/, `${extras.join('')}</w:pPr>`);
};

const buildWordParagraph = ({
    text = '',
    color = null,
    bold = false,
    italic = false,
    align = null,
    uppercase = false,
    basePPrXml = '',
    baseRPrXml = ''
}) => {
    const content = String(text || '').trim();
    if (!content) return '<w:p/>';

    const paragraphProps = align ? [`<w:jc w:val="${align}"/>`] : [];
    const runProps = [];
    if (bold) runProps.push('<w:b/>');
    if (italic) runProps.push('<w:i/>');
    if (color) runProps.push(`<w:color w:val="${color}"/>`);
    if (uppercase) runProps.push('<w:caps/>');

    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const segments = lines.map((line, index) => {
        const escaped = escapeXml(line);
        const preserve = /^\s|\s$/.test(line) ? ' xml:space="preserve"' : '';
        const breakTag = index > 0 ? '<w:br/>' : '';
        return `${breakTag}<w:t${preserve}>${escaped}</w:t>`;
    }).join('');

    const pPrXml = mergeParagraphProps(basePPrXml, paragraphProps);
    const rPrXml = mergeWordProps(baseRPrXml, runProps);
    return `<w:p>${pPrXml}${`<w:r>${rPrXml}${segments}</w:r>`}</w:p>`;
};

const buildWordParagraphsFromItems = (items, options = {}) => {
    const list = Array.isArray(items) ? items : [];
    const paragraphs = [];
    list.forEach((item) => {
        const rawText = typeof item === 'string' ? item : (item?.text ?? item?.item ?? '');
        const color = cssColorToWordHex(typeof item === 'string' ? '' : item?.color);
        const parts = String(rawText || '').replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
        parts.forEach((part) => {
            paragraphs.push(buildWordParagraph({ ...options, text: part, color: color || options.color || null }));
        });
    });
    return paragraphs.length ? paragraphs.join('') : '<w:p/>';
};

const renderLearningGoalsTableModel = (documentXml, groups) => {
    if (!String(documentXml || '').includes(LEARNING_GOALS_TABLE_TOKEN)) return documentXml;

    const tables = String(documentXml || '').match(/<w:tbl\b[\s\S]*?<\/w:tbl>/g) || [];
    const targetTable = tables.find((table) => table.includes(LEARNING_GOALS_TABLE_TOKEN));
    if (!targetTable) return documentXml;

    const rows = targetTable.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
    if (rows.length < 5) {
        throw new Error('La tabla modelo de propósitos de aprendizaje debe tener al menos 5 filas.');
    }

    const tblPrMatch = targetTable.match(/<w:tblPr\b[\s\S]*?<\/w:tblPr>/);
    const tblGridMatch = targetTable.match(/<w:tblGrid\b[\s\S]*?<\/w:tblGrid>/);
    const tblPr = tblPrMatch ? tblPrMatch[0] : '<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>';
    const tblGrid = tblGridMatch ? tblGridMatch[0] : '';

    const competenciaRow = rows[1];
    const estandarRow = rows[2];
    const headerRow = rows[3];
    const detailRow = rows[4];

    const renderedRows = [];

    (Array.isArray(groups) ? groups : []).forEach((group) => {
        renderedRows.push(replaceModelTokens(competenciaRow, { competencia: group.competencia || '' }));
        renderedRows.push(replaceModelTokens(estandarRow, { estandar: group.estandar || '' }));
        renderedRows.push(headerRow.replace(LEARNING_GOALS_TABLE_TOKEN, ''));

        const groupRows = Array.isArray(group.filas) ? group.filas : [];
        let previousCapacity = null;
        let previousInstrument = null;
        groupRows.forEach((item) => {
            let renderedDetailRow = replaceModelTokens(detailRow, {
                capacidad: item.capacidad || '',
                desempeno: item.desempeno || '',
                criterio: item.criterio || '',
                evidencia: item.evidencia || '',
                instrumento: item.instrumento || ''
            });

            const currentCapacity = String(item.capacidad || '').trim();
            const currentInstrument = String(item.instrumento || '').trim();
            const capacityMergeMode = currentCapacity && currentCapacity === previousCapacity ? 'continue' : 'restart';
            const instrumentMergeMode = currentInstrument && currentInstrument === previousInstrument && currentCapacity === previousCapacity
                ? 'continue'
                : 'restart';
            renderedDetailRow = withVerticalMergeAtCell(renderedDetailRow, 0, capacityMergeMode);
            renderedDetailRow = withVerticalMergeAtCell(renderedDetailRow, 4, instrumentMergeMode);
            previousCapacity = currentCapacity || null;
            previousInstrument = currentInstrument || null;
            renderedRows.push(renderedDetailRow);
        });
    });

    const finalTable = `<w:tbl>${tblPr}${tblGrid}${renderedRows.join('')}</w:tbl>`;
    return String(documentXml).replace(targetTable, finalTable);
};

const renderLearningGoalsTableModelWithConfig = (documentXml, groups, config) => {
    const token = config?.token;
    if (!token || !String(documentXml || '').includes(token)) return documentXml;

    const tables = String(documentXml || '').match(/<w:tbl\b[\s\S]*?<\/w:tbl>/g) || [];
    const targetTable = tables.find((table) => table.includes(token));
    if (!targetTable) return documentXml;

    const rows = targetTable.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
    if (rows.length < 5) {
        throw new Error(`La tabla modelo ${config?.label || token} debe tener al menos 5 filas.`);
    }

    const tblPrMatch = targetTable.match(/<w:tblPr\b[\s\S]*?<\/w:tblPr>/);
    const tblGridMatch = targetTable.match(/<w:tblGrid\b[\s\S]*?<\/w:tblGrid>/);
    const tblPr = tblPrMatch ? tblPrMatch[0] : '<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>';
    const tblGrid = tblGridMatch ? tblGridMatch[0] : '';

    const competenciaRow = rows[1];
    const estandarRow = rows[2];
    const headerRow = rows[3];
    const detailRow = rows[4];
    const renderedRows = [];

    (Array.isArray(groups) ? groups : []).forEach((group) => {
        renderedRows.push(replaceModelTokens(competenciaRow, { [config.competenciaKey]: group.competencia || '' }));
        renderedRows.push(replaceModelTokens(estandarRow, { [config.estandarKey]: group.estandar || '' }));
        renderedRows.push(headerRow.replace(token, ''));

        const groupRows = Array.isArray(group.filas) ? group.filas : [];
        let previousCapacity = null;
        let previousInstrument = null;

        groupRows.forEach((item) => {
            let renderedDetailRow = replaceModelTokens(detailRow, {
                [config.capacidadKey]: item.capacidad || '',
                [config.desempenoKey]: item.desempeno || '',
                [config.criterioKey]: item.criterio || '',
                [config.evidenciaKey]: item.evidencia || '',
                [config.instrumentoKey]: item.instrumento || ''
            });

            const currentCapacity = String(item.capacidad || '').trim();
            const currentInstrument = String(item.instrumento || '').trim();
            const capacityMergeMode = currentCapacity && currentCapacity === previousCapacity ? 'continue' : 'restart';
            const instrumentMergeMode = currentInstrument && currentInstrument === previousInstrument && currentCapacity === previousCapacity
                ? 'continue'
                : 'restart';

            renderedDetailRow = withVerticalMergeAtCell(renderedDetailRow, 0, capacityMergeMode);
            renderedDetailRow = withVerticalMergeAtCell(renderedDetailRow, 4, instrumentMergeMode);

            previousCapacity = currentCapacity || null;
            previousInstrument = currentInstrument || null;
            renderedRows.push(renderedDetailRow);
        });
    });

    const finalTable = `<w:tbl>${tblPr}${tblGrid}${renderedRows.join('')}</w:tbl>`;
    return String(documentXml).replace(targetTable, finalTable);
};

const renderTransversalApproachesTableModel = (documentXml, groups) => {
    if (!String(documentXml || '').includes(TRANSVERSAL_APPROACHES_TABLE_TOKEN)) return documentXml;

    const tables = String(documentXml || '').match(/<w:tbl\b[\s\S]*?<\/w:tbl>/g) || [];
    const targetTable = tables.find((table) => table.includes(TRANSVERSAL_APPROACHES_TABLE_TOKEN));
    if (!targetTable) return documentXml;

    const rows = targetTable.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
    if (rows.length < 3) {
        throw new Error('La tabla modelo de enfoques transversales debe tener al menos 3 filas.');
    }

    const tblPrMatch = targetTable.match(/<w:tblPr\b[\s\S]*?<\/w:tblPr>/);
    const tblGridMatch = targetTable.match(/<w:tblGrid\b[\s\S]*?<\/w:tblGrid>/);
    const tblPr = tblPrMatch ? tblPrMatch[0] : '<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>';
    const tblGrid = tblGridMatch ? tblGridMatch[0] : '';

    const headerRow = rows[1];
    const detailRow = rows[2];
    const renderedRows = [headerRow.replace(TRANSVERSAL_APPROACHES_TABLE_TOKEN, '')];

    (Array.isArray(groups) ? groups : []).forEach((group) => {
        const groupRows = Array.isArray(group.filas) ? group.filas : [];
        let previousApproach = null;
        let previousValue = null;
        let previousAttitude = null;

        groupRows.forEach((item) => {
            let renderedDetailRow = replaceModelTokens(detailRow, {
                enfoque: item.enfoque || '',
                valor: item.valor || '',
                actitud: item.actitud || '',
                demuestra: item.demuestra || ''
            });

            const currentApproach = String(item.enfoque || '').trim();
            const currentValue = String(item.valor || '').trim();
            const currentAttitude = String(item.actitud || '').trim();
            const mergeMode = currentApproach && currentApproach === previousApproach ? 'continue' : 'restart';
            const valueMergeMode = currentValue && currentValue === previousValue && currentApproach === previousApproach
                ? 'continue'
                : 'restart';
            const attitudeMergeMode = currentAttitude && currentAttitude === previousAttitude && currentApproach === previousApproach
                ? 'continue'
                : 'restart';
            renderedDetailRow = withVerticalMergeAtCell(renderedDetailRow, 0, mergeMode);
            renderedDetailRow = withVerticalMergeAtCell(renderedDetailRow, 1, valueMergeMode);
            renderedDetailRow = withVerticalMergeAtCell(renderedDetailRow, 2, attitudeMergeMode);
            previousApproach = currentApproach || null;
            previousValue = currentValue || null;
            previousAttitude = currentAttitude || null;
            renderedRows.push(renderedDetailRow);
        });
    });

    const finalTable = `<w:tbl>${tblPr}${tblGrid}${renderedRows.join('')}</w:tbl>`;
    return String(documentXml).replace(targetTable, finalTable);
};

const renderLearningSessionsTableModel = (documentXml, sessions) => {
    if (!String(documentXml || '').includes(LEARNING_SESSIONS_TABLE_TOKEN)) return documentXml;

    const tables = String(documentXml || '').match(/<w:tbl\b[\s\S]*?<\/w:tbl>/g) || [];
    const targetTable = tables.find((table) => table.includes(LEARNING_SESSIONS_TABLE_TOKEN));
    if (!targetTable) return documentXml;

    const rows = targetTable.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
    if (rows.length < 3) {
        throw new Error('La tabla modelo de sesiones de aprendizaje debe tener al menos 3 filas.');
    }

    const tblPrMatch = targetTable.match(/<w:tblPr\b[\s\S]*?<\/w:tblPr>/);
    const tblGridMatch = targetTable.match(/<w:tblGrid\b[\s\S]*?<\/w:tblGrid>/);
    const tblPr = tblPrMatch ? tblPrMatch[0] : '<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>';
    const tblGrid = tblGridMatch ? tblGridMatch[0] : '';

    const headerRow = rows[1];
    const detailRow = rows[2];
    const renderedRows = [headerRow.replace(LEARNING_SESSIONS_TABLE_TOKEN, '')];
    const cellStyles = Array.from({ length: 8 }, (_, idx) => extractCellTemplateStyle(detailRow, idx));

    (Array.isArray(sessions) ? sessions : []).forEach((item, index) => {
        let renderedRow = replaceModelTokens(detailRow, {
            sesion_numero: item.sesion_numero || index + 1,
            numero: item.numero || index + 1,
            sesion_rotulo: item.sesion_rotulo || `Sesión ${item.numero || index + 1}`,
            titulo_sesion: item.titulo_sesion || item.titulo || '',
            titulo: item.titulo || '',
            competencia_sesion: item.competencia_sesion || item.competencia || '',
            competencia: item.competencia || '',
            capacidad_sesion: item.capacidad_sesion || item.cap || '',
            cap: item.cap || '',
            desempeno_sesion: item.desempeno_sesion || item.des || '',
            des: item.des || '',
            conocimiento_sesion: item.conocimiento_sesion || item.con || '',
            con: item.con || '',
            evidencia_sesion: item.evidencia_sesion || item.evi || '',
            evi: item.evi || '',
            evaluacion_sesion: item.evaluacion_sesion || item.eval || '',
            eval: item.eval || ''
        });

        const capacidadesItems = (Array.isArray(item.capacidades_detalle) ? item.capacidades_detalle : item.capacidades || [])
            .map((entry) => {
                if (typeof entry === 'string') return { text: entry, color: null };
                return { text: entry?.text || '', color: entry?.color || null };
            });

        const criteriosItems = Array.isArray(item.criteriaItems) && item.criteriaItems.length > 0
            ? item.criteriaItems
            : String(item.desempeno_sesion || item.des || '')
                .replace(/\r\n/g, '\n')
                .split('\n')
                .map((text) => ({ text, color: 'text-black' }));

        const evidenciasItems = Array.isArray(item.evidenceItems) && item.evidenceItems.length > 0
            ? item.evidenceItems
            : String(item.evidencia_sesion || item.evi || '')
                .replace(/\r\n/g, '\n')
                .split('\n')
                .map((text) => ({ text, color: 'text-black' }));

        const styledNumberCellParagraphs = [
            buildWordParagraph({ text: item.sesion_rotulo || `Sesión ${item.numero || index + 1}`, bold: true, align: 'center', uppercase: true, basePPrXml: cellStyles[0]?.pPrXml, baseRPrXml: cellStyles[0]?.rPrXml }),
            buildWordParagraph({ text: item.semana_rotulo || `(Semana ${item.semana || Math.ceil((Number(item.numero || index + 1)) / 2)})`, bold: true, italic: true, align: 'center', color: 'C2410C', basePPrXml: cellStyles[0]?.pPrXml, baseRPrXml: cellStyles[0]?.rPrXml }),
            ...((Array.isArray(item.fechas_por_seccion) ? item.fechas_por_seccion : [])
                .map((entry) => {
                    if (typeof entry === 'string') return String(entry).trim();
                    const seccion = String(entry?.seccion || '').trim();
                    const fecha = String(entry?.fecha || '').trim();
                    return seccion && fecha ? `${seccion} (${fecha})` : seccion || fecha;
                })
                .filter(Boolean)
                .map((text) => buildWordParagraph({ text, bold: true, align: 'center', color: '334155', basePPrXml: cellStyles[0]?.pPrXml, baseRPrXml: cellStyles[0]?.rPrXml })))
        ].join('');

        renderedRow = withCellBodyAtIndex(renderedRow, 0, styledNumberCellParagraphs || '<w:p/>');
        renderedRow = withCellBodyAtIndex(renderedRow, 1, buildWordParagraph({ text: item.titulo_sesion || item.titulo || '', bold: true, italic: true, align: 'center', basePPrXml: cellStyles[1]?.pPrXml, baseRPrXml: cellStyles[1]?.rPrXml }));
        renderedRow = withCellBodyAtIndex(renderedRow, 2, buildWordParagraph({ text: item.competencia_sesion || item.competencia || '', bold: true, italic: true, basePPrXml: cellStyles[2]?.pPrXml, baseRPrXml: cellStyles[2]?.rPrXml }));
        renderedRow = withCellBodyAtIndex(renderedRow, 3, buildWordParagraphsFromItems(capacidadesItems, { bold: true, italic: true, basePPrXml: cellStyles[3]?.pPrXml, baseRPrXml: cellStyles[3]?.rPrXml }));
        renderedRow = withCellBodyAtIndex(renderedRow, 4, buildWordParagraphsFromItems(criteriosItems, { italic: true, basePPrXml: cellStyles[4]?.pPrXml, baseRPrXml: cellStyles[4]?.rPrXml }));
        renderedRow = withCellBodyAtIndex(renderedRow, 5, buildWordParagraph({ text: item.conocimiento_sesion || item.con || '', italic: true, basePPrXml: cellStyles[5]?.pPrXml, baseRPrXml: cellStyles[5]?.rPrXml }));
        renderedRow = withCellBodyAtIndex(renderedRow, 6, buildWordParagraphsFromItems(evidenciasItems, { basePPrXml: cellStyles[6]?.pPrXml, baseRPrXml: cellStyles[6]?.rPrXml }));
        renderedRow = withCellBodyAtIndex(renderedRow, 7, buildWordParagraph({ text: item.evaluacion_sesion || item.eval || '', italic: true, align: 'center', basePPrXml: cellStyles[7]?.pPrXml, baseRPrXml: cellStyles[7]?.rPrXml }));

        renderedRows.push(renderedRow);
    });

    const finalTable = `<w:tbl>${tblPr}${tblGrid}${renderedRows.join('')}</w:tbl>`;
    return String(documentXml).replace(targetTable, finalTable);
};

const renderEducationalResourcesTableModel = (documentXml, resourcesData) => {
    if (!String(documentXml || '').includes(EDUCATIONAL_RESOURCES_TABLE_TOKEN)) return documentXml;

    const tables = String(documentXml || '').match(/<w:tbl\b[\s\S]*?<\/w:tbl>/g) || [];
    const targetTable = tables.find((table) => table.includes(EDUCATIONAL_RESOURCES_TABLE_TOKEN));
    if (!targetTable) return documentXml;

    const rows = targetTable.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
    if (rows.length < 3) {
        throw new Error('La tabla modelo de materiales y recursos educativos debe tener al menos 3 filas.');
    }

    const tblPrMatch = targetTable.match(/<w:tblPr\b[\s\S]*?<\/w:tblPr>/);
    const tblGridMatch = targetTable.match(/<w:tblGrid\b[\s\S]*?<\/w:tblGrid>/);
    const tblPr = tblPrMatch ? tblPrMatch[0] : '<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>';
    const tblGrid = tblGridMatch ? tblGridMatch[0] : '';

    const headerRow = rows[1];
    const detailRow = rows[2];
    const detailCells = detailRow.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [];
    const contentCellIndexes = detailCells.length >= 8 ? [1, 3, 5, 7] : [0, 1, 2, 3];
    const cellStyles = contentCellIndexes.map((idx) => extractCellTemplateStyle(detailRow, idx));
    let renderedRow = replaceModelTokens(detailRow, {
        materiales_educativos: '',
        medios_educativos: '',
        recursos_educativos: '',
        espacios_aprendizaje: ''
    });

    renderedRow = withCellBodyAtIndex(renderedRow, contentCellIndexes[0], buildWordParagraphsFromItems(resourcesData?.materiales || [], {
        basePPrXml: cellStyles[0]?.pPrXml,
        baseRPrXml: cellStyles[0]?.rPrXml,
        italic: true,
        bold: true
    }));
    renderedRow = withCellBodyAtIndex(renderedRow, contentCellIndexes[1], buildWordParagraphsFromItems(resourcesData?.medios || [], {
        basePPrXml: cellStyles[1]?.pPrXml,
        baseRPrXml: cellStyles[1]?.rPrXml,
        italic: true,
        bold: true
    }));
    renderedRow = withCellBodyAtIndex(renderedRow, contentCellIndexes[2], buildWordParagraphsFromItems(resourcesData?.recursos || [], {
        basePPrXml: cellStyles[2]?.pPrXml,
        baseRPrXml: cellStyles[2]?.rPrXml,
        italic: true,
        bold: true
    }));
    renderedRow = withCellBodyAtIndex(renderedRow, contentCellIndexes[3], buildWordParagraphsFromItems(resourcesData?.espacios || [], {
        basePPrXml: cellStyles[3]?.pPrXml,
        baseRPrXml: cellStyles[3]?.rPrXml,
        italic: true,
        bold: true
    }));

    const finalTable = `<w:tbl>${tblPr}${tblGrid}${headerRow.replace(EDUCATIONAL_RESOURCES_TABLE_TOKEN, '')}${renderedRow}</w:tbl>`;
    return String(documentXml).replace(targetTable, finalTable);
};

const formatDateSlash = (value) => {
    if (!value) return '';
    const [year, month, day] = String(value).split('-');
    if (!year || !month || !day) return '';
    return `${day}/${month}/${year}`;
};

const formatDateTimeSlash = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!match) return raw;
    const [, year, month, day, hour = '', minute = ''] = match;
    return hour && minute ? `${day}/${month}/${year} ${hour}:${minute}` : `${day}/${month}/${year}`;
};

const getUnitCreationDate = (row) => {
    const id = String(row?.id_unidad || '').trim();
    const parts = id.split('-');
    const timestampCandidate = Number(parts[1] || '');
    if (Number.isFinite(timestampCandidate) && timestampCandidate > 0) {
        const date = new Date(timestampCandidate);
        if (!Number.isNaN(date.getTime())) {
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = String(date.getFullYear());
            return `${day}/${month}/${year}`;
        }
    }
    return formatDateTimeSlash(row?.updated_at || '');
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
        return `La plantilla Word tiene marcadores mal cerrados o mal anidados. Revise las etiquetas <<...>>.`;
    }
    if (/multi error/i.test(message) && explanations.length > 0) {
        return `La plantilla Word tiene varios errores: ${explanations.slice(0, 3).join(' | ')}.`;
    }
    return message || 'Error desconocido al generar el documento Word.';
};

const extractTemplateFields = () => {
    const templatePath = getUnitTemplatePath();
    if (!fs.existsSync(templatePath)) throw new Error('Plantilla de unidad no encontrada.');

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
    const preferredSpanishMarkers = [
        'ie',
        'ugel',
        'motto',
        'lema',
        '%insignia',
        '%logo',
        'department',
        'province',
        'provincia',
        'district',
        'distrito',
        'lugar',
        'level',
        'docente',
        'coord_ped',
        'coordinador_pedagogico',
        'director',
        'sub_director',
        'year',
        'anio',
        'year_name',
        'nombre_del_ano',
        'area',
        'area_curricular',
        'grado',
        'seccion',
        'unidad',
        'bimestre',
        'titulo',
        'ciclo',
        'horas',
        'estudiantes',
        'inicio',
        'fin',
        'sesiones_total',
        'sesiones',
        'duracion',
        'fecha_creacion_unidad',
        'fecha_registro_unidad',
        'tabla_propositos_aprendizaje',
        'tabla_propositos_aprendizaje_trans1',
        'tabla_propositos_aprendizaje_trans2',
        'tabla_enfoques_transversales',
        'tabla_sesiones_aprendizaje',
        'tabla_recursos_educativos',
        'proposito',
        'producto',
        'situacion',
        'propositos_aprendizaje[].competencia',
        'propositos_aprendizaje[].estandar',
        'propositos_aprendizaje[].filas[].capacidad',
        'propositos_aprendizaje[].filas[].desempeno',
        'propositos_aprendizaje[].filas[].criterio',
        'propositos_aprendizaje[].filas[].evidencia',
        'propositos_aprendizaje[].filas[].instrumento',
        'competencia_trans1',
        'estandar_trans1',
        'capacidad_trans1',
        'desempeno_trans1',
        'criterio_trans1',
        'evidencia_trans1',
        'instrumento_trans1',
        'competencia_trans2',
        'estandar_trans2',
        'capacidad_trans2',
        'desempeno_trans2',
        'criterio_trans2',
        'evidencia_trans2',
        'instrumento_trans2',
        'enfoque',
        'valor',
        'actitud',
        'demuestra',
        'sesion_numero',
        'sesion_rotulo',
        'titulo_sesion',
        'competencia_sesion',
        'competencia',
        'capacidad_sesion',
        'desempeno_sesion',
        'conocimiento_sesion',
        'evidencia_sesion',
        'evaluacion_sesion',
        'materiales_educativos',
        'medios_educativos',
        'recursos_educativos',
        'espacios_aprendizaje',
        'referencias_bibliograficas',
        'linkografia',
        'evaluacion',
        'criterios[].key',
        'criterios[].value',
        'evidencias[].key',
        'evidencias[].value',
        'instrumentos[].key',
        'instrumentos[].value',
        'criterios_trans[].key',
        'criterios_trans[].value',
        'evidencias_trans[].key',
        'evidencias_trans[].value',
        'instrumentos_trans[].key',
        'instrumentos_trans[].value',
        'sesiones[].numero',
        'sesiones[].titulo',
        'sesiones[].cap',
        'sesiones[].des',
        'sesiones[].con',
        'sesiones[].evi',
        'sesiones[].eval',
        'sesiones[].competencia',
        'sesiones[].transversales',
        'sesiones[].capacidades',
        'sesiones[].fechas_por_seccion[].seccion',
        'sesiones[].fechas_por_seccion[].fecha',
        'recursos_materiales[].item',
        'recursos_medios[].item',
        'recursos_actividades[].item',
        'recursos_espacios[].item',
        'recursos_software[].item',
        'bibliografia_libros[].item',
        'bibliografia_links[].item'
    ];

    return Array.from(new Set(preferredSpanishMarkers));
};

router.get('/unidad-word/status', (req, res) => { res.json(generationProgress); });

router.post('/unidad-word/generate', async (req, res) => {
    const { ids, customPath, anchorPath } = req.body;
    const normalizedIds = Array.isArray(ids)
        ? ids.map((id) => String(id || '').trim()).filter(Boolean)
        : [];

    if (normalizedIds.length === 0) {
        return res.status(400).json({ success: false, message: 'No se seleccionaron unidades.' });
    }

    const outputPath = customPath ? path.resolve(customPath) : tempRoot;

    if (anchorPath) {
        try {
            db.prepare('UPDATE datos_generales SET path_word_default = ? WHERE id = (SELECT id FROM datos_generales LIMIT 1)').run(outputPath);
        } catch (e) {
            console.error('Error al anclar ruta de unidades:', e.message);
        }
    }

    if (!fs.existsSync(outputPath)) {
        try {
            fs.mkdirSync(outputPath, { recursive: true });
        } catch (e) {
            return res.status(500).json({ success: false, message: 'No se pudo acceder a la ruta.' });
        }
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
    res.json({ success: true, message: 'GeneraciÃ³n de unidades iniciada.' });

    try {
        const placeholders = normalizedIds.map(() => '?').join(',');
        const rows = db.prepare(`
            SELECT
                u.*,
                COALESCE(
                    pa.area_curricular,
                    a.area,
                    u.area_id
                ) AS area_name,
                pa.alumnos AS program_alumnos,
                pa.ciclo AS program_ciclo,
                pa.horas_sem AS program_horas_sem,
                pa.coord_ped AS program_coord_ped,
                pa.matrix_checks AS program_matrix_checks
            FROM unidades_didacticas u
            LEFT JOIN programacion_anual pa
                ON pa.area_id = u.area_id
                AND pa.grade = u.grade
                AND pa.section = u.section
            LEFT JOIN db_areas a
                ON a.id = u.area_id
            WHERE u.id_unidad IN (${placeholders})
        `).all(...normalizedIds);
        const foundIds = new Set(rows.map((row) => String(row.id_unidad)));
        generationProgress.missingIds = normalizedIds.filter((id) => !foundIds.has(id));
        if (rows.length === 0) throw new Error('No se encontraron unidades didÃ¡cticas vÃ¡lidas para exportar.');

        const dg = db.prepare('SELECT * FROM datos_generales LIMIT 1').get() || {};
        const competenciasDbRows = db.prepare('SELECT * FROM db_competencias').all();
        const estandaresDbRows = db.prepare('SELECT * FROM db_estandares').all();
        const enfoquesDbRows = db.prepare('SELECT * FROM db_enfoques').all();
        const templatePath = getUnitTemplatePath();
        if (!fs.existsSync(templatePath)) throw new Error('Plantilla de unidad no encontrada.');

        for (const row of rows) {
            const criterios = JSON.parse(row.criterios || '{}');
            const evidencias = JSON.parse(row.evidencias || '{}');
            const instrumentos = JSON.parse(row.instrumentos || '{}');
            const criteriosTrans = JSON.parse(row.criterios_trans || '{}');
            const evidenciasTrans = JSON.parse(row.evidencias_trans || '{}');
            const instrumentosTrans = JSON.parse(row.instrumentos_trans || '{}');
            const sesiones = JSON.parse(row.sesiones || '[]');
            const recursos = JSON.parse(row.recursos || '{}');
            const bibliografia = JSON.parse(row.bibliografia || '{}');

            const areaName = row.area_name || row.area_id || '';
            const unitNumber = String(row.unit_number || '');
            const unitStart = dg[`u${unitNumber}_start`] || '';
            const unitEnd = dg[`u${unitNumber}_end`] || '';
            const unitDuration = getMineduDuration(unitStart, unitEnd);
            const totalSesiones = Array.isArray(sesiones) ? sesiones.length : 0;
            const activeIndexes = Array.from(new Set([
                ...Object.keys(criterios || {}),
                ...Object.keys(evidencias || {}),
                ...Object.keys(instrumentos || {})
            ].filter((key) => {
                const criterio = String(criterios?.[key] || '').trim();
                const evidencia = String(evidencias?.[key] || '').trim();
                const instrumento = String(instrumentos?.[key] || '').trim();
                return criterio || evidencia || instrumento;
            }))).map((key) => Number(key)).filter((value) => Number.isInteger(value));

            const activeTransversalIndexes = Array.from(new Set([
                ...Object.keys(criteriosTrans || {}),
                ...Object.keys(evidenciasTrans || {}),
                ...Object.keys(instrumentosTrans || {})
            ].filter((key) => {
                const criterio = String(criteriosTrans?.[key] || '').trim();
                const evidencia = String(evidenciasTrans?.[key] || '').trim();
                const instrumento = String(instrumentosTrans?.[key] || '').trim();
                return criterio || evidencia || instrumento;
            }))).map((key) => Number(key)).filter((value) => Number.isInteger(value));

            const areaCompetenciasRows = competenciasDbRows
                .filter((item) =>
                    normalizeText(item?.grado || '').includes(normalizeText(row.grade || '')) &&
                    normalizeText(item?.area || '') === normalizeText(areaName || '')
                )
                .map((item, index) => ({ ...item, originalIdx: index }))
                .filter((item) => activeIndexes.includes(item.originalIdx));

            const areaEstandaresRows = estandaresDbRows.filter((item) =>
                normalizeText(item?.grado || '').includes(normalizeText(row.grade || '')) &&
                normalizeText(item?.area || '') === normalizeText(areaName || '')
            );

            let transversalOriginalIdx = 0;
            const transversalCompetenciasRows = TRANSVERSAL_NAMES.flatMap((name) => {
                const matchingRows = competenciasDbRows.filter((item) =>
                    normalizeText(item?.grado || '').includes(normalizeText(row.grade || '')) &&
                    (
                        normalizeText(item?.area || '').includes(normalizeText(name)) ||
                        normalizeText(item?.competencias || '').includes(normalizeText(name))
                    )
                );
                return matchingRows.map((item) => ({ ...item, originalIdx: transversalOriginalIdx++ }));
            }).filter((item) => activeTransversalIndexes.includes(item.originalIdx));

            const transversalEstandaresRows = TRANSVERSAL_NAMES.flatMap((name) =>
                estandaresDbRows.filter((item) =>
                    normalizeText(item?.grado || '').includes(normalizeText(row.grade || '')) &&
                    (
                        normalizeText(item?.area || '').includes(normalizeText(name)) ||
                        normalizeText(item?.competencias || '').includes(normalizeText(name))
                    )
                )
            );

            const groupedLearningGoals = Object.values(
                areaCompetenciasRows.reduce((acc, item) => {
                    const competencia = String(item?.competencias || '').trim();
                    if (!competencia) return acc;
                    if (!acc[competencia]) {
                        const estandarMatch = areaEstandaresRows.find((standard) =>
                            normalizeText(standard?.competencias || '') === normalizeText(competencia)
                        );
                        acc[competencia] = {
                            competencia,
                            estandar: String(estandarMatch?.estandar || 'No se halló estándar registrado para esta competencia.').trim(),
                            filas: []
                        };
                    }
                    acc[competencia].filas.push({
                        capacidad: String(item?.capacidades || '').trim(),
                        desempeno: String(item?.desempenos_dcbn || '').trim(),
                        criterio: String(criterios?.[item.originalIdx] || '').trim(),
                        evidencia: String(evidencias?.[item.originalIdx] || '').trim(),
                        instrumento: String(instrumentos?.[item.originalIdx] || '').trim()
                    });
                    return acc;
                }, {})
            );

            const groupedTransversalLearningGoals = Object.values(
                transversalCompetenciasRows.reduce((acc, item) => {
                    const competencia = String(item?.competencias || '').trim();
                    if (!competencia) return acc;
                    if (!acc[competencia]) {
                        const estandarMatch = transversalEstandaresRows.find((standard) =>
                            normalizeText(standard?.competencias || '') === normalizeText(competencia)
                        );
                        acc[competencia] = {
                            competencia,
                            estandar: String(estandarMatch?.estandar || 'No se halló estándar registrado para esta competencia.').trim(),
                            filas: []
                        };
                    }
                    acc[competencia].filas.push({
                        capacidad: String(item?.capacidades || '').trim(),
                        desempeno: String(item?.desempenos_dcbn || '').trim(),
                        criterio: String(criteriosTrans?.[item.originalIdx] || '').trim(),
                        evidencia: String(evidenciasTrans?.[item.originalIdx] || '').trim(),
                        instrumento: String(instrumentosTrans?.[item.originalIdx] || '').trim()
                    });
                    return acc;
                }, {})
            );

            const transversal1Groups = groupedTransversalLearningGoals.filter((group) =>
                normalizeLooseText(group?.competencia || '') === normalizeLooseText(TRANSVERSAL_NAMES[0])
            );
            const transversal2Groups = groupedTransversalLearningGoals.filter((group) =>
                normalizeLooseText(group?.competencia || '') === normalizeLooseText(TRANSVERSAL_NAMES[1])
            );
            const unitMatrixChecks = JSON.parse(row.program_matrix_checks || '{}');
            const currentUnitIndex = Math.max(0, Number(unitNumber || 1) - 1);
            const selectedApproachNames = ENFOQUES_LIST.filter((name) => unitMatrixChecks[`enfoque-${superNormalize(name)}-${currentUnitIndex}`]);
            const groupedTransversalApproaches = selectedApproachNames.map((name) => {
                const matchingRows = enfoquesDbRows.filter((item) =>
                    normalizeApproachName(item?.enfoque || '') === normalizeApproachName(name)
                );
                const filas = matchingRows.map((item) => ({
                    enfoque: normalizeApproachName(item?.enfoque || '') || normalizeApproachName(name),
                    valor: String(item?.valores || '').trim(),
                    actitud: String(item?.actitudes || '').trim(),
                    demuestra: String(item?.se_demuestra_cuando || '').trim()
                }));
                return { enfoque: name, filas };
            }).filter((group) => Array.isArray(group.filas) && group.filas.length > 0);
            const transversalCapacityColorMap = new Map();
            transversal1Groups.forEach((group) => {
                (Array.isArray(group?.filas) ? group.filas : []).forEach((item) => {
                    const key = normalizeLooseText(item?.capacidad || '');
                    if (key && !transversalCapacityColorMap.has(key)) transversalCapacityColorMap.set(key, 'text-[#007c59]');
                });
            });
            transversal2Groups.forEach((group) => {
                (Array.isArray(group?.filas) ? group.filas : []).forEach((item) => {
                    const key = normalizeLooseText(item?.capacidad || '');
                    if (key && !transversalCapacityColorMap.has(key)) transversalCapacityColorMap.set(key, 'text-[#00b28c]');
                });
            });

            const sesionesList = Array.isArray(sesiones)
                ? sesiones.map((sesion, index) => ({
                    sesion_numero: index + 1,
                    sesion_rotulo: `Sesión ${index + 1}`,
                    semana: Math.ceil((index + 1) / 2),
                    semana_rotulo: `(Semana ${Math.ceil((index + 1) / 2)})`,
                    numero: index + 1,
                    id: sesion.id || index + 1,
                    title: sesion.title || '',
                    titulo: sesion.title || '',
                    titulo_sesion: sesion.title || '',
                    competencia_sesion: sesion.competencia || '',
                    cap: sesion.cap || '',
                    capacidad_sesion: sesion.cap || '',
                    des: sesion.des || '',
                    desempeno_sesion: sesion.des || '',
                    con: sesion.con || '',
                    conocimiento_sesion: sesion.con || '',
                    evi: sesion.evi || '',
                    evidencia_sesion: sesion.evi || '',
                    eval: sesion.eval || '',
                    evaluacion_sesion: sesion.eval || '',
                    criteriaItems: Array.isArray(sesion.criteriaItems) ? sesion.criteriaItems : [],
                    evidenceItems: Array.isArray(sesion.evidenceItems) ? sesion.evidenceItems : [],
                    capacidades_detalle: Array.isArray(sesion.capacidades)
                        ? sesion.capacidades
                            .map((value) => {
                            const normalized = normalizeLooseText(value || '');
                            return {
                                text: value,
                                color: transversalCapacityColorMap.get(normalized) || 'text-black',
                                isTransversal: transversalCapacityColorMap.has(normalized)
                            };
                        })
                            .sort((a, b) => Number(a.isTransversal) - Number(b.isTransversal))
                        : [],
                    competencia: sesion.competencia || '',
                    transversales: Array.isArray(sesion.transversales) ? sesion.transversales.join(', ') : '',
                    capacidades: Array.isArray(sesion.capacidades) ? sesion.capacidades.join(', ') : '',
                    fechas_por_seccion: Array.isArray(sesion.fechasPorSeccion)
                        ? sesion.fechasPorSeccion.map((item) => {
                            if (typeof item === 'string') {
                                const match = String(item).match(/^(.*)\((.*)\)\s*$/);
                                return match
                                    ? { seccion: match[1].trim(), fecha: match[2].trim(), texto: String(item).trim() }
                                    : { seccion: '', fecha: '', texto: String(item).trim() };
                            }
                            return {
                                seccion: item.section || item.seccion || '',
                                fecha: item.date || item.fecha || '',
                                texto: [item.section || item.seccion || '', item.date || item.fecha || ''].filter(Boolean).join(' ')
                            };
                        })
                        : []
                }))
                : [];

            const content = fs.readFileSync(templatePath);
            const zip = new PizZip(content);
            const imageModule = new ImageModule({
                centered: true,
                getImage(tagValue) {
                    if (!tagValue) return null;
                    const base64 = String(tagValue).startsWith('data:')
                        ? String(tagValue).replace(/^data:image\/\w+;base64,/, '')
                        : String(tagValue);
                    return Buffer.from(base64, 'base64');
                },
                getSize() { return [85, 85]; }
            });
            const doc = new Docxtemplater(zip, {
                paragraphLoop: true,
                linebreaks: true,
                delimiters: { start: '<<', end: '>>' },
                modules: [imageModule]
            });

            doc.setData({
                institution: dg.institution || '',
                ie: dg.institution || '',
                motto: dg.motto || '',
                lema: dg.motto || '',
                insignia: dg.insignia || '',
                logo: dg.logo || '',
                ugel: dg.ugel || '',
                department: dg.department || '',
                province: toProperName(dg.province || ''),
                provincia: toProperName(dg.province || ''),
                district: toProperName(dg.district || ''),
                distrito: toProperName(dg.district || ''),
                lugar: dg.lugar || '',
                level: dg.level || '',
                year_name: dg.year_name || '',
                nombre_del_ano: dg.year_name || '',
                fecha_generacion_larga: formatGenerationDateLong(),
                generation_date_long: formatGenerationDateLong(),
                docente: dg.teacher || '',
                teacher: dg.teacher || '',
                coord_ped: row.program_coord_ped || '',
                coordinador_pedagogico: row.program_coord_ped || '',
                director: dg.director || '',
                sub_director: dg.subdirector || '',
                year: row.year || dg.year || '',
                anio: row.year || dg.year || '',
                area_id: row.area_id || '',
                area: areaName,
                area_curricular: areaName,
                grade: row.grade || '',
                grado: row.grade || '',
                section: row.section || '',
                seccion: row.section || '',
                unit_number: row.unit_number || '',
                unidad: row.unit_number || '',
                bimestre: getUnitBimester(unitNumber),
                title: row.title || '',
                titulo: row.title || '',
                ciclo: row.program_ciclo || '',
                horas: row.program_horas_sem || '',
                horas_sem: row.program_horas_sem || '',
                estudiantes: row.program_alumnos || '',
                alumnos: row.program_alumnos || '',
                inicio: formatDateSlash(unitStart),
                fin: formatDateSlash(unitEnd),
                sesiones_total: totalSesiones,
                duracion: unitDuration,
                fecha_creacion_unidad: getUnitCreationDate(row),
                fecha_registro_unidad: getUnitCreationDate(row),
                purpose: row.purpose || '',
                proposito: row.purpose || '',
                product: row.product || '',
                producto: row.product || '',
                situation: row.situation || '',
                situacion: row.situation || '',
                tabla_propositos_aprendizaje: LEARNING_GOALS_TABLE_TOKEN,
                tabla_propositos_aprendizaje_trans1: LEARNING_GOALS_TRANS1_TABLE_TOKEN,
                tabla_propositos_aprendizaje_trans2: LEARNING_GOALS_TRANS2_TABLE_TOKEN,
                tabla_enfoques_transversales: TRANSVERSAL_APPROACHES_TABLE_TOKEN,
                tabla_sesiones_aprendizaje: LEARNING_SESSIONS_TABLE_TOKEN,
                tabla_recursos_educativos: EDUCATIONAL_RESOURCES_TABLE_TOKEN,
                propositos_aprendizaje: groupedLearningGoals,
                evaluacion: row.evaluacion || '',
                criterios: objectEntriesList(criterios),
                evidencias: objectEntriesList(evidencias),
                instrumentos: objectEntriesList(instrumentos),
                criterios_trans: objectEntriesList(criteriosTrans),
                evidencias_trans: objectEntriesList(evidenciasTrans),
                instrumentos_trans: objectEntriesList(instrumentosTrans),
                sesiones: sesionesList,
                recursos_materiales: normalizeParagraphs(recursos.materiales),
                recursos_medios: normalizeParagraphs(recursos.medios),
                recursos_actividades: normalizeParagraphs(recursos.actividades),
                recursos_espacios: normalizeParagraphs(recursos.espacios),
                recursos_software: normalizeParagraphs(recursos.software),
                bibliografia_libros: normalizeParagraphs(bibliografia.libros),
                bibliografia_links: normalizeParagraphs(bibliografia.links),
                referencias_bibliograficas: String(bibliografia.libros || '').trim(),
                linkografia: String(bibliografia.links || '').trim(),
                recursos,
                bibliografia
            });

            doc.render();
            let renderedDocumentXml = doc.getZip().file('word/document.xml')?.asText() || '';
            renderedDocumentXml = renderLearningGoalsTableModel(renderedDocumentXml, groupedLearningGoals);
            renderedDocumentXml = renderLearningGoalsTableModelWithConfig(renderedDocumentXml, transversal1Groups, {
                token: LEARNING_GOALS_TRANS1_TABLE_TOKEN,
                label: 'tabla_propositos_aprendizaje_trans1',
                competenciaKey: 'competencia_trans1',
                estandarKey: 'estandar_trans1',
                capacidadKey: 'capacidad_trans1',
                desempenoKey: 'desempeno_trans1',
                criterioKey: 'criterio_trans1',
                evidenciaKey: 'evidencia_trans1',
                instrumentoKey: 'instrumento_trans1'
            });
            renderedDocumentXml = renderLearningGoalsTableModelWithConfig(renderedDocumentXml, transversal2Groups, {
                token: LEARNING_GOALS_TRANS2_TABLE_TOKEN,
                label: 'tabla_propositos_aprendizaje_trans2',
                competenciaKey: 'competencia_trans2',
                estandarKey: 'estandar_trans2',
                capacidadKey: 'capacidad_trans2',
                desempenoKey: 'desempeno_trans2',
                criterioKey: 'criterio_trans2',
                evidenciaKey: 'evidencia_trans2',
                instrumentoKey: 'instrumento_trans2'
            });
            renderedDocumentXml = renderTransversalApproachesTableModel(renderedDocumentXml, groupedTransversalApproaches);
            renderedDocumentXml = renderLearningSessionsTableModel(renderedDocumentXml, sesionesList);
            renderedDocumentXml = renderEducationalResourcesTableModel(renderedDocumentXml, {
                materiales: normalizeParagraphs(recursos.materiales),
                medios: normalizeParagraphs(recursos.medios),
                recursos: normalizeParagraphs(recursos.actividades),
                espacios: normalizeParagraphs(recursos.espacios)
            });
            doc.getZip().file('word/document.xml', renderedDocumentXml);

            const fileName = `UD ${sanitizeFileLabel(row.unit_number, '1')} - ${sanitizeFileLabel(areaName, 'area')} - ${sanitizeFileLabel(row.grade, 'grado')} ${sanitizeFileLabel(row.section, 'seccion')}.docx`;
            const finalPath = path.join(outputPath, fileName);
            const tempPath = `${finalPath}.tmp`;
            const buffer = doc.getZip().generate({ type: 'nodebuffer' });
            fs.writeFileSync(tempPath, buffer);
            fs.renameSync(tempPath, finalPath);

            generationProgress.current++;
            generationProgress.lastFile = fileName;
            generationProgress.generatedCount++;
        }

        if (generationProgress.generatedCount === 0) throw new Error('La exportaciÃ³n de unidades terminÃ³ sin generar archivos.');
        generationProgress.active = false;
    } catch (e) {
        generationProgress.error = formatTemplateError(e);
        generationProgress.active = false;
    }
});

router.post('/unidad-word/open-folder', (req, res) => {
    const { customPath } = req.body;
    const outputPath = customPath || tempRoot;
    const command = process.platform === 'win32'
        ? `explorer "${outputPath}"`
        : process.platform === 'darwin'
            ? `open "${outputPath}"`
            : `xdg-open "${outputPath}"`;
    exec(command);
    res.json({ success: true });
});

router.get('/unidad-word/pick-folder', (req, res) => {
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
            return res.json({ success: false, cancelled: true, message: 'SelecciÃ³n cancelada.' });
        }

        return res.json({ success: true, path: selectedPath });
    });
});

router.get('/unidad-word/template-fields', (req, res) => {
    try {
        const fields = extractTemplateFields();
        const sessionMarkers = extractRouteTemplateKeys();
        res.json({ success: true, delimiters: { start: '<<', end: '>>' }, fields, sessionMarkers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message, fields: [], sessionMarkers: [] });
    }
});

export default router;
