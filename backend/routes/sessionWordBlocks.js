const INSTRUMENT_BLOCK_TOKEN = '__ARMI_INSTRUMENTO_EVALUACION__';

const COLORS = {
    ink: '172033',
    grid: 'C7D3E3',
    pale: 'F7F9FC',
    competence: 'DFE7F2',
    capacity: 'F1F4F8',
    red: 'F51B25',
    orange: 'FF7A21',
    green: '28A745',
    cyan: '27B7C9',
    emerald: '07966B',
    emeraldDark: '067455',
    purple: '6D28D9'
};

const escapeXml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const normalizeLoose = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();

const detectInstrumentType = (sessionData = {}) => {
    const value = normalizeLoose([
        sessionData?.instrumentoTemplate?.type,
        sessionData?.instrumentoTemplate?.name,
        sessionData?.sessionAssessmentModel?.instrument?.type,
        sessionData?.sessionAssessmentModel?.instrument?.name,
        sessionData?.competenciaPrio?.inst
    ].filter(Boolean).join(' '));
    if (value.includes('rubrica')) return 'rubrica';
    if (value.includes('lista') || value.includes('cotejo')) return 'lista_cotejo';
    if (value.includes('escala') || value.includes('valoracion')) return 'escala_valoracion';
    if (value.includes('guia') || value.includes('observacion')) return 'guia_observacion';
    return 'rubrica';
};

const instrumentTitle = (type) => ({
    rubrica: ['RÚBRICA ANALÍTICA'],
    lista_cotejo: ['LISTA DE COTEJO'],
    escala_valoracion: ['ESCALA DE VALORACIÓN'],
    guia_observacion: ['GUÍA DE OBSERVACIÓN']
}[type] || ['INSTRUMENTO DE EVALUACIÓN']);

const getInstrumentTitleText = (sessionData = {}) => instrumentTitle(detectInstrumentType(sessionData)).join('\n');

const runXml = (text, options = {}) => {
    const color = String(options.color || COLORS.ink).replace('#', '');
    const size = Number(options.size || 16);
    const properties = [
        '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial"/>',
        `<w:color w:val="${color}"/>`,
        `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
        options.bold ? '<w:b/><w:bCs/>' : '',
        options.italic ? '<w:i/><w:iCs/>' : ''
    ].join('');
    const lines = String(text ?? '').split(/\r?\n/);
    const body = lines.map((line, index) => `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${escapeXml(line)}</w:t>`).join('');
    return `<w:r><w:rPr>${properties}</w:rPr>${body}</w:r>`;
};

const paragraphXml = (text, options = {}) => {
    const align = options.align || 'left';
    const spacingAfter = Number(options.after ?? 0);
    const spacingBefore = Number(options.before ?? 0);
    const keepNext = options.keepNext ? '<w:keepNext/>' : '';
    return `<w:p><w:pPr>${keepNext}<w:jc w:val="${align}"/><w:spacing w:before="${spacingBefore}" w:after="${spacingAfter}" w:line="200" w:lineRule="auto"/></w:pPr>${runXml(text, options)}</w:p>`;
};

const bordersXml = (color = COLORS.grid, size = 6) => {
    const edge = (name) => `<w:${name} w:val="single" w:sz="${size}" w:space="0" w:color="${color}"/>`;
    return `<w:tcBorders>${edge('top')}${edge('left')}${edge('bottom')}${edge('right')}</w:tcBorders>`;
};

const cellXml = (content, options = {}) => {
    const width = Math.max(1, Number(options.width || 1000));
    const gridSpan = Number(options.gridSpan || 1);
    const fill = options.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${String(options.fill).replace('#', '')}"/>` : '';
    const vMerge = options.vMerge ? `<w:vMerge${options.vMerge === 'restart' ? ' w:val="restart"' : ''}/>` : '';
    const span = gridSpan > 1 ? `<w:gridSpan w:val="${gridSpan}"/>` : '';
    const valign = `<w:vAlign w:val="${options.vAlign || 'center'}"/>`;
    const margins = `<w:tcMar><w:top w:w="${options.marginTop ?? 55}" w:type="dxa"/><w:left w:w="${options.marginLeft ?? 70}" w:type="dxa"/><w:bottom w:w="${options.marginBottom ?? 55}" w:type="dxa"/><w:right w:w="${options.marginRight ?? 70}" w:type="dxa"/></w:tcMar>`;
    const border = bordersXml(String(options.borderColor || COLORS.grid).replace('#', ''), Number(options.borderSize || 6));
    const paragraphs = options.raw ? String(content || '') : paragraphXml(content, options);
    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span}${vMerge}${fill}${border}${valign}${margins}</w:tcPr>${paragraphs || '<w:p/>'}</w:tc>`;
};

const rowXml = (cells, options = {}) => `<w:tr>${options.repeat ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.join('')}</w:tr>`;

const tableXml = (widths, rows, options = {}) => {
    const total = widths.reduce((sum, width) => sum + width, 0);
    const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows.join('')}</w:tbl>${options.afterParagraph === false ? '' : '<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>'}`;
};

