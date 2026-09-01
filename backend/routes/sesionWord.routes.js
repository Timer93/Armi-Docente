import express from 'express';
import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';
import { exec, execFile } from 'child_process';
import db from '../db.js';
import { resolveTemplatePath, tempRoot, uploadsRoot } from '../paths.js';
import { normalizeDocxEmbeddedImageTypes, sanitizeDocxDrawingIds } from './wordDocxUtils.js';
import { INSTRUMENT_BLOCK_TOKEN, getInstrumentTitleText, replaceInstrumentToken } from './sessionWordBlocks.js';
import { ensureSessionResourceVariantLinks } from '../sessionResourceStorage.js';

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

const RESOURCE_IMAGE_TAGS = new Set([
    'recurso_instructivo_imagen',
    'anexo_1_imagen',
    'anexo_2_imagen'
]);

const DXA_PER_PIXEL = 15;
const RESOURCE_VERTICAL_RESERVE_PX = 180;

const readDxaAttribute = (xml, elementName, attributeName, fallback = 0) => {
    const element = String(xml || '').match(new RegExp(`<w:${elementName}\\b[^>]*>`, 'i'))?.[0] || '';
    const value = Number(element.match(new RegExp(`w:${attributeName}="(\\d+)"`, 'i'))?.[1]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

const sectionXmlForTag = (documentXml, tagName) => {
    const xml = String(documentXml || '');
    const tagIndex = xml.indexOf(String(tagName || ''));
    if (tagIndex < 0) return '';

    const paragraphMatches = [...xml.slice(0, tagIndex).matchAll(/<w:p(?:\s|>)/g)];
    const paragraphStart = paragraphMatches.at(-1)?.index ?? 0;
    const localSectionStart = xml.lastIndexOf('<w:sectPr', tagIndex);
    if (localSectionStart >= paragraphStart) {
        const localSectionEnd = xml.indexOf('</w:sectPr>', localSectionStart);
        if (localSectionEnd >= 0) return xml.slice(localSectionStart, localSectionEnd + 11);
    }

    const nextSectionStart = xml.indexOf('<w:sectPr', tagIndex);
    if (nextSectionStart < 0) return '';
    const nextSectionEnd = xml.indexOf('</w:sectPr>', nextSectionStart);
    return nextSectionEnd >= 0 ? xml.slice(nextSectionStart, nextSectionEnd + 11) : '';
};

const pageBoxForTag = (documentXml, tagName) => {
    const sectionXml = sectionXmlForTag(documentXml, tagName);
    const xml = String(documentXml || '');
    const tagIndex = xml.indexOf(String(tagName || ''));
    const paragraphMatches = tagIndex >= 0 ? [...xml.slice(0, tagIndex).matchAll(/<w:p(?:\s|>)/g)] : [];
    const paragraphStart = paragraphMatches.at(-1)?.index ?? -1;
    const paragraphEnd = paragraphStart >= 0 ? xml.indexOf('</w:p>', tagIndex) : -1;
    const paragraphXml = paragraphStart >= 0 && paragraphEnd >= 0
        ? xml.slice(paragraphStart, paragraphEnd + 6)
        : '';
    const pageWidthDxa = readDxaAttribute(sectionXml, 'pgSz', 'w', 11906);
    const pageHeightDxa = readDxaAttribute(sectionXml, 'pgSz', 'h', 16838);
    const leftDxa = readDxaAttribute(sectionXml, 'pgMar', 'left', 1440);
    const rightDxa = readDxaAttribute(sectionXml, 'pgMar', 'right', 1440);
    const topDxa = readDxaAttribute(sectionXml, 'pgMar', 'top', 1440);
    const bottomDxa = readDxaAttribute(sectionXml, 'pgMar', 'bottom', 1440);
    const paragraphLeftDxa = readDxaAttribute(paragraphXml, 'ind', 'left', 0);
    const paragraphRightDxa = readDxaAttribute(paragraphXml, 'ind', 'right', 0);
    return {
        width: Math.max(1, Math.floor((pageWidthDxa - leftDxa - rightDxa - paragraphLeftDxa - paragraphRightDxa) / DXA_PER_PIXEL)),
        height: Math.max(1, Math.floor((pageHeightDxa - topDxa - bottomDxa) / DXA_PER_PIXEL) - RESOURCE_VERTICAL_RESERVE_PX)
    };
};

const readRasterDimensions = (image) => {
    if (!Buffer.isBuffer(image) || image.length < 10) return null;
    if (image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && image.length >= 24) {
        return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
    }
    if (image.toString('ascii', 0, 3) === 'GIF') {
        return { width: image.readUInt16LE(6), height: image.readUInt16LE(8) };
    }
    if (image[0] === 0xff && image[1] === 0xd8) {
        let offset = 2;
        while (offset + 9 < image.length) {
            if (image[offset] !== 0xff) {
                offset += 1;
                continue;
            }
            const marker = image[offset + 1];
            if (marker === 0xd8 || marker === 0xd9) {
                offset += 2;
                continue;
            }
            const segmentLength = image.readUInt16BE(offset + 2);
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
                return { width: image.readUInt16BE(offset + 7), height: image.readUInt16BE(offset + 5) };
            }
            if (segmentLength < 2) break;
            offset += segmentLength + 2;
        }
    }
    if (image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP') {
        const format = image.toString('ascii', 12, 16);
        if (format === 'VP8X' && image.length >= 30) {
            return { width: image.readUIntLE(24, 3) + 1, height: image.readUIntLE(27, 3) + 1 };
        }
        if (format === 'VP8L' && image.length >= 25) {
            const bits = image.readUInt32LE(21);
            return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
        if (format === 'VP8 ' && image.length >= 30) {
            return { width: image.readUInt16LE(26) & 0x3fff, height: image.readUInt16LE(28) & 0x3fff };
        }
    }
    return null;
};

const fitImageToPage = (image, pageBox, fallbackAspect = '16:9') => {
    const dimensions = readRasterDimensions(image);
    const fallback = ({
        '16:9': [520, 293],
        '9:16': [300, 533],
        '1:1': [430, 430],
        '3:4': [390, 520]
    })[fallbackAspect] || [520, 293];
    const originalWidth = Number(dimensions?.width) || fallback[0];
    const originalHeight = Number(dimensions?.height) || fallback[1];
    const scale = Math.min(1, pageBox.width / originalWidth, pageBox.height / originalHeight);
    return [
        Math.max(1, Math.round(originalWidth * scale)),
        Math.max(1, Math.round(originalHeight * scale))
    ];
};

const RESOURCE_KIND_LABELS = {
    informative: 'Instructivo informativo',
    dynamic: 'Dinámica',
    youtube: 'Video de YouTube',
    collage: 'Lámina de imágenes',
    questions: 'Preguntas desafiantes',
    worksheet: 'Ficha de trabajo',
    form: 'Formulario TIC',
    gamification: 'Gamificación',
    project: 'Reto o producto digital'
};

const resolveLocalUploadPath = (rawUrl) => {
    const text = String(rawUrl || '').trim();
    const uploadMatch = text.match(/\/uploads\/([^?#]+)/i);
    if (!uploadMatch?.[1]) return '';
    const relative = decodeURIComponent(uploadMatch[1]).replace(/[\\/]+/g, path.sep);
    const resolved = path.resolve(uploadsRoot, relative);
    const relativeCheck = path.relative(uploadsRoot, resolved);
    if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) return '';
    return resolved;
};

const loadWordImage = async (value) => {
    if (!value) return null;
    if (Buffer.isBuffer(value)) return value;
    const text = String(value || '').trim();
    const dataMatch = text.match(/^data:image\/[^;]+;base64,(.+)$/i);
    if (dataMatch?.[1]) return Buffer.from(dataMatch[1], 'base64');

    const localUpload = resolveLocalUploadPath(text);
    if (localUpload && fs.existsSync(localUpload)) return fs.readFileSync(localUpload);
    if (path.isAbsolute(text) && fs.existsSync(text)) return fs.readFileSync(text);

    if (/^https?:\/\//i.test(text)) {
        const response = await fetch(text, { signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`No se pudo descargar la imagen del recurso (${response.status}).`);
        return Buffer.from(await response.arrayBuffer());
    }
    return null;
};

const safeLoadWordImage = async (value) => {
    try {
        const image = await loadWordImage(value);
        return image ? image.toString('base64') : '';
    } catch {
        return '';
    }
};

const resourceDisplayTitle = (resource = {}) => String(
    resource?.metadata?.externalTitle
    || resource?.aiContent?.heading
    || resource?.title
    || ''
).trim();

const resourceKindLabel = (resource = {}) => RESOURCE_KIND_LABELS[String(resource?.kind || '').trim()] || String(resource?.kind || '').trim();

const buildResourceDataBlock = (resource = {}, options = {}) => {
    const lines = [
        options.includeTitle ? resourceDisplayTitle(resource) : '',
        resourceKindLabel(resource),
        String(resource?.metadata?.deliverable || '').trim(),
        String(resource?.metadata?.url || '').trim()
    ].filter(Boolean);
    return options.includeReason
        ? [...lines, String(resource?.metadata?.pedagogicalReason || '').trim()].filter(Boolean).join('\n')
        : lines.join('\n');
};

const getActiveStudentsForSession = (row) => {
    try {
        return db.prepare(`
            SELECT id, estudiantes AS name
            FROM db_estudiantes
            WHERE grado = ? AND secc = ? AND UPPER(COALESCE(estado, 'A')) NOT IN ('I', 'INACTIVO', 'RETIRADO')
            ORDER BY estudiantes ASC
        `).all(row.grade || '', row.section || '');
    } catch {
        return [];
    }
};

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

const escapeXml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const decodeXmlText = (value) => String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const extractParagraphText = (paragraphXml) => decodeXmlText(
    Array.from(String(paragraphXml || '').matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
        .map((match) => match[1] || '')
        .join('')
);

const LIST_MARKER_PATTERN = /[•●◦▪■□◆❖➢➤✓✔]/g;

const cleanListItemText = (value) => String(value || '')
    .trim()
    .replace(/^[•●◦▪■□◆❖➢➤✓✔]\s*/u, '')
    .replace(/^[-–—]\s+/u, '')
    .trim();

const splitListItems = (value) => {
    const normalized = String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(LIST_MARKER_PATTERN, '\n')
        .replace(/(^|\n)\s*[-–—]\s+/g, '$1');
    return normalized
        .split('\n')
        .map(cleanListItemText)
        .filter(Boolean);
};

const prepareNumberedTemplateLists = (zip, sourceData) => {
    const data = { ...(sourceData || {}) };
    const replacements = [];
    const fieldTokens = new Map();
    const xmlNames = Object.keys(zip?.files || {}).filter((name) =>
        name.startsWith('word/') && name.endsWith('.xml')
    );

    xmlNames.forEach((name) => {
        const xml = zip.file(name)?.asText() || '';
        const paragraphs = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
        paragraphs.forEach((paragraph) => {
            if (!/<w:numPr\b/.test(paragraph)) return;
            const paragraphText = extractParagraphText(paragraph);
            const markerPattern = /<<\s*([^<>]+?)\s*>>/g;
            let markerMatch;
            while ((markerMatch = markerPattern.exec(paragraphText)) !== null) {
                const field = String(markerMatch[1] || '').trim();
                if (!field || !Object.prototype.hasOwnProperty.call(data, field)) continue;
                if (typeof data[field] !== 'string') continue;

                let token = fieldTokens.get(field);
                if (!token) {
                    token = `__ARMI_NUMBERED_LIST_${fieldTokens.size + 1}__`;
                    fieldTokens.set(field, token);
                    replacements.push({
                        field,
                        token,
                        items: splitListItems(data[field])
                    });
                    data[field] = token;
                }
            }
        });
    });

    return { data, replacements };
};

const expandNumberedListParagraphs = (xml, replacements) => {
    let next = String(xml || '');
    (Array.isArray(replacements) ? replacements : []).forEach((replacement) => {
        const token = String(replacement?.token || '');
        if (!token || !next.includes(token)) return;
        const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const paragraphPattern = new RegExp(
            `<w:p\\b[^>]*>(?:(?!<\\/w:p>)[\\s\\S])*?${escapedToken}(?:(?!<\\/w:p>)[\\s\\S])*?<\\/w:p>`,
            'g'
        );
        next = next.replace(paragraphPattern, (paragraph) => {
            const items = Array.isArray(replacement.items) ? replacement.items : [];
            if (items.length === 0) return paragraph.replace(token, '');
            return items.map((item, index) => {
                let cloned = paragraph.replace(token, escapeXml(item));
                if (index > 0) {
                    cloned = cloned
                        .replace(/\s+w14:paraId="[^"]*"/g, '')
                        .replace(/\s+w14:textId="[^"]*"/g, '');
                }
                return cloned;
            }).join('');
        });
    });
    return next;
};

const applyNumberedTemplateLists = (zip, replacements) => {
    if (!Array.isArray(replacements) || replacements.length === 0) return;
    Object.keys(zip?.files || {})
        .filter((name) => name.startsWith('word/') && name.endsWith('.xml'))
        .forEach((name) => {
            const xml = zip.file(name)?.asText() || '';
            if (!xml) return;
            const rendered = expandNumberedListParagraphs(xml, replacements);
            if (rendered !== xml) zip.file(name, rendered);
        });
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
    'fecha_creacion_sesion',
    '%recurso_instructivo_imagen',
    'recurso_instructivo_titulo',
    '%anexo_1_imagen',
    'anexo_1_tipo',
    'anexo_1_titulo',
    'anexo_1_enlace',
    'anexo_1_datos',
    '%anexo_2_imagen',
    'anexo_2_tipo',
    'anexo_2_titulo',
    'anexo_2_enlace',
    'anexo_2_evidencia',
    'anexo_2_datos',
    'instrumento_evaluacion_titulo',
    'instrumento_evaluacion'
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
            let sessionData = JSON.parse(row.session_data || '{}');
            const repairedResources = await ensureSessionResourceVariantLinks({
                sessionData,
                sessionId: row.id_sesion,
                uploadsRoot,
            });
            sessionData = repairedResources.sessionData;
            if (repairedResources.changed) {
                db.prepare('UPDATE sesiones SET session_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id_sesion = ?')
                    .run(JSON.stringify(sessionData), row.id_sesion);
            }
            const unitSessions = JSON.parse(row.unit_sessions || '[]');
            const totalSesionesUnidad = Array.isArray(unitSessions) ? unitSessions.length : 0;
            const areaName = String(row.area_name || '').trim();
            const matrixChecks = JSON.parse(row.program_matrix_checks || '{}');
            const enfoque = extractApproachForSession(sessionData?.enfoqueTrans, matrixChecks, row.unit_number);
            const ejesTematicos = extractRegionalAxes(matrixChecks, row.unit_number);
            const seq = sessionData?.secuencia || {};
            const recursosSesion = sessionData?.recursos || {};
            const bibliografiaSesion = sessionData?.bibliografia || {};
            const learningResources = sessionData?.learningResources || {};
            const instructiveResource = learningResources?.instructive || {};
            const annex1Resource = learningResources?.annex1 || {};
            const annex2Resource = learningResources?.annex2 || {};
            const [instructiveImage, annex1Image, annex2Image] = await Promise.all([
                safeLoadWordImage(instructiveResource?.wordImageUrl || instructiveResource?.imageUrl),
                safeLoadWordImage(annex1Resource?.wordImageUrl || annex1Resource?.imageUrl),
                safeLoadWordImage(annex2Resource?.wordImageUrl || annex2Resource?.imageUrl)
            ]);
            const sessionStudents = getActiveStudentsForSession(row);
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

            const templateZip = new PizZip(fs.readFileSync(templatePath));
            const templateDocumentXml = templateZip.file('word/document.xml')?.asText() || '';
            const imagePageBoxes = Object.fromEntries(
                [...RESOURCE_IMAGE_TAGS].map((tagName) => [tagName, pageBoxForTag(templateDocumentXml, tagName)])
            );
            const doc = new Docxtemplater(templateZip, {
                paragraphLoop: true,
                linebreaks: true,
                delimiters: { start: '<<', end: '>>' },
                modules: [new ImageModule({
                    centered: false,
                    getImage(tagValue) {
                        if (!tagValue) return null;
                        if (Buffer.isBuffer(tagValue)) return tagValue;
                        const base64 = String(tagValue).startsWith('data:')
                            ? String(tagValue).replace(/^data:image\/\w+;base64,/, '')
                            : String(tagValue);
                        return Buffer.from(base64, 'base64');
                    },
                    getSize(image, _tagValue, tagName) {
                        if (!RESOURCE_IMAGE_TAGS.has(String(tagName || ''))) return [85, 85];
                        const resource = tagName === 'recurso_instructivo_imagen'
                            ? instructiveResource
                            : tagName === 'anexo_1_imagen'
                                ? annex1Resource
                                : annex2Resource;
                        return fitImageToPage(
                            image,
                            imagePageBoxes[tagName] || { width: 520, height: 700 },
                            resource?.aspectRatio
                        );
                    }
                })]
            });

            const templateData = {
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
                generation_date_long: formatGenerationDateLong(),
                recurso_instructivo_imagen: instructiveImage,
                recurso_instructivo_titulo: resourceDisplayTitle(instructiveResource),
                anexo_1_imagen: annex1Image,
                anexo_1_tipo: resourceKindLabel(annex1Resource),
                anexo_1_titulo: resourceDisplayTitle(annex1Resource),
                anexo_1_enlace: annex1Resource?.metadata?.url || '',
                anexo_1_datos: buildResourceDataBlock(annex1Resource, { includeReason: true }),
                anexo_2_imagen: annex2Image,
                anexo_2_tipo: resourceKindLabel(annex2Resource),
                anexo_2_titulo: resourceDisplayTitle(annex2Resource),
                anexo_2_enlace: annex2Resource?.metadata?.url || '',
                anexo_2_evidencia: annex2Resource?.metadata?.deliverable || '',
                anexo_2_datos: buildResourceDataBlock(annex2Resource),
                instrumento_evaluacion_titulo: getInstrumentTitleText(sessionData),
                instrumento_evaluacion: INSTRUMENT_BLOCK_TOKEN
            };

            const numberedTemplateLists = prepareNumberedTemplateLists(templateZip, templateData);
            doc.render(numberedTemplateLists.data);
            applyNumberedTemplateLists(doc.getZip(), numberedTemplateLists.replacements);

            const renderedDocumentXml = doc.getZip().file('word/document.xml')?.asText() || '';
            doc.getZip().file('word/document.xml', replaceInstrumentToken(renderedDocumentXml, sessionData, sessionStudents));

            const fileName = `SES ${sanitizeFileLabel(row.session_number, '1')} - ${sanitizeFileLabel(areaName, 'Area')} - ${sanitizeFileLabel(row.grade, 'Grado')} ${sanitizeFileLabel(row.section, 'Seccion')} - U${sanitizeFileLabel(row.unit_number, '1')}.docx`;
            const finalPath = path.join(outputPath, fileName);
            const tempPath = `${finalPath}.tmp`;
            sanitizeDocxDrawingIds(doc);
            normalizeDocxEmbeddedImageTypes(doc);
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
        console.error('[SESION WORD] Error al generar documentos:', e?.stack || e);
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
