import { buildPracticeBridge } from '../../backend/interactivePracticeRuntime.js';
export const ARMI_HTML_ACTIVITY_VERSION = 1;
export const MAX_INTERACTIVE_HTML_BYTES = 8 * 1024 * 1024;
export const MAX_INTERACTIVE_ACTIVITIES_PER_SESSION = 5;

export type InteractiveHtmlActivity = {
    id: string;
    title: string;
    fileName: string;
    html: string;
    criterionId: string;
    criterionText: string;
    mode: 'individual' | 'group';
    enabled: boolean;
    importedAt: string;
    validation: {
        valid: boolean;
        errors: string[];
        warnings: string[];
    };
};

export type InteractiveHtmlValidation = InteractiveHtmlActivity['validation'] & {
    title: string;
};

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

export const validateInteractiveHtml = (html: string): InteractiveHtmlValidation => {
    const source = String(html || '').trim();
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!source) errors.push('El archivo está vacío.');
    if (byteLength(source) > MAX_INTERACTIVE_HTML_BYTES) errors.push('El archivo supera 8 MB, incluyendo las imágenes.');
    if (!/<html[\s>]/i.test(source) || !/<\/html>/i.test(source)) errors.push('Falta la estructura HTML completa.');
    if (!/<header[\s>]/i.test(source)) errors.push('Falta la cabecera <header>.');
    if (!/<main[\s>]/i.test(source)) errors.push('Falta el cuerpo principal <main>.');
    if (!/<footer[\s>]/i.test(source)) errors.push('Falta el pie de página <footer>.');
    const compatibilityMeta = (source.match(/<meta\b[^>]*>/gi) || []).find((tag) =>
        /\bname\s*=\s*["']armi-activity-version["']/i.test(tag)
    );
    if (!compatibilityMeta || !/\bcontent\s*=\s*["']1["']/i.test(compatibilityMeta)) {
        errors.push('Falta el identificador de compatibilidad ARMI versión 1.');
    }
    if (!/armi:activity-result/i.test(source) || !/postMessage\s*\(/i.test(source)) {
        errors.push('La actividad no envía el resultado mediante el canal ARMI.');
    }
    if (/<(?:iframe|frame|object|embed|base)\b/i.test(source)) errors.push('No se permiten iframe, object, embed, frame ni base.');
    if (/<form\b[^>]*\baction\s*=/i.test(source)) errors.push('Los formularios no pueden enviar información fuera de ARMI.');
    if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(?/i.test(source)) errors.push('No se permiten conexiones de red desde la actividad.');
    if (/\b(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i.test(source)) errors.push('Todos los recursos deben estar incluidos dentro del HTML, sin enlaces externos.');
    if (/<script\b[^>]+src\s*=/i.test(source) || /<link\b[^>]+href\s*=/i.test(source)) errors.push('No se permiten scripts ni estilos externos.');
    if (!/<title>\s*[^<]+\s*<\/title>/i.test(source)) warnings.push('Conviene agregar un título dentro de <head>.');
    if (!/completed\s*:/i.test(source)) warnings.push('El resultado debería indicar completed: true.');
    if (!/maxScore\s*:/i.test(source)) warnings.push('Conviene enviar maxScore junto con score.');
    if (!/ARMI_PRACTICE\s*\.\s*register\s*\(/.test(source)) errors.push('Falta registrar el avance con ARMI_PRACTICE.register. Usa el nuevo prompt para permitir la continuación sin reiniciar.');
    const title = source.match(/<title>\s*([^<]+?)\s*<\/title>/i)?.[1]?.trim() || 'Actividad HTML interactiva';
    return { valid: errors.length === 0, errors, warnings, title };
};

const cleanPromptText = (value: unknown) => String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const buildPracticeImageInstructions = (imageNames: string[] = []) => {
    if (!imageNames.length) return `IMÁGENES PROPIAS
Disponibles: ninguna.
La biblioteca está vacía: usa CSS/SVG como alternativa, sin inventar nombres, rutas ni imágenes remotas.`;
    const names = imageNames.map((name) => name.replace(/\.(jpg|jpeg|png|gif|svg|webp)$/i, ''));
    const bots = names.filter((name) => /^bot[_-]/i.test(name));
    const candidates = bots.length ? bots : names;
    const choose = (...patterns: RegExp[]) => patterns.map((pattern) => candidates.find((name) => pattern.test(name))).find(Boolean) || candidates[0];
    const states = [
        ['bienvenida', choose(/saludando|presentando/i)],
        ['reto en curso', choose(/pensando|pensativo|atento/i)],
        ['acierto', choose(/celebrando|pulgar|aprobando/i)],
        ['error con ánimo para continuar', choose(/confundido|dudando|curioso/i)],
        ['resultado final', choose(/tarea[_-]completada|graduado/i, /celebrando/i)],
    ];
    const declarations = [...new Set(states.map(([, name]) => name))]
        .map((name) => `<img hidden data-armi-image="${name}" alt="">`).join('\n');
    return `IMÁGENES PROPIAS: USO OBLIGATORIO
Disponibles: ${imageNames.join(', ')}.
Debes mostrar ${bots.length ? 'el bot de ARMI como personaje guía' : 'las imágenes de la biblioteca'} en la bienvenida, durante los retos, en la retroalimentación y en el resultado final. No lo sustituyas por emojis ni por un personaje dibujado con CSS/SVG. Puedes usar CSS/SVG para escenarios y animar el personaje con CSS.
Estados recomendados con nombres reales disponibles:
${states.map(([role, name]) => `- ${role}: ${name}`).join('\n')}
Ejemplo de personaje visible (sin src):
<img id="armi-bot" data-armi-image="${states[0][1]}" alt="Guía de la actividad" style="width:160px;max-width:100%;height:auto;object-fit:contain">
ARMI incorpora las imágenes al importar el HTML. ChatGPT no necesita abrir archivos locales ni descargar imágenes. No uses src externo, rutas locales ni inventes nombres. Usa nombres sin extensión; guiones y guiones bajos son equivalentes.
Para cambiar de expresión usa document.getElementById('armi-bot').setAttribute('data-armi-image', '${states[2][1]}'). Conserva el personaje visible al reconstruir cada pantalla y restaura su expresión desde el estado guardado.
Declara además dentro de <body>, fuera del contenedor que reconstruyes, estos estados para que ARMI pueda incorporarlos aunque se usen dinámicamente:
${declarations}
Si eliges otros estados de la lista, añade una declaración oculta equivalente con el nombre real de cada estado. Las declaraciones ocultas no reemplazan al personaje visible.
Antes de entregar, comprueba que el HTML contiene el personaje visible y las declaraciones de todos los estados usados. No omitas las imágenes disponibles.`;
};

export const buildInteractiveHtmlPrompt = (context: {
    area: string;
    grade: string;
    sessionNumber: string;
    title: string;
    purpose: string;
    thematicField: string;
    competency: string;
    capacity: string;
    criterion: string;
    evidence: string;
    mode?: 'individual' | 'group';
    imageNames?: string[];
}) => `Crea un único archivo HTML educativo, autónomo y listo para importar en ARMI Docente.

CONTEXTO DE LA SESIÓN
- Área: ${cleanPromptText(context.area)}
- Grado: ${cleanPromptText(context.grade)}
- Sesión: ${cleanPromptText(context.sessionNumber)}
- Título: ${cleanPromptText(context.title)}
- Propósito: ${cleanPromptText(context.purpose)}
- Campo temático: ${cleanPromptText(context.thematicField)}
- Competencia: ${cleanPromptText(context.competency)}
- Capacidad: ${cleanPromptText(context.capacity)}
- Criterio que se evaluará: ${cleanPromptText(context.criterion)}
- Evidencia esperada: ${cleanPromptText(context.evidence)}
- Modalidad: ${context.mode === 'group' ? 'grupal; un resultado compartido por el grupo actual' : 'individual; un resultado por estudiante'}

OBJETIVO
Diseña una actividad lúdica y pedagógica apropiada para el grado y la modalidad indicada: puede ser reto, juego, simulación, rompecabezas, clasificación, preguntas con retroalimentación o resolución de problemas. Debe enseñar mientras se juega y producir una evaluación inmediata sobre 20 puntos.
Además debe ser animado a modo de videojuego con efectos visuales y sonoros, y debe incluir instrucciones claras para el estudiante.

CONTRATO OBLIGATORIO CON ARMI
1. Devuelve el archivo HTML, sin explicaciones ni bloques Markdown.
2. Incluye <!doctype html>, <html>, <head>, <body>, <header>, <main> y <footer>.
3. Dentro de <head> agrega exactamente: <meta name="armi-activity-version" content="1">.
4. Todo el CSS y JavaScript debe estar dentro del mismo archivo. No uses CDN, enlaces, scripts ni estilos externos.
5. No uses fetch, XMLHttpRequest, WebSocket, EventSource, iframe, object, embed, base ni formularios con action.
6. Debe funcionar sin Internet dentro del portal ARMI, en computadora de aula, con instrucciones claras y retroalimentación accesible. Nunca incluyas botones para reiniciar, repetir, borrar respuestas o volver al comienzo. Fuera de ARMI muestra “Abre esta práctica desde el portal del estudiante” y no permitas resolverla.
7. Aunque debe servir para evaluar su aprendizaje, no debe notarse como evaluacion sino como videojuego para el estudiante.
8. Conserva internamente las respuestas y calcula el puntaje, las alternativas no deben ser predecibles, solo pueden usarse una vez cuando amerite para evitar marcar al azar e ir probando una tars otra. Solo al finalizar envía una vez:

window.parent.postMessage({
  type: 'armi:activity-result',
  version: 1,
  completed: true,
  score: PUNTAJE_OBTENIDO,
  maxScore: 20,
  answersSummary: 'Resumen breve del desempeño, sin datos personales'
}, '*');

9. score y maxScore deben ser números. El resultado será validado nuevamente por ARMI; el HTML nunca debe pedir nombre, DNI, correo, contraseña ni otro dato personal.
10. Añade una cabecera con el título, un cuerpo con la actividad y un pie que diga “Actividad compatible con ARMI Docente”.
11. Evita mostrar la respuesta correcta antes de que el estudiante responda; después muestra retroalimentación y bloquea esa respuesta definitivamente.
12. Al finalizar, muestra dentro del HTML una pantalla de resultado visible, legible y persistente con "Tu puntaje: X/20", usando el mismo score y maxScore enviados a ARMI, más una breve retroalimentación; no basta con enviar postMessage ni escribir en consola. Identifícalo como resultado de la práctica, no como calificación docente, y no incluyas botones para repetir o reiniciar.

INTENTO ÚNICO Y RECUPERACIÓN (OBLIGATORIO)
- ARMI controla un primer periodo de 5 minutos y permite al estudiante una sola continuación de 5 minutos si no terminó. Continúa exactamente desde el último reto, sin repetir respuestas; finalizar o salir voluntariamente cierra el intento. No implementes otro reloj, reinicio ni ampliación propia: el reloj del portal es la autoridad y la interacción no lo reinicia.
- Mantén todo el estado en un único objeto serializable: reto actual, respuestas confirmadas y en edición, puntaje, orden aleatorio de preguntas/alternativas, piezas, posiciones y demás datos necesarios. Restaurarlo debe reconstruir la misma pantalla y los mismos bloqueos, sin volver a sortear ni evaluar respuestas otra vez.
- ARMI proporciona window.ARMI_PRACTICE; no lo declares ni reemplaces. Registra una vez, después de construir la interfaz:
window.ARMI_PRACTICE.register({
  getState: () => JSON.parse(JSON.stringify(estado)),
  restoreState: (guardado) => { estado = guardado; renderizar(); },
  getResult: () => ({ score: estado.puntaje, maxScore: 20, answersSummary: 'Resumen del avance actual' })
});
- Adapta esos nombres a tu juego y llama window.ARMI_PRACTICE.checkpoint() después de cada respuesta confirmada o cambio significativo. getResult debe incluir el avance parcial real; no uses datos personales, referencias DOM, funciones, temporizadores ni valores aleatorios nuevos dentro del estado guardado. Antes del mensaje final guarda el avance; después bloquea toda interacción.
- El portal muestra los avisos de salida, bloquea móviles y conserva el progreso. No intentes cerrar pestañas ajenas, bloquear el sistema operativo ni usar pantalla completa como una garantía contra copiar.
- Conserva el diseño de videojuego, las instrucciones, la retroalimentación y el contexto pedagógico anterior. No agregues dependencias ni conexiones externas. Si no hay imágenes propias, dibuja una alternativa con CSS/SVG, sin inventar rutas ni generar imágenes remotas.
${buildPracticeImageInstructions(context.imageNames)}`;

export const buildSandboxedHtml = (html: string) => {
    const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'">`;
    return /<head[\s>]/i.test(html)
        ? html.replace(/<head([^>]*)>/i, `<head$1>${policy}${buildPracticeBridge({ preview: true })}`)
        : `<!doctype html><html><head>${policy}${buildPracticeBridge({ preview: true })}</head><body>${html}</body></html>`;
};