const scaleWidths = (widths, targetWidth) => {
    const safeTarget = Math.max(1, Number(targetWidth || 9360));
    const sourceTotal = widths.reduce((sum, width) => sum + width, 0) || 1;
    const scaled = widths.map((width) => Math.max(1, Math.floor((width / sourceTotal) * safeTarget)));
    scaled[scaled.length - 1] += safeTarget - scaled.reduce((sum, width) => sum + width, 0);
    return scaled;
};

const usableWidthAtToken = (documentXml, token = INSTRUMENT_BLOCK_TOKEN) => {
    const xml = String(documentXml || '');
    const tokenIndex = xml.indexOf(token);
    if (tokenIndex < 0) return 9360;
    const nextSectionStart = xml.indexOf('<w:sectPr', tokenIndex);
    if (nextSectionStart < 0) return 9360;
    const nextSectionEnd = xml.indexOf('</w:sectPr>', nextSectionStart);
    const sectionXml = nextSectionEnd >= 0 ? xml.slice(nextSectionStart, nextSectionEnd + 11) : '';
    const pageSize = sectionXml.match(/<w:pgSz\b[^>]*>/i)?.[0] || '';
    const margins = sectionXml.match(/<w:pgMar\b[^>]*>/i)?.[0] || '';
    const pageWidth = Number(pageSize.match(/w:w="(\d+)"/i)?.[1]) || 11906;
    const left = Number(margins.match(/w:left="(\d+)"/i)?.[1]) || 1440;
    const right = Number(margins.match(/w:right="(\d+)"/i)?.[1]) || 1440;
    return Math.max(1, pageWidth - left - right);
};

const getInstrumentRows = (sessionData = {}) => {
    const direct = Array.isArray(sessionData?.instrumento) ? sessionData.instrumento : [];
    const model = Array.isArray(sessionData?.sessionAssessmentModel?.rows)
        ? sessionData.sessionAssessmentModel.rows
        : [];
    const canonicalById = new Map(
        model
            .map((row) => [String(row?.id || '').trim(), row])
            .filter(([id]) => !!id)
    );
    const normalizeRow = (raw = {}, canonical = {}) => ({
        id: String(raw?.id || canonical?.id || '').trim(),
        competencia: String(raw?.competencia || raw?.comp || canonical?.competencyName || sessionData?.competenciaPrio?.comp || '').trim(),
        capacidad: String(raw?.capacidad || raw?.cap || canonical?.capacityName || sessionData?.competenciaPrio?.cap || '').trim(),
        criterio: String(raw?.criterio || canonical?.criterionText || '').trim(),
        c: String(raw?.c || canonical?.levelDescriptors?.c || '').trim(),
        b: String(raw?.b || canonical?.levelDescriptors?.b || '').trim(),
        a: String(raw?.a || canonical?.levelDescriptors?.a || '').trim(),
        ad: String(raw?.ad || canonical?.levelDescriptors?.ad || '').trim()
    });
    const semanticKey = (row) => `${normalizeLoose(row?.criterio)}::${normalizeLoose(row?.capacidad)}`;
    const fullSemanticKey = (row) => `${semanticKey(row)}::${normalizeLoose(row?.competencia)}`;

    const directRows = direct
        .map((raw) => normalizeRow(raw, canonicalById.get(String(raw?.id || '').trim()) || {}))
        .filter((row) => row.criterio || row.capacidad || row.competencia);
    const directById = new Map(directRows.map((row) => [row.id, row]).filter(([id]) => !!id));
    const directBySemantic = new Map();
    directRows.forEach((row) => {
        const key = semanticKey(row);
        if (key !== '::' && !directBySemantic.has(key)) directBySemantic.set(key, row);
    });

    // El modelo conserva el número y el orden real de criterios de la sesión.
    // Si dos competencias evalúan el mismo criterio, cada una debe ocupar su propia fila;
    // los descriptores pueden recuperarse de la fila editable equivalente.
    const modelRows = model
        .map((canonical) => {
            const canonicalRow = normalizeRow({}, canonical);
            const descriptorSource = directById.get(canonicalRow.id)
                || directBySemantic.get(semanticKey(canonicalRow))
                || {};
            return normalizeRow({
                ...descriptorSource,
                id: canonicalRow.id || descriptorSource.id,
                competencia: canonicalRow.competencia || descriptorSource.competencia,
                capacidad: canonicalRow.capacidad || descriptorSource.capacidad,
                criterio: canonicalRow.criterio || descriptorSource.criterio,
                c: descriptorSource.c || canonicalRow.c,
                b: descriptorSource.b || canonicalRow.b,
                a: descriptorSource.a || canonicalRow.a,
                ad: descriptorSource.ad || canonicalRow.ad
            }, canonical);
        })
        .filter((row) => row.criterio || row.capacidad || row.competencia);

    const modelIds = new Set(modelRows.map((row) => row.id).filter(Boolean));
    const modelKeys = new Set(modelRows.map(fullSemanticKey));
    const additionalDirectRows = directRows.filter((row) => (
        (!row.id || !modelIds.has(row.id))
        && !modelKeys.has(fullSemanticKey(row))
    ));
    const rows = modelRows.length > 0 ? [...modelRows, ...additionalDirectRows] : directRows;
    return rows.length ? rows : [{
        competencia: String(sessionData?.competenciaPrio?.comp || 'Competencia').trim(),
        capacidad: String(sessionData?.competenciaPrio?.cap || 'Capacidad').trim(),
        criterio: String(sessionData?.competenciaPrio?.des || 'Criterio de evaluación').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        c: '', b: '', a: '', ad: ''
    }];
};

