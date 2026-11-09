import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { uploadsRoot, ensureDir } from './paths.js';

export const practiceImagesRoot = path.join(uploadsRoot, 'user-assets', 'practice');
export const MAX_PRACTICE_HTML_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const formats = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const keyFor = (name) => path.parse(name).name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/_/g, '-');

export async function readPracticeImages(root = practiceImagesRoot) {
  ensureDir(root);
  const images = [];
  const warnings = [];
  const keys = new Set();
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !formats[path.extname(entry.name).toLowerCase()]) continue;
    try {
      if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*\.(jpg|jpeg|png|gif|svg|webp)$/iu.test(entry.name)) throw new Error('Usa nombres sin espacios.');
      const file = path.join(root, entry.name);
      if (fs.statSync(file).size > MAX_IMAGE_BYTES) throw new Error('Supera 2 MB por imagen.');
      const bytes = fs.readFileSync(file);
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.svg') {
        const svg = bytes.toString('utf8');
        if (!/<svg[\s>]/i.test(svg) || /<(?:script|foreignObject|iframe|object|embed|image|use)\b|\bon\w+\s*=|(?:href|src)\s*=|<!ENTITY|<!DOCTYPE|@import|url\s*\(/i.test(svg)) throw new Error('SVG con contenido activo o referencias externas.');
      } else {
        const metadata = await sharp(bytes, { animated: true, limitInputPixels: 40_000_000 }).metadata();
        const expected = ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : ext.slice(1);
        if (metadata.format !== expected) throw new Error('El contenido no coincide con la extensión.');
      }
      const key = keyFor(entry.name);
      if (keys.has(key)) throw new Error('Nombre de estado duplicado: conserva un solo formato por nombre.');
      keys.add(key);
      images.push({ name: entry.name, key, dataUrl: `data:${formats[ext]};base64,${bytes.toString('base64')}` });
    } catch (error) { warnings.push(`${entry.name}: ${error.message}`); }
  }
  return { images, warnings, folder: root };
}

export async function bindPracticeImages(html, root = practiceImagesRoot) {
  if (Buffer.byteLength(String(html || ''), 'utf8') > MAX_PRACTICE_HTML_BYTES) throw new Error('El HTML supera 8 MB.');
  // Only embed states referenced by the activity, keeping large libraries out of each HTML.
  const requested = new Set([...String(html).matchAll(/data-armi-image\s*=\s*["']([\p{L}\p{N}_.-]+)["']/giu)].map((m) => keyFor(m[1].includes('.') ? m[1] : `${m[1]}.png`)));
  const library = await readPracticeImages(root);
  const selected = library.images.filter((image) => requested.has(image.key));
  const missing = [...requested].filter((key) => !selected.some((image) => image.key === key));
  if (missing.length) throw new Error(`Faltan imágenes válidas en la biblioteca: ${missing.join(', ')}. ${library.warnings.join(' ')}`);
  if (!selected.length) return {
    html,
    warnings: [...library.warnings, ...(library.images.length ? ['El HTML no utiliza imágenes de la biblioteca de ARMI. Copia el prompt actualizado y solicita incluir el personaje guía mediante data-armi-image; luego vuelve a importar el archivo.'] : [])],
    embedded: []
  };
  if (!/<head[\s>]/i.test(html)) throw new Error('Falta <head> para incorporar las imágenes al HTML.');
  const mapping = Object.fromEntries(selected.map((image) => [image.key, image.dataUrl]));
  const script = `<script data-armi-image-library>(function(){const images=${JSON.stringify(mapping)};function update(el){if(!el.matches||!el.matches('img[data-armi-image]'))return;const key=(el.getAttribute('data-armi-image')||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/\\.(jpg|jpeg|png|gif|svg|webp)$/,'').replace(/_/g,'-');if(images[key]&&el.getAttribute('src')!==images[key])el.setAttribute('src',images[key]);}function scan(node){update(node);if(node.querySelectorAll)node.querySelectorAll('img[data-armi-image]').forEach(update);}new MutationObserver(function(records){records.forEach(function(r){if(r.type==='attributes')update(r.target);else r.addedNodes.forEach(scan);});}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-armi-image']});scan(document.documentElement);})();</script>`;
  // Replace our previous binding when an activity is imported again.
  const clean = String(html).replace(/<script\b[^>]*data-armi-image-library[^>]*>[\s\S]*?<\/script>/gi, '');
  const bound = clean.replace(/<head([^>]*)>/i, `<head$1>${script}`);
  if (Buffer.byteLength(bound, 'utf8') > MAX_PRACTICE_HTML_BYTES) throw new Error('El HTML con sus imágenes supera 8 MB. Reduce el tamaño de las imágenes.');
  return { html: bound, warnings: library.warnings, embedded: selected.map((image) => image.name) };
}
