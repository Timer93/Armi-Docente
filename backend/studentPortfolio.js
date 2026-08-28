import fs from 'fs';
import path from 'path';
import { ZipArchive } from 'archiver';
import PDFDocument from 'pdfkit';

const COLORS = {
  ink: '#172033',
  muted: '#667085',
  violet: '#6D28D9',
  blue: '#2563EB',
  emerald: '#059669',
  pale: '#F6F3FF',
  border: '#DCE3EE'
};

export const portfolioSafeSegment = (value, fallback = 'SIN_DATO') => String(value || fallback)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .toUpperCase() || fallback;

const evidenceFormat = (row) => {
  const extension = path.extname(String(row?.file_name || '')).slice(1).toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) return 'IMAGEN';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'].includes(extension)) return 'VIDEO';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(extension)) return 'AUDIO';
  if (extension === 'pdf') return 'PDF';
  if (['doc', 'docx', 'odt'].includes(extension)) return 'DOCUMENTO';
  if (['xls', 'xlsx', 'ods'].includes(extension)) return 'HOJA_CALCULO';
  if (['ppt', 'pptx', 'odp'].includes(extension)) return 'PRESENTACION';
  return 'ARCHIVO';
};

export const buildPortfolioFileName = (studentName, row, index = 1) => {
  const original = String(row?.file_name || 'evidencia');
  const extension = path.extname(original).toLowerCase();
  const base = [
    portfolioSafeSegment(studentName, 'ESTUDIANTE'),
    `UNIDAD_${portfolioSafeSegment(row?.unit_number, '0')}`,
    `SESION_${portfolioSafeSegment(row?.session_number, '0')}`,
    evidenceFormat(row),
    String(index).padStart(2, '0')
  ].join('_');
  return `${base}${extension}`;
};

const dispositionFileName = (name) => encodeURIComponent(name).replace(/['()]/g, escape).replace(/\*/g, '%2A');

export const streamPortfolioZip = ({ res, student, rows, resolveEvidenceFilePath }) => {
  const studentSlug = portfolioSafeSegment(student?.estudiantes || student?.name, 'ESTUDIANTE');
  const outputName = `${studentSlug}_PORTAFOLIO.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${outputName}"; filename*=UTF-8''${dispositionFileName(outputName)}`);

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on('warning', (error) => {
    if (error.code !== 'ENOENT') archive.emit('error', error);
  });
  archive.on('error', (error) => {
    if (!res.headersSent) res.status(500).json({ success: false, message: error.message });
    else res.destroy(error);
  });
  archive.pipe(res);

  let exported = 0;
  rows.forEach((row, index) => {
    const resolved = resolveEvidenceFilePath(row);
    if (!resolved || !fs.existsSync(resolved)) return;
    exported += 1;
    archive.file(resolved, { name: `${studentSlug}/${buildPortfolioFileName(student?.estudiantes || student?.name, row, index + 1)}` });
  });
  if (!exported) {
    archive.append('Aún no hay evidencias disponibles para exportar.\n', { name: `${studentSlug}/LEEME.txt` });
  }
  archive.finalize().catch((error) => res.destroy(error));
};

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const ensurePageSpace = (doc, required = 120) => {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + required <= bottom) return;
  doc.addPage();
};

const drawGradeBadges = (doc, feedback, x, y) => {
  const badges = [];
  if (feedback?.literalGrade) badges.push(`Literal: ${feedback.literalGrade}`);
  if (Number.isFinite(feedback?.numericScore)) badges.push(`Vigesimal: ${Number(feedback.numericScore).toFixed(1)}`);
  if (!badges.length) return y;
  doc.font('Helvetica-Bold').fontSize(8);
  let cursor = x;
  badges.forEach((label, index) => {
    const width = doc.widthOfString(label) + 18;
    doc.roundedRect(cursor, y, width, 20, 10).fill(index ? '#E8F8F2' : '#EEE8FF');
    doc.fillColor(index ? COLORS.emerald : COLORS.violet).text(label, cursor + 9, y + 6, { lineBreak: false });
    cursor += width + 7;
  });
  return y + 26;
};