const groupRows = (rows) => {
    const groups = [];
    rows.forEach((row) => {
        const competence = row.competencia || 'Competencia';
        let comp = groups.find((item) => normalizeLoose(item.name) === normalizeLoose(competence));
        if (!comp) {
            comp = { name: competence, capacities: [] };
            groups.push(comp);
        }
        const capacity = row.capacidad || 'Capacidad';
        let cap = comp.capacities.find((item) => normalizeLoose(item.name) === normalizeLoose(capacity));
        if (!cap) {
            cap = { name: capacity, rows: [] };
            comp.capacities.push(cap);
        }
        cap.rows.push(row);
    });
    return groups;
};

const buildRubric = (rows, targetWidth) => {
    const widths = scaleWidths([650, 1700, 1752, 1752, 1753, 1753], targetWidth);
    const headers = ['Nro', 'CRITERIO', 'Inicio', 'Proceso', 'Logrado', 'Destacado'];
    const fills = [COLORS.ink, COLORS.ink, COLORS.red, COLORS.orange, COLORS.green, '83C7D8'];
    const bodyColors = [COLORS.ink, COLORS.ink, COLORS.red, COLORS.orange, COLORS.green, '73BBD0'];
    const tableRows = [rowXml(headers.map((text, index) => cellXml(text, {
        width: widths[index], fill: fills[index], color: 'FFFFFF', bold: true,
        align: index < 2 ? 'left' : 'left', borderColor: COLORS.grid, marginTop: 90, marginBottom: 90
    })), { repeat: true })];
    rows.forEach((row, index) => {
        const values = [String(index + 1), row.criterio, row.c, row.b, row.a, row.ad];
        tableRows.push(rowXml(values.map((text, col) => cellXml(text, {
            width: widths[col], color: bodyColors[col], bold: col < 2,
            align: col === 0 ? 'center' : 'left', vAlign: 'center', marginTop: 80, marginBottom: 80
        }))));
    });
    return tableXml(widths, tableRows);
};

const buildChecklist = (rows, targetWidth) => {
    const widths = scaleWidths([420, 6370, 570, 570, 1430], targetWidth);
    const headers = ['Nro', 'CRITERIOS OBSERVABLES', 'SÍ', 'NO', 'OBSERVACIONES'];
    const tableRows = [rowXml(headers.map((text, index) => cellXml(text, {
        width: widths[index], fill: COLORS.emerald, color: 'FFFFFF', bold: true,
        align: index === 1 || index === 4 ? 'left' : 'center', borderColor: COLORS.emeraldDark, marginTop: 90, marginBottom: 90
    })), { repeat: true })];
    let number = 0;
    groupRows(rows).forEach((competence) => {
        tableRows.push(rowXml([cellXml(competence.name.toUpperCase(), {
            width: targetWidth, gridSpan: 5, fill: 'AAB2BF', bold: true, borderColor: COLORS.grid, marginTop: 80, marginBottom: 80
        })]));
        competence.capacities.forEach((capacity) => {
            tableRows.push(rowXml([cellXml(capacity.name.toUpperCase(), {
                width: targetWidth, gridSpan: 5, fill: 'E5E7EB', color: COLORS.emeraldDark, bold: true, borderColor: COLORS.grid, marginTop: 80, marginBottom: 80
            })]));
            capacity.rows.forEach((item) => {
                number += 1;
                const values = [String(number), item.criterio, '', '', '-'];
                tableRows.push(rowXml(values.map((text, col) => cellXml(text, {
                    width: widths[col], align: col === 0 || col === 2 || col === 3 ? 'center' : 'left', marginTop: 80, marginBottom: 80
                }))));
            });
        });
    });
    return tableXml(widths, tableRows);
};

