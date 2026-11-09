import {TEMPLATE_BOUND_MAX_BYTES} from './evidenceTemplateContract.js';
import {evidenceBotErrors} from './evidenceTemplateBots.js';
const key=value=>String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\.(png|jpe?g|gif|webp|svg)$/,'').replace(/_/g,'-');
export function bindEvidenceTemplateImages(html,images=[]) {
  const errors=evidenceBotErrors(html,images.map(i=>i.name));
  if(errors.length)throw new Error(errors.join(' '));
  const result=String(html).replace(/<!--[\s\S]*?-->|<(?:style|template|noscript)\b[^>]*>[\s\S]*?<\/(?:style|template|noscript)>|<img\b[^>]*>/gi,tag=>{
    if(!/^<img\b/i.test(tag))return tag;
    const name=tag.match(/\bdata-armi-image\s*=\s*["']([^"']+)["']/i)?.[1];
    const image=images.find(i=>key(i.name)===key(name));
    if(!image){if(/\bsrc\s*=\s*["']data:image\//i.test(tag))return tag;throw new Error(`La imagen ${name || ''} no está en la biblioteca de ARMI. Actualiza el prompt y usa un nombre disponible.`);}
    return tag.replace(/\s+src\s*=\s*["'][^"']*["']/gi,'').replace(/\s*\/?>$/,` src="${image.dataUrl}">`);
  });
  if(Buffer.byteLength(result)>TEMPLATE_BOUND_MAX_BYTES)throw new Error('La plantilla con el bot supera 2 MB. Usa menos imágenes.');
  return result;
}
