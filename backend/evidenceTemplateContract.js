// Shared, declarative contract: imported templates contain presentation and native
// form fields only. ARMI injects its own trusted editing bridge at runtime.
import {templateEvidenceBrief} from './evidenceTemplatePedagogy.js';
import {recommendEvidenceBots} from './evidenceTemplateBots.js';
export const TEMPLATE_MAX_BYTES = 512 * 1024;
export const TEMPLATE_BOUND_MAX_BYTES = 2 * 1024 * 1024;
export const templateFields = html => [...String(html).matchAll(/<(input|textarea|select|canvas)\b([^>]*)>/gi)].map(match => {
  const attrs = match[2];
  const attr = name => attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] || '';
  return { id: attr('data-armi-field'), label: attr('aria-label') || attr('data-armi-field'), tag: match[1].toLowerCase(), type: attr('type').toLowerCase() };
});
export function validateEvidenceTemplate(html) {
  const text = String(html || '');
  const errors = [];
  const markup = text.replace(/<img\b[^>]*>/gi, tag => {
    const src=tag.match(/\bsrc\s*=\s*["']([^"']*)["']/i)?.[1];
    if (!/\bdata-armi-image\s*=\s*["'][\p{L}\p{N}_.-]+["']/iu.test(tag) || (src && !/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(src))) errors.push('Las imágenes deben usar data-armi-image de la biblioteca de ARMI.');
    return tag.replace(/\bsrc\s*=\s*["'][^"']*["']/gi,'');
  });
  if (new TextEncoder().encode(markup).length > TEMPLATE_MAX_BYTES || new TextEncoder().encode(text).length > TEMPLATE_BOUND_MAX_BYTES) errors.push('La plantilla supera 512 KB de estructura o 2 MB con imágenes.');
  if (!/<html[\s>]/i.test(text) || !/<\/html>/i.test(text) || !/<head[\s>]/i.test(text) || !/<\/head>/i.test(text) || !/<body[\s>]/i.test(text) || !/<\/body>/i.test(text)) errors.push('Se requiere un HTML completo con head y body.');
  if (!/<meta\s+name=["']armi-evidence-version["']\s+content=["']1["']\s*\/?>/i.test(text)) errors.push('Falta el identificador armi-evidence-version 1. Usa el prompt de ARMI.');
  if (/<\s*\/?\s*(script|iframe|object|embed|base|link|svg|math|foreignobject|meta(?=\s+http-equiv))\b/i.test(text)
    || /<meta\b[^>]*\bhttp-equiv\s*=/i.test(text)
    || /\bon[a-z]+\s*=/i.test(markup) || /\b(?:src|href|action|formaction|srcdoc|contenteditable|autofocus)\s*=/i.test(markup)
    || /(?:@import|url\s*\(|javascript\s*:|expression\s*\()/i.test(text)) errors.push('Usa solamente HTML y CSS internos, sin scripts, enlaces, imágenes externas ni conexiones.');
  const fields = templateFields(text);
  if (!fields.length || fields.length > 80) errors.push('Incluye entre 1 y 80 campos editables.');
  const ids = new Set();
  for (const field of fields) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(field.id) || ids.has(field.id)) errors.push('Cada campo necesita un data-armi-field único, estable y en minúsculas.');
    if (field.tag === 'input' && !['', 'text', 'number', 'date', 'checkbox'].includes(field.type)) errors.push('Solo se admiten campos de texto, número, fecha, casilla, textarea y select.');
    ids.add(field.id);
  }
  if(/<(?:input|textarea|select|canvas)\b[^>]*\bdata-armi-meta\s*=/i.test(text))errors.push('Equipo, fecha y versión deben mostrarse en span, strong u otro texto no editable.');
  return { valid: !errors.length, errors: [...new Set(errors)], fields };
}
export function ensureTemplateHeader(html, color='#334155') {
  const fields=templateFields(html), missing=[];
  if(!fields.some(f=>f.id==='project_name'))missing.push('<label style="min-width:0">Nombre del proyecto<input type="text" data-armi-field="project_name" aria-label="Nombre del proyecto" maxlength="180" style="width:100%;box-sizing:border-box"></label>');
  for(const [key,label] of [['team','Equipo / grupo'],['date','Fecha'],['version','Versión']])if(!new RegExp(`data-armi-meta\\s*=\\s*["']${key}["']`,'i').test(html))missing.push(`<div>${label}: <strong data-armi-meta="${key}"></strong></div>`);
  if(!fields.some(f=>f.id==='observations'))missing.push('<label style="grid-column:1/-1;min-width:0">Observaciones y dificultades<textarea data-armi-field="observations" aria-label="Observaciones y dificultades" rows="2" style="width:100%;box-sizing:border-box;min-height:48px"></textarea></label>');
  if(!missing.length)return html;
  const accent=/^#[a-f0-9]{6}$/i.test(color)?color:'#334155';
  return String(html).replace(/<body([^>]*)>/i,`<body$1><header data-armi-system-header style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;border:1px solid ${accent};border-left:4px solid ${accent};border-radius:12px;padding:12px;margin:0 0 18px;font:13px system-ui;color:#334155;background:#fff">${missing.join('')}</header>`);
}
const commonPrompt=context=>`CONTEXTO COMÚN
Sesión: ${context.title || ''}. Grado: ${context.grade || ''}.
Propósito: ${String(context.purpose || '').replace(/<[^>]*>/g,' ')}.
Situación de aprendizaje: ${context.situation || 'No consignada; no inventes otro contexto.'}
Actividades realmente previstas:
${context.plannedActivities?.length?context.plannedActivities.map(item=>`${item.label}: ${item.text}`).join('\n'):'No consignadas; limita el alcance al producto y criterio disponibles.'}
Tiempo de proceso consignado: ${context.processTime || 'No especificado'}. No inventes minutos ni amplíes las tareas para llenar el tiempo.
ALINEAMIENTO Y ALCANCE:
Cada evidencia, criterio y secuencia delimitan lo que se debe construir en ESTA clase. No añadas fases de otras sesiones. Mantén la modalidad seleccionada para cada archivo: trabajar en equipos en la secuencia no autoriza cambiar una evidencia individual a grupal. Cuando la evidencia y la secuencia difieran entre aplicación real y ensayo/preparación, distingue ambos registros de forma visible; nunca inventes datos ni declares realizada una actividad solo planificada. La plantilla puede registrar un ensayo sin presentarlo como una aplicación real completada.
Diseña LIENZOS DE TRABAJO, no formularios verticales extensos ni cuestionarios. Deja respuestas vacías, instrucciones de una o dos frases y el mínimo de campos para demostrar el criterio. Orientación práctica: 8 a 14 campos de producto, o menos si basta; no es una cuota que debas completar. El límite técnico de 80 NO es una recomendación de cantidad.
COMPOSICIÓN VISUAL OBLIGATORIA, inspirada en fichas de técnicas de diseño:
1. Una lámina principal, preferentemente apaisada en escritorio (ancho aproximado 1100–1280 px), fondo blanco, líneas finas y un borde exterior claro.
2. Cabecera compacta: a la izquierda, bot pequeño, título de la técnica y objetivo en una frase; a la derecha, un recuadro con Proyecto, Equipo, Fecha, Versión y Observaciones. Observaciones pertenece al encabezado, no a una sección final. En móvil estos dos bloques se apilan.
3. El cuerpo debe ocupar la mayor parte de la lámina: matriz, columnas, zonas o notas según el producto. Mantén juntas las celdas relacionadas; no repitas tarjetas con el mismo cuestionario. Evita banners de color de gran altura, metadatos repartidos en tarjetas grandes, portada introductoria y largos pasos numerados.
4. Usa los colores de la competencia como acentos, sin rellenar grandes superficies. Cada técnica conserva su morfología: las referencias visuales no autorizan sustituir una entrevista por cinco porqués u otra técnica. No agregues dibujos si el producto no los necesita.
5. Ajusta a móvil sin desplazamiento horizontal; cada fila debe mantener su relación y sus etiquetas al apilarse. No comprimas ilegiblemente los campos para fingir que todo cabe en una pantalla. Reserva lugar para los controles de autoría y guardado de ARMI.
ENCABEZADO OBLIGATORIO EN CADA ARCHIVO (puedes reorganizar visualmente estos datos):
- Nombre del proyecto: <input type="text" data-armi-field="project_name" aria-label="Nombre del proyecto" maxlength="180">. ARMI recuerda el nombre para futuras plantillas del mismo estudiante o equipo y área durante el año académico, incluso en otras sesiones y unidades. Si cambia el proyecto, el estudiante puede modificarlo; los trabajos anteriores conservan su nombre original. No inventes su valor.
- Equipo / grupo: <span data-armi-meta="team"></span>. ARMI lo completa desde el grupo real; no es editable.
- Fecha: <span data-armi-meta="date"></span>. ARMI registra el día real de trabajo y lo actualiza cuando se guarda una edición en otro día. No fijes una fecha en el HTML.
- Versión: <span data-armi-meta="version"></span>. ARMI comienza en 1.0 y la incrementa automáticamente con las modificaciones. No la calcules ni permitas escribirla.
- Observaciones y dificultades: <textarea data-armi-field="observations" aria-label="Observaciones y dificultades" rows="2"></textarea>, editable por el estudiante.
Puedes agregar título de la técnica, objetivo breve e instrucciones. No incluyas QR, logotipos ni enlaces ajenos.
CONTRATO TÉCNICO PARA TODOS LOS ARCHIVOS:
HTML completo con head, body y <meta name="armi-evidence-version" content="1">. CSS interno. Sin JavaScript, scripts, SVG, iframes, conexiones, enlaces, formularios con action, contenteditable ni botones propios de guardado, borrado o entrega: ARMI aporta esas funciones.
Cada espacio editable debe ser input (text, number, date, checkbox), textarea, select o canvas. TODOS tienen data-armi-field="identificador-unico-estable" y aria-label="Descripción comprensible". Máximo 80 campos, incluidos project_name y observations. No repitas identificadores dentro de un archivo.
Cuando el producto requiera bocetos, esquemas o dibujo a mano, incluye <canvas data-armi-field="boceto" aria-label="Boceto de la propuesta" width="960" height="480" style="width:100%;height:auto;border:1px solid #cbd5e1;touch-action:none"></canvas>. ARMI añade lápiz, colores, deshacer, guardado e identificación del autor; no programes el dibujo. Combina dibujo y texto solo cuando sea pertinente.
Ejemplo de texto: <label>Necesidades<textarea data-armi-field="necesidades" aria-label="Necesidades detectadas" rows="4"></textarea></label>. Divide los productos en bloques significativos para permitir trabajo simultáneo. No solicites nombres, DNI ni contraseñas. Sin position:fixed. Menos de 512 KB de estructura.
BOT DE ARMI:
${context.imageNames?.some(name=>/^bot[-_]/i.test(name)) ? `Estados reales del bot disponibles: ${context.imageNames.filter(name=>/^bot[-_]/i.test(name)).join(', ')}. Selecciona el estado contextual indicado para cada archivo, no una imagen fija para todas las evidencias. Inclúyelo discretamente en el encabezado mediante img con data-armi-image, usando el ejemplo concreto de su archivo. No uses src ni base64: ARMI incorpora la imagen al importar. No inventes rutas ni estados.` : 'No hay estados del bot disponibles en la biblioteca. No inventes archivos, rutas ni un bot sustituto.'}`;
const evidenceInstructions=(evidence,context,index)=>{const brief=templateEvidenceBrief(evidence,context),bot=recommendEvidenceBots(evidence,context.imageNames || []);return `ARCHIVO ${index}: evidencia-${index}.html
Evidencia: ${evidence.text}.
Competencia: ${evidence.competency}. Tipo: ${evidence.source==='transversal'?'transversal':'área'}.
Color de esta competencia: ${evidence.color || '#334155'}; úsalo en bordes, acentos y encabezados con contraste legible.
Modalidad: ${context.mode==='group'?'grupal: varios estudiantes trabajan en distintos bloques del mismo producto':'individual'}.
Criterio(s) específico(s) de esta competencia:
${brief.criteria.length?brief.criteria.map(row=>`- ${row.criterion}\n  Capacidad: ${row.capacity}. Campo temático: ${row.field || 'No consignado'}.`).join('\n'):'No consignados; no inventes criterios ni calificaciones.'}
ESTRUCTURA DEL PRODUCTO: ${brief.layout}
ALCANCE Y LÍMITES: ${brief.essentials}
BOT PARA ESTA EVIDENCIA:
${bot.name?`Estado recomendado: ${bot.name}, adecuado para ${bot.reason}. Alternativas reales: ${bot.alternatives.join(', ') || 'ninguna adicional'}.
Incluye obligatoriamente en la cabecera esta etiqueta visible: <img data-armi-image="${bot.name}" alt="Bot de ARMI: ${bot.reason}" style="width:64px;height:72px;object-fit:contain">. Puedes escoger una de las alternativas reales si encaja mejor; no uses siempre bot_atento por costumbre ni cambies una técnica solo para variar el personaje. No fuerces imágenes distintas si dos evidencias requieren el mismo estado.
El marcador debe ser una imagen real en el HTML: ni un div bot-slot, ni el texto “bot”, ni un comentario, ni un elemento oculto. No agregues una galería de estados ni imágenes decorativas innecesarias. ARMI incorporará únicamente las imágenes referenciadas al importar.`:'No hay estados del bot disponibles: no inventes nombres ni sustituyas al personaje por emojis.'}
Antes de entregar, verifica: producto exacto de la sesión, criterio observable, ausencia de tareas extra, cabecera compacta con los cinco datos, bot real cuando esté disponible, y cuerpo visual de la técnica. No conviertas el resultado en un formulario administrativo.`;};
export function evidenceTemplatePrompt(evidence, context = {}) {
  return `Genera un archivo HTML independiente listo para importar en ARMI Docente. Entrega el archivo, sin explicaciones.\n\n${commonPrompt(context)}\n\n${evidenceInstructions(evidence,context,context.fileNumber || 1)}`;
}
export function combinedEvidenceTemplatePrompt(evidences,context={},settings={}) {
  return `Genera ${evidences.length} archivos HTML independientes, uno por cada evidencia detallada al final. Entrega ${evidences.length} archivos separados y descargables (evidencia-1.html, evidencia-2.html, etc.). No combines las plantillas en una sola página ni omitas archivos. Las reglas y el contexto comunes siguientes aplican a TODOS los archivos; no necesitas repetir su explicación. Cada archivo debe funcionar por sí mismo dentro de ARMI.\n\n${commonPrompt(context)}\n\n${evidences.map((e,index)=>evidenceInstructions(e,{...context,mode:settings[e.id]?.mode || 'individual'},index+1)).join('\n\n')}`;
}