const buildScale = (rows, targetWidth) => {
    const widths = scaleWidths([780, 4160, 1105, 1105, 1105, 1105], targetWidth);
    const tableRows = [rowXml([
        cellXml('Nro', { width: widths[0], vMerge: 'restart', fill: COLORS.ink, color: 'FFFFFF', bold: true, align: 'center' }),
        cellXml('CRITERIOS', { width: widths[1], vMerge: 'restart', fill: COLORS.ink, color: 'FFFFFF', bold: true, align: 'center' }),
        cellXml('Niveles de logro', { width: widths.slice(2).reduce((a, b) => a + b, 0), gridSpan: 4, fill: COLORS.ink, color: 'FFFFFF', bold: true, align: 'center' })
    ], { repeat: true }), rowXml([
        cellXml('', { width: widths[0], vMerge: 'continue', fill: COLORS.ink }),
        cellXml('', { width: widths[1], vMerge: 'continue', fill: COLORS.ink }),
        cellXml('Deficiente', { width: widths[2], fill: COLORS.red, color: 'FFFFFF', bold: true, align: 'center' }),
        cellXml('Regular', { width: widths[3], fill: COLORS.orange, color: 'FFFFFF', bold: true, align: 'center' }),
        cellXml('Bueno', { width: widths[4], fill: COLORS.green, color: 'FFFFFF', bold: true, align: 'center' }),
        cellXml('Muy bueno', { width: widths[5], fill: COLORS.cyan, color: 'FFFFFF', bold: true, align: 'center' })
    ], { repeat: true })];
    let number = 0;
    groupRows(rows).forEach((competence) => {
        tableRows.push(rowXml([cellXml(competence.name, { width: targetWidth, gridSpan: 6, fill: COLORS.competence, bold: true })]));
        competence.capacities.forEach((capacity) => {
            tableRows.push(rowXml([cellXml(capacity.name, { width: targetWidth, gridSpan: 6, fill: COLORS.capacity, bold: true })]));
            capacity.rows.forEach((item) => {
                number += 1;
                const values = [String(number), item.criterio, '', '', '', ''];
                tableRows.push(rowXml(values.map((text, col) => cellXml(text, {
                    width: widths[col], align: col === 0 ? 'center' : 'left', marginTop: 85, marginBottom: 85
                }))));
            });
        });
    });
    return tableXml(widths, tableRows);
};