export const streamPortfolioPdf = ({ res, student, rows, institution, feedbackBySession, resolveEvidenceFilePath }) => {
  const studentName = String(student?.estudiantes || student?.name || 'Estudiante');
  const outputName = `${portfolioSafeSegment(studentName, 'ESTUDIANTE')}_PORTAFOLIO.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${outputName}"; filename*=UTF-8''${dispositionFileName(outputName)}`);

  const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 42, right: 42, bottom: 46, left: 42 }, info: { Title: `Portafolio de ${studentName}`, Author: 'ARMI Docente' } });
  doc.on('error', (error) => res.destroy(error));
  doc.pipe(res);

  doc.roundedRect(42, 42, doc.page.width - 84, 136, 22).fill(COLORS.ink);
  doc.fillColor('#B9A5FF').font('Helvetica-Bold').fontSize(9).text('PORTAFOLIO VIRTUAL DE EVIDENCIAS', 65, 66, { characterSpacing: 1.5 });
  doc.fillColor('#FFFFFF').fontSize(25).text(studentName, 65, 88, { width: doc.page.width - 130 });
  doc.fillColor('#D9E2F0').font('Helvetica').fontSize(10).text(`${student?.grado || ''} · Sección ${student?.secc || ''}`, 65, 139);
  doc.fillColor(COLORS.muted).fontSize(9).text(String(institution || 'Institución educativa'), 42, 196);
  doc.text(`Generado: ${formatDate(new Date())}`, 42, 211);
  doc.moveDown(2);

  if (!rows.length) {
    doc.roundedRect(42, doc.y, doc.page.width - 84, 88, 16).fill(COLORS.pale);
    doc.fillColor(COLORS.violet).font('Helvetica-Bold').fontSize(14).text('Aún no hay evidencias para mostrar', 62, doc.y + 27);
    doc.end();
    return;
  }

  rows.forEach((row, index) => {
    ensurePageSpace(doc, 178);
    const startY = doc.y;
    const cardHeight = 158;
    const feedback = feedbackBySession.get(String(row.session_id)) || {};
    doc.roundedRect(42, startY, doc.page.width - 84, cardHeight, 16).fillAndStroke('#FFFFFF', COLORS.border);
    doc.roundedRect(54, startY + 14, 55, 22, 11).fill(index % 2 ? COLORS.blue : COLORS.violet);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8).text(`U${row.unit_number} · S${row.session_number}`, 64, startY + 21, { lineBreak: false });
    doc.fillColor(COLORS.ink).fontSize(13).text(String(row.session_title || 'Sesión de aprendizaje'), 120, startY + 16, { width: 410, height: 34, ellipsis: true });
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(`Versión ${row.version_number || 1} · ${formatDate(row.submitted_at || row.updated_at)}`, 120, startY + 48);

    const imagePath = resolveEvidenceFilePath(row);
    const extension = path.extname(String(row.file_name || '')).slice(1).toLowerCase();
    let textX = 64;
    let textWidth = doc.page.width - 128;
    if (imagePath && ['jpg', 'jpeg', 'png'].includes(extension)) {
      try {
        doc.image(imagePath, 54, startY + 66, { fit: [116, 76], align: 'center', valign: 'center' });
        textX = 184;
        textWidth = doc.page.width - 238;
      } catch {}
    }
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9).text(buildPortfolioFileName(studentName, row, index + 1), textX, startY + 70, { width: textWidth, height: 31, ellipsis: true });
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(`${evidenceFormat(row)} · ${Math.max(1, Math.round(Number(row.file_size || 0) / 1024))} KB`, textX, startY + 105, { width: textWidth });
    const badgeY = drawGradeBadges(doc, feedback, textX, startY + 121);
    if (feedback?.observation && badgeY < startY + cardHeight - 10) {
      doc.fillColor(COLORS.muted).fontSize(7).text(`Observación: ${feedback.observation}`, textX, badgeY, { width: textWidth, height: 18, ellipsis: true });
    }
    doc.y = startY + cardHeight + 14;
  });

  const pageRange = doc.bufferedPageRange();
  for (let page = pageRange.start; page < pageRange.start + pageRange.count; page += 1) {
    doc.switchToPage(page);
    doc.fillColor('#98A2B3').font('Helvetica').fontSize(7).text(
      `ARMI Docente · Página ${page + 1}`,
      42,
      doc.page.height - doc.page.margins.bottom - 10,
      { width: doc.page.width - 84, align: 'center', lineBreak: false }
    );
  }
  doc.end();
};
