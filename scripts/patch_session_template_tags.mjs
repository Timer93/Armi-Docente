import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';

const templatePath = path.resolve('backend/templates/sesion_aprendizaje.docx');
const zip = new PizZip(fs.readFileSync(templatePath));
const documentFile = zip.file('word/document.xml');
if (!documentFile) throw new Error('La plantilla no contiene word/document.xml.');

let documentXml = documentFile.asText();

const titleParagraph = (tagName) => [
    '<w:p>',
    '<w:pPr>',
    '<w:pStyle w:val="Prrafodelista"/>',
    '<w:keepNext/>',
    '<w:spacing w:before="0" w:after="80" w:line="240" w:lineRule="auto"/>',
    '<w:jc w:val="center"/>',
    '</w:pPr>',
    '<w:r>',
    '<w:rPr>',
    '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>',
    '<w:i/>',
    '<w:color w:val="7030A0"/>',
    '<w:sz w:val="20"/><w:szCs w:val="20"/>',
    '<w:lang w:val="es-PE"/>',
    '</w:rPr>',
    `<w:t>&lt;&lt;${tagName}&gt;&gt;</w:t>`,
    '</w:r>',
    '</w:p>'
].join('');

const insertTitleBefore = (contentTag, titleTag) => {
    if (documentXml.includes(titleTag)) return;
    const contentIndex = documentXml.indexOf(contentTag);
    if (contentIndex < 0) throw new Error(`No se encontró la etiqueta ${contentTag}.`);
    const paragraphMatches = [...documentXml.slice(0, contentIndex).matchAll(/<w:p(?:\s|>)/g)];
    const paragraphStart = paragraphMatches.at(-1)?.index;
    if (!Number.isInteger(paragraphStart)) throw new Error(`No se encontró el párrafo de ${contentTag}.`);
    documentXml = `${documentXml.slice(0, paragraphStart)}${titleParagraph(titleTag)}${documentXml.slice(paragraphStart)}`;
};

insertTitleBefore('recurso_instructivo_imagen', 'recurso_instructivo_titulo');
insertTitleBefore('anexo_1_imagen', 'anexo_1_titulo');
insertTitleBefore('anexo_2_imagen', 'anexo_2_titulo');
insertTitleBefore('instrumento_evaluacion', 'instrumento_evaluacion_titulo');

zip.file('word/document.xml', documentXml);
fs.writeFileSync(templatePath, zip.generate({ type: 'nodebuffer' }));