const buildGuideTable = (competence, students, targetWidth) => {
    const criteria = competence.capacities.flatMap((capacity) => capacity.rows.map((row) => ({ capacity, row }))).slice(0, 16);
    const numberWidth = criteria.length > 8 ? 480 : 420;
    const nameWidth = criteria.length > 8 ? 2200 : 1700;
    const finalWidth = criteria.length > 8 ? 650 : 740;
    const levelWidth = Math.max(150, Math.floor((targetWidth - numberWidth - nameWidth - finalWidth) / Math.max(criteria.length * 4, 4)));
    const widths = [numberWidth, nameWidth, ...Array.from({ length: criteria.length * 4 }, () => levelWidth), finalWidth];
    const used = widths.reduce((sum, width) => sum + width, 0);
    widths[1] += Math.max(0, targetWidth - used);
    const totalCriteriaCols = Math.max(4, criteria.length * 4);
    const header1 = [
        cellXml('N°', { width: widths[0], vMerge: 'restart', fill: COLORS.purple, color: 'FFFFFF', bold: true, align: 'center' }),
        cellXml('APELLIDOS Y NOMBRES', { width: widths[1], vMerge: 'restart', fill: COLORS.purple, color: 'FFFFFF', bold: true, align: 'center' }),
        cellXml(competence.name, { width: criteria.length * 4 * levelWidth, gridSpan: totalCriteriaCols, fill: COLORS.purple, color: 'FFFFFF', bold: true, align: 'center' }),
        cellXml('NL', { width: widths[widths.length - 1], vMerge: 'restart', fill: COLORS.purple, color: 'FFFFFF', bold: true, align: 'center' })
    ];
    const header2 = [
        cellXml('', { width: widths[0], vMerge: 'continue', fill: COLORS.purple }),
        cellXml('', { width: widths[1], vMerge: 'continue', fill: COLORS.purple })
    ];
    competence.capacities.forEach((capacity) => {
        const capCriteria = criteria.filter((item) => item.capacity === capacity);
        if (!capCriteria.length) return;
        header2.push(cellXml(capacity.name.toUpperCase(), {
            width: capCriteria.length * 4 * levelWidth, gridSpan: capCriteria.length * 4,
            fill: COLORS.purple, color: 'FFFFFF', bold: true, align: 'center'
        }));
    });
    header2.push(cellXml('', { width: widths[widths.length - 1], vMerge: 'continue', fill: COLORS.purple }));
    const header3 = [
        cellXml('', { width: widths[0], vMerge: 'continue', fill: COLORS.purple }),
        cellXml('', { width: widths[1], vMerge: 'continue', fill: COLORS.purple })
    ];
    criteria.forEach((item, index) => header3.push(cellXml(`C${index + 1}`, {
        width: levelWidth * 4, gridSpan: 4, fill: COLORS.purple, color: 'FFFFFF', bold: true, align: 'center'
    })));
    header3.push(cellXml('', { width: widths[widths.length - 1], vMerge: 'continue', fill: COLORS.purple }));
    const levelColors = [COLORS.red, COLORS.orange, COLORS.green, COLORS.cyan];
    const header4 = [cellXml('', { width: widths[0], fill: COLORS.purple }), cellXml('', { width: widths[1], fill: COLORS.purple })];
    criteria.forEach(() => ['C', 'B', 'A', 'AD'].forEach((label, idx) => header4.push(cellXml(label, {
        width: levelWidth, fill: levelColors[idx], color: 'FFFFFF', bold: true, align: 'center', marginLeft: 0, marginRight: 0
    }))));
    header4.push(cellXml('', { width: widths[widths.length - 1], fill: COLORS.purple }));
    const tableRows = [rowXml(header1, { repeat: true }), rowXml(header2, { repeat: true }), rowXml(header3, { repeat: true }), rowXml(header4, { repeat: true })];
    const roster = students.length ? students.slice(0, 35) : Array.from({ length: 6 }, () => ({ name: '' }));
    roster.forEach((student, index) => {
        const cells = [
            cellXml(String(index + 1), { width: widths[0], align: 'center', marginTop: 70, marginBottom: 70 }),
            cellXml(student.name || '', { width: widths[1], align: 'left', marginTop: 70, marginBottom: 70 })
        ];
        criteria.forEach(() => levelColors.forEach((color) => cells.push(cellXml('', {
            width: levelWidth, borderColor: color, borderSize: 8, marginLeft: 0, marginRight: 0, marginTop: 70, marginBottom: 70
        }))));
        cells.push(cellXml('', { width: widths[widths.length - 1], align: 'center' }));
        tableRows.push(rowXml(cells));
    });
    return tableXml(widths, tableRows);
};

const buildGuide = (rows, students, targetWidth) => groupRows(rows).map((competence) => buildGuideTable(competence, students, targetWidth)).join('');

const buildInstrumentBlock = (sessionData = {}, students = [], options = {}) => {
    const type = detectInstrumentType(sessionData);
    const rows = getInstrumentRows(sessionData);
    const targetWidth = Math.max(1, Number(options.targetWidth || 9360));
    const body = type === 'lista_cotejo'
        ? buildChecklist(rows, targetWidth)
        : type === 'escala_valoracion'
            ? buildScale(rows, targetWidth)
            : type === 'guia_observacion'
                ? buildGuide(rows, students, targetWidth)
                : buildRubric(rows, targetWidth);
    return body;
};

const replaceInstrumentToken = (documentXml, sessionData, students = []) => {
    const xml = String(documentXml || '');
    if (!xml.includes(INSTRUMENT_BLOCK_TOKEN)) return xml;
    const block = buildInstrumentBlock(sessionData, students, { targetWidth: usableWidthAtToken(xml) });
    const paragraphs = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
    const target = paragraphs.find((paragraph) => paragraph.includes(INSTRUMENT_BLOCK_TOKEN));
    if (!target) return xml.replace(INSTRUMENT_BLOCK_TOKEN, '');
    return xml.replace(target, `${block}<w:p/>`);
};

export {
    INSTRUMENT_BLOCK_TOKEN,
    buildInstrumentBlock,
    detectInstrumentType,
    getInstrumentTitleText,
    getInstrumentRows,
    replaceInstrumentToken
};
