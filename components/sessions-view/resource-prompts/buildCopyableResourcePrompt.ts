import type {
    SessionLearningResource,
    SessionResourceKey
} from '../SessionLearningResources';
import type { SessionResourceAiContext } from './buildResourcePlanPrompt';

export const buildCopyableSessionResourcePrompt = (
    key: SessionResourceKey,
    resource: SessionLearningResource,
    context: SessionResourceAiContext
) => {

    const kindLabels: Record<string, string> = {
        informative: 'Ficha informativa',
        dynamic: 'Dinámica de motivación',
        youtube: 'Video de YouTube',
        collage: 'Observación de imágenes',
        questions: 'Preguntas desafiantes',
        worksheet: 'Ficha de trabajo',
        form: 'Formulario TIC',
        gamification: 'Actividad de gamificación',
        project: 'Reto o producto digital'
    };

    const aspectLabels: Record<string, string> = {
        '16:9': 'horizontal',
        '9:16': 'vertical',
        '1:1': 'cuadrada',
        '3:4': 'documento vertical'
    };

    const resourceName =
        key === 'instructive'
            ? 'INSTRUCTIVO'
            : key === 'annex1'
                ? 'ANEXO 1'
                : 'ANEXO 2';

    const subtype =
        kindLabels[resource.kind] ||
        String(resource.kind || 'Recurso educativo');

    const sessionLabel =
        `SESIÓN ${context.session || 1}/${Math.max(
            1,
            Number(context.sessionTotal || 1)
        )}`;

    const configuredAspect =
        `${resource.aspectRatio} · ${
            aspectLabels[resource.aspectRatio] || 'formato configurado'
        }`;

    /*
     * Datos comunes.
     * Se obtienen UNA sola vez desde buildResourceAiContext().
     * Cada recurso recibe únicamente lo que necesita.
     */
    const identificationBlock = `
Área: ${context.area || '-'}
Grado y sección: ${context.grade || '-'} · ${context.section || '-'}
Propósito: ${context.purpose || '-'}
`.trim();

    const curricularBlock = `
Competencia: ${context.competency || '-'}
Capacidad(es): ${context.capacity || '-'}
Criterio de evaluación: ${context.criterion || '-'}
Evidencia de aprendizaje: ${context.evidence || '-'}
`.trim();

    /*
     * Contexto privado diferente para cada recurso.
     * Evitamos enviar toda la secuencia didáctica tres veces.
     */
    const privateContext =
        key === 'instructive'
            ? `
Campo temático: ${context.thematicField || '-'}
Propósito: ${context.purpose || '-'}
Situación de aprendizaje: ${context.situation || '-'}
Criterio: ${context.criterion || '-'}
Evidencia: ${context.evidence || '-'}
`.trim()

            : key === 'annex1'
                ? `
Campo temático: ${context.thematicField || '-'}
Propósito: ${context.purpose || '-'}
Saberes previos: ${context.learningSequence?.priorKnowledge || '-'}
Conflicto cognitivo: ${context.learningSequence?.cognitiveConflict || '-'}
`.trim()

                : `
Campo temático: ${context.thematicField || '-'}
Propósito: ${context.purpose || '-'}
Criterio: ${context.criterion || '-'}
Evidencia: ${context.evidence || '-'}
Construcción del aprendizaje: ${context.learningSequence?.construction || '-'}
Aplicación: ${context.learningSequence?.application || '-'}
`.trim();

    const savedMetadata = resource.metadata || {};

    const savedMetadataLines = [
        savedMetadata.url
            ? `Enlace verificado: ${savedMetadata.url}`
            : '',
        savedMetadata.externalTitle
            ? `Título externo: ${savedMetadata.externalTitle}`
            : '',
        savedMetadata.authorName
            ? `Canal o autor: ${savedMetadata.authorName}`
            : '',
        savedMetadata.searchQuery
            ? `Consulta de búsqueda: ${savedMetadata.searchQuery}`
            : '',
        Array.isArray(savedMetadata.tools) && savedMetadata.tools.length
            ? `Herramientas TIC: ${savedMetadata.tools.join(', ')}`
            : '',
        savedMetadata.deliverable
            ? `Entregable: ${savedMetadata.deliverable}`
            : ''
    ].filter(Boolean);

    const savedMetadataBlock = savedMetadataLines.length
        ? savedMetadataLines.join('\n')
        : 'No hay metadatos externos guardados. No inventes enlaces, canales ni recursos externos.';

    let resourcePurpose = '';

    if (key === 'instructive') {
        resourcePurpose = `
FUNCIÓN PEDAGÓGICA DEL RECURSO

Este recurso es una FICHA INFORMATIVA AUTÓNOMA.

Su función es ENSEÑAR el campo temático de la sesión.
NO es una ficha de actividades.
NO es una ficha para completar.
NO es un anexo de motivación.
NO es un resumen de la planificación docente.

Tema central:
"${context.thematicField || context.title || 'Campo temático de la sesión'}"

Investiga y desarrolla pedagógicamente ese contenido utilizando conocimiento fiable.

Explica lo que el estudiante realmente necesita comprender y aplicar.

Según corresponda al tema, desarrolla:
- concepto central;
- para qué sirve;
- componentes o elementos;
- fases;
- procedimiento o pasos;
- técnicas;
- relaciones entre conceptos;
- ejemplos contextualizados;
- recomendaciones;
- errores frecuentes.

Si corresponde a una metodología, presenta brevemente el marco general y profundiza en las fases trabajadas.

Si corresponde a una técnica, explica:
qué es → para qué sirve → cómo se aplica → ejemplo.

La mayor parte de la imagen debe estar ocupada por CONTENIDO EDUCATIVO.
`.trim();
    }

    else if (key === 'annex1' && resource.kind === 'youtube') {
        resourcePurpose = `
FUNCIÓN PEDAGÓGICA DEL RECURSO

Este recurso es exclusivamente un ANEXO DE MOTIVACIÓN mediante VIDEO DE YOUTUBE.

NO es un instructivo.
NO debe desarrollar toda la teoría de la sesión.
NO es una ficha de trabajo.
NO debe resolver la evidencia.

Su función es despertar curiosidad y preparar al estudiante para el aprendizaje.

Debe incluir:
- video pertinente al tema;
- propósito de observación;
- qué observar;
- preguntas breves antes de ver;
- preguntas durante el video;
- preguntas después de verlo;
- una pregunta puente hacia el aprendizaje central.

DATOS EXTERNOS DISPONIBLES:
${savedMetadataBlock}

Si existe un video verificado, utiliza exactamente esos datos.
No cambies el video.
No inventes título, canal, URL ni código QR.
`.trim();
    }

    else if (key === 'annex1' && resource.kind === 'collage') {
        resourcePurpose = `
FUNCIÓN PEDAGÓGICA DEL RECURSO

Este recurso es exclusivamente un ANEXO 1 DE MOTIVACIÓN mediante observación de imágenes.

NO es un instructivo.
NO es una ficha teórica.

Presenta entre 3 y 5 escenas relacionadas entre sí que permitan observar, comparar e inferir.

Incluye:
- consigna;
- aspectos que deben observar;
- preguntas de análisis;
- pregunta puente hacia el contenido de la sesión.
`.trim();
    }

    else if (key === 'annex1' && resource.kind === 'questions') {
        resourcePurpose = `
FUNCIÓN PEDAGÓGICA DEL RECURSO

Este recurso es exclusivamente un ANEXO 1 DE MOTIVACIÓN mediante preguntas desafiantes.

NO es un instructivo.
NO expliques previamente las respuestas.

Presenta:
- situación breve;
- preguntas interesantes o de conflicto cognitivo;
- pregunta puente hacia el campo temático.
`.trim();
    }

    else if (key === 'annex1') {
        resourcePurpose = `
FUNCIÓN PEDAGÓGICA DEL RECURSO

Este recurso es exclusivamente una DINÁMICA DE MOTIVACIÓN.

NO es un instructivo teórico.

Debe incluir:
- nombre;
- propósito;
- materiales cuando correspondan;
- organización;
- instrucciones;
- participación del estudiante;
- pregunta puente.
`.trim();
    }

    else if (resource.kind === 'form') {
        resourcePurpose = `
FUNCIÓN PEDAGÓGICA DEL RECURSO

Este recurso es exclusivamente un ANEXO 2 · FORMULARIO TIC.

Su función es permitir que el estudiante PRODUZCA LA EVIDENCIA.

Incluye:
- consigna;
- herramienta TIC;
- campos y preguntas;
- espacios vacíos para responder;
- entregable;
- forma de entrega;
- criterios.

NO resuelvas el trabajo.
`.trim();
    }

    else if (resource.kind === 'gamification') {
        resourcePurpose = `
FUNCIÓN PEDAGÓGICA DEL RECURSO

Este recurso es exclusivamente un ANEXO 2 · ACTIVIDAD DE GAMIFICACIÓN.

Debe ser realmente jugable y conducir a la evidencia.

Incluye:
- misión;
- reglas;
- niveles o retos;
- decisiones;
- progreso o puntuación;
- evidencia final;
- criterios.

NO resuelvas los retos.
`.trim();
    }

    else if (resource.kind === 'project') {
        resourcePurpose = `
FUNCIÓN PEDAGÓGICA DEL RECURSO

Este recurso es exclusivamente un ANEXO 2 · RETO O PRODUCTO DIGITAL.

Su función es que el estudiante construya la evidencia.

Incluye:
- situación o necesidad;
- usuario;
- reto;
- consigna precisa;
- herramientas TIC pertinentes;
- proceso de trabajo;
- decisiones;
- tablas, matrices, cuadros o espacios vacíos necesarios;
- producto entregable;
- criterios;
- autoevaluación.

NO resuelvas por el estudiante.
NO conviertas el recurso en un instructivo teórico.
`.trim();
    }

    else {
        resourcePurpose = `
FUNCIÓN PEDAGÓGICA DEL RECURSO

Este recurso es exclusivamente un ANEXO 2 · FICHA DE TRABAJO.

Su función es que el estudiante produzca la evidencia durante la sesión.

Incluye:
- instrucciones;
- actividades numeradas;
- tablas, matrices, organizadores o espacios de producción;
- zonas realmente vacías para responder;
- producto entregable;
- criterios;
- reflexión o autoevaluación.

NO rellenes las respuestas.
NO conviertas la ficha en teoría expositiva.
`.trim();
    }

    return `
RECURSO ÚNICO A GENERAR

TIPO DE RECURSO: ${resourceName}
SUBTIPO: ${subtype}

IMPORTANTE:
Esta solicitud contiene UN SOLO recurso.
En esta interacción NO existen otros recursos.
Genera exclusivamente "${resourceName} · ${subtype}".

NO generes variantes.
NO generes alternativas.
NO generes una segunda imagen.
NO combines recursos.
NO generes páginas adicionales.

SALIDA OBLIGATORIA:
EXACTAMENTE 1 IMAGEN.

RELACIÓN DE ASPECTO:
${configuredAspect}

IDIOMA:
Español.

IDENTIFICACIÓN OBLIGATORIA EN LA CABECERA:
"${resourceName}"
"${subtype}"
"${sessionLabel}"

TÍTULO REAL DE LA SESIÓN:
"${context.title || 'Sesión de aprendizaje'}"

DATOS PEDAGÓGICOS COMUNES:
${identificationBlock}

${key !== 'annex1' ? curricularBlock : ''}

CONTEXTO PRIVADO PARA RAZONAR
NO copies este bloque literalmente dentro de la imagen:
${privateContext}

${resourcePurpose}

ORGANIZACIÓN VISUAL

1. La cabecera debe ocupar aproximadamente entre 10 % y 15 %.
2. La mayor parte del lienzo debe corresponder a la función pedagógica específica del recurso.
3. No llenes el recurso con datos administrativos.
4. Evita cuadrículas repetitivas de tarjetas idénticas.
5. Usa diagramas, secuencias, tablas, espacios de trabajo, ilustraciones o comparaciones solamente cuando aporten al aprendizaje.

ESTILO

Material editorial educativo moderno para secundaria.
Fondo predominantemente blanco.
Paleta armónica azul o violeta con acentos verdes, naranjas y celestes.
Jerarquía tipográfica clara.
Ilustraciones vectoriales funcionales de adolescentes peruanos o latinoamericanos cuando sean pertinentes.
Evita apariencia infantil, empresarial o de dashboard.

CALIDAD

Todo el texto debe estar correctamente escrito y ser legible.
No cortes palabras.
No uses texto diminuto.
No uses marcas de agua.
No uses logos.
No inventes enlaces.
No inventes códigos QR.

COMPROBACIÓN FINAL

Antes de generar verifica:

1. ¿La cabecera dice exactamente "${resourceName}"?
2. ¿Se reconoce claramente el subtipo "${subtype}"?
3. ¿Aparece "${sessionLabel}"?
4. ¿La mayor parte del espacio corresponde a la función específica de ESTE recurso?
5. ¿Existe solamente una imagen?

Si alguna respuesta es NO, corrígela antes de generar.

GENERA AHORA ÚNICAMENTE:
"${resourceName} · ${subtype}"
`.trim();

};




