import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PizZip from 'pizzip';
import { buildInstrumentBlock } from '../backend/routes/sessionWordBlocks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputPath = path.resolve(__dirname, '..', 'artifacts', 'Guia_etiquetas_recursos_e_instrumentos_sesion.docx');

const escapeXml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const run = (text, { size = 20, color = '172033', bold = false, font = 'Arial' } = {}) => (
    `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/>`
    + `<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`
    + `${bold ? '<w:b/><w:bCs/>' : ''}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
);

const paragraph = (text = '', options = {}) => {
    const align = options.align || 'left';
    return `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="${options.before || 0}" w:after="${options.after ?? 80}" w:line="276" w:lineRule="auto"/></w:pPr>${run(text, options)}</w:p>`;
};

const border = (color = 'C7D3E3') => ['top', 'left', 'bottom', 'right']
    .map((name) => `<w:${name} w:val="single" w:sz="6" w:space="0" w:color="${color}"/>`).join('');

const cell = (text, { width, fill = 'FFFFFF', color = '172033', bold = false, font = 'Arial', size = 18 } = {}) => (
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:fill="${fill}"/>`
    + `<w:tcBorders>${border(fill === 'FFFFFF' ? 'C7D3E3' : 'D8C6F5')}</w:tcBorders><w:vAlign w:val="center"/>`
    + '<w:tcMar><w:top w:w="90" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>'
    + paragraph(text, { color, bold, font, size, after: 0 }) + '</w:tc>'
);

const twoColumnTag = (tag, description) => (
    '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>'
    + '<w:tblGrid><w:gridCol w:w="4200"/><w:gridCol w:w="5160"/></w:tblGrid><w:tr>'
    + cell(tag, { width: 4200, fill: 'F3E8FF', color: '6D28D9', bold: true, font: 'Consolas', size: 18 })
    + cell(description, { width: 5160, size: 18 })
    + '</w:tr></w:tbl>' + paragraph('', { after: 30 })
);

const pageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

const sectionBreak = ({ width, height, orient = '' }) => (
    '<w:p><w:pPr><w:sectPr>'
    + `<w:pgSz w:w="${width}" w:h="${height}"${orient ? ` w:orient="${orient}"` : ''}/>`
    + '<w:pgMar w:top="504" w:right="504" w:bottom="504" w:left="504" w:header="288" w:footer="288" w:gutter="0"/>'
    + '<w:type w:val="nextPage"/></w:sectPr></w:pPr></w:p>'
);

const session = (type, rows) => ({
    instrumentoTemplate: { type, name: type },
    competenciaPrio: { comp: 'Competencia 1', cap: 'Capacidad 1', inst: type },
    instrumento: rows
});

const scaleRows = [
    { competencia: 'Competencia 1', capacidad: 'Capacidad 1', criterio: 'Criterio 1' },
    { competencia: 'Competencia 1', capacidad: 'Capacidad 1', criterio: 'Criterio 2' },
    { competencia: 'Competencia 1', capacidad: 'Capacidad 2', criterio: 'Criterio 1' },
    { competencia: 'Competencia 1', capacidad: 'Capacidad 2', criterio: 'Criterio 2' }
];

const checklistRows = Array.from({ length: 6 }, (_, index) => ({
    competencia: 'Competencia 1',
    capacidad: `Capacidad ${Math.floor(index / 3) + 1}`,
    criterio: `Criterio ${(index % 3) + 1}`
}));

const rubricRows = Array.from({ length: 4 }, (_, index) => ({
    criterio: `Criterio ${index + 1}`,
    c: 'Descriptor Inicio',
    b: 'Descriptor Proceso',
    a: 'Descriptor Logrado',
    ad: 'Descriptor Destacado'
}));

const guideRows = Array.from({ length: 16 }, (_, index) => ({
    competencia: 'Competencia 1',
    capacidad: `Capacidad ${Math.floor(index / 4) + 1}`,
    criterio: `Criterio ${index + 1}`
}));

const guidePage = [
    paragraph('Etiquetas de recursos e instrumentos', { size: 40, color: '6D28D9', bold: true, after: 80 }),
    paragraph('Plantilla de sesión de aprendizaje · guía lista para copiar', { size: 22, color: '64748B', after: 180 }),
    paragraph('Usa una sola etiqueta para construir todo el instrumento. El generador detecta el tipo seleccionado y crea la tabla completa con fuente Arial de 8 pt.', { size: 20, after: 120 }),
    paragraph('Etiqueta única del instrumento', { size: 26, bold: true, after: 70 }),
    twoColumnTag('<<instrumento_evaluacion>>', 'Construye Rúbrica, Lista de cotejo, Escala de valoración o Guía de observación.'),
    paragraph('Etiquetas mínimas de los recursos', { size: 26, bold: true, after: 70 }),
    twoColumnTag('<<%recurso_instructivo_imagen>>', 'Inserta la imagen del instructivo informativo.'),
    twoColumnTag('<<%anexo_1_imagen>>', 'Inserta la imagen o miniatura del Anexo 1.'),
    twoColumnTag('<<anexo_1_datos>>', 'Título, tipo, enlace y justificación; en YouTube incluye la URL verificada.'),
    twoColumnTag('<<%anexo_2_imagen>>', 'Inserta la imagen del Anexo 2.'),
    twoColumnTag('<<anexo_2_datos>>', 'Título, tipo, evidencia/entregable y enlace TIC cuando exista.'),
    paragraph('Etiquetas atómicas opcionales', { size: 26, bold: true, after: 70 }),
    paragraph('Anexo 1: <<anexo_1_tipo>>, <<anexo_1_titulo>>, <<anexo_1_enlace>>.', { size: 18, font: 'Consolas', after: 30 }),
    paragraph('Anexo 2: <<anexo_2_tipo>>, <<anexo_2_titulo>>, <<anexo_2_enlace>>, <<anexo_2_evidencia>>.', { size: 18, font: 'Consolas', after: 70 }),
    paragraph('Si un recurso no existe, su imagen y sus datos quedan vacíos; el generador no inventa contenido.', { size: 18, color: '64748B' })
].join('');

const documentBody = [
    guidePage,
    sectionBreak({ width: 12240, height: 15840 }),
    buildInstrumentBlock(session('escala_valoracion', scaleRows)),
    pageBreak(),
    buildInstrumentBlock(session('lista_cotejo', checklistRows)),
    pageBreak(),
    buildInstrumentBlock(session('rubrica', rubricRows)),
    sectionBreak({ width: 15840, height: 12240, orient: 'landscape' }),
    buildInstrumentBlock(session('guia_observacion', guideRows), Array.from({ length: 6 }, () => ({ name: '' }))),
    '<w:sectPr><w:pgSz w:w="20160" w:h="12240" w:orient="landscape"/><w:pgMar w:top="360" w:right="360" w:bottom="360" w:left="360" w:header="288" w:footer="288" w:gutter="0"/></w:sectPr>'
].join('');

const zip = new PizZip();
zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="70" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`);
zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${documentBody}</w:body></w:document>`);
zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Guía de etiquetas de recursos e instrumentos de sesión</dc:title><dc:creator>ARMI Docente</dc:creator><cp:keywords>sesión, instrumentos, etiquetas, recursos, Word</cp:keywords></cp:coreProperties>`);
zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>ARMI Docente</Application></Properties>`);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(outputPath);
