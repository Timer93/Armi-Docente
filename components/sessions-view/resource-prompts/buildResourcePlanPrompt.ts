import type { SessionLearningResource, SessionResourceKey } from '../SessionLearningResources';

export type SessionResourceAiContext = {
    area: string;
    grade: string;
    section: string;
    unit: string;
    bimester: string;
    session: string;
    sessionTotal: number;
    duration: string;
    title: string;
    purpose: string;
    situation: string;
    competency: string;
    capacity: string;
    thematicField: string;
    criterion: string;
    evidence: string;
    instrument: string;
    learningSequence: {
        priorKnowledge: string;
        cognitiveConflict: string;
        construction: string;
        application: string;
        metacognition: string;
        assessment: string;
    };
};

export const buildSessionResourcePlanPrompt = (
    context: SessionResourceAiContext,
    key: SessionResourceKey,
    resource: SessionLearningResource
) => {
    const resourceInstruction =
        key === 'instructive'
            ? `
INSTRUCTIVO INFORMATIVO:
Crea un recurso AUTÓNOMO PARA ENSEÑAR el contenido central de la sesión.

Debe contener toda la información necesaria para comprender y aplicar el aprendizaje, no un resumen de la planificación.

Analiza primero qué tipo de contenido predomina: concepto, comparación, clasificación, proceso, técnica, metodología, análisis, problema, sistema, producción o combinación.

Organiza libremente la información según esa naturaleza:
- conceptos: definición, componentes, relaciones y ejemplos;
- procesos o técnicas: qué es, para qué sirve, pasos, recomendaciones y resultado;
- metodología: fases, función de cada fase y aplicación;
- comparación: criterios, semejanzas, diferencias y conclusión;
- análisis o problema: situación, elementos, procedimiento de análisis y solución;
- producción: materiales o recursos, procedimiento, control y resultado.

Incluye cuando correspondan: conceptos esenciales, definiciones, procedimiento, fórmulas, ejemplos resueltos, recomendaciones, errores frecuentes, relaciones y aplicación contextualizada.

Debe parecer una infografía educativa rica en contenido, útil para que el docente explique y el estudiante estudie.
No conviertas la sesión en una lista de actividades ni copies literalmente la planificación.
`
            : key === 'annex1'
                ? resource.kind === 'youtube'
                    ? `
ANEXO 1 · VIDEO:
Diseña un recurso breve de motivación basado en un video educativo real.
Incluye propósito de observación, qué observar, 2-4 preguntas antes/durante/después y una pregunta puente hacia el aprendizaje.
metadata.searchQuery debe contener una búsqueda específica.
No inventes URL.
`
                    : resource.kind === 'collage'
                        ? `
ANEXO 1 · COLLAGE:
Diseña una actividad de observación y análisis mediante 3-5 escenas relacionadas con la situación de aprendizaje.
Incluye una consigna breve, elementos concretos que observar, preguntas para comparar/inferir y una pregunta puente.
Las imágenes deben contener información que permita responder.
`
                        : resource.kind === 'questions'
                            ? `
ANEXO 1 · PREGUNTAS DESAFIANTES:
Genera una situación problemática breve y preguntas interesantes, capciosas o de conflicto cognitivo apropiadas al grado.
No incluyas las respuestas.
Las preguntas deben conducir directamente al contenido central de la sesión.
`
                            : `
ANEXO 1 · DINÁMICA:
Diseña una dinámica breve, viable y directamente relacionada con el propósito.
Incluye nombre, propósito, materiales si son necesarios, organización, instrucciones claras, participación de los estudiantes y una pregunta puente.
Debe poder ejecutarse realmente en aula.
`
                : resource.kind === 'form'
                    ? `
ANEXO 2 · FORMULARIO TIC:
Crea una actividad digital utilizable que produzca la evidencia de la sesión.
Incluye instrucciones, datos necesarios, preguntas o campos variados, espacios de respuesta, producto final, forma de entrega y criterios de revisión.
metadata.tools y metadata.deliverable son obligatorios.
`
                    : resource.kind === 'gamification'
                        ? `
ANEXO 2 · GAMIFICACIÓN:
Crea una actividad gamificada realmente jugable y relacionada con el aprendizaje.
Incluye misión, reglas, niveles o retos, decisiones, puntuación o progreso, evidencia final y cierre.
metadata.tools y metadata.deliverable son obligatorios.
`
                        : resource.kind === 'project'
                            ? `
ANEXO 2 · RETO O PRODUCTO DIGITAL:
Crea un reto auténtico que permita elaborar la evidencia de la sesión.
Incluye situación, usuario o necesidad, consigna, herramientas, proceso, decisiones, producto entregable, criterios y autoevaluación.
metadata.tools y metadata.deliverable son obligatorios.
`
                            : `
ANEXO 2 · FICHA DE TRABAJO:
Crea una ficha COMPLETA Y RESOLUBLE por el estudiante durante la sesión.

Debe conducir progresivamente hacia la evidencia indicada.
Incluye instrucciones breves, actividades numeradas, ejemplos cuando sean necesarios, tablas/matrices/organizadores/operaciones según el tema, espacios reales para responder, consolidación del producto o evidencia, reflexión y autoevaluación.

Las actividades deben corresponder a lo que realmente se desarrolla en la sesión.
No conviertas la ficha en teoría expositiva: debe contener tareas para completar, analizar, calcular, decidir, producir o justificar.
`;

    return `
Eres especialista en diseño instruccional para educación secundaria del Perú.

Genera el contenido de UN recurso educativo a partir de la sesión completa proporcionada.

TIPO DE RECURSO:
${resourceInstruction}

REGLAS:
1. Usa únicamente información coherente con la sesión.
2. No inventes contenidos curriculares que contradigan la planificación.
3. Puedes desarrollar, explicar y ejemplificar el contenido necesario para hacerlo comprensible.
4. Prioriza utilidad pedagógica sobre decoración.
5. Adapta lenguaje, dificultad y ejemplos a ${context.grade} y al área ${context.area}.
6. No omitas información indispensable para comprender o realizar la actividad.
7. No fuerces una cantidad fija de secciones: utiliza las necesarias.
8. Usa textos breves pero suficientes. Prefiere listas, pasos, fórmulas, ejemplos, tablas y relaciones antes que párrafos extensos.
9. Las secciones deben tener continuidad y formar un solo recurso coherente.
10. No uses Markdown, enlaces inventados, logos ni marcas.

DATOS FIJOS:
- Sesión: ${context.session}/${context.sessionTotal}
- Título: ${context.title}
- Área: ${context.area}
- Grado: ${context.grade}
- Sección: ${context.section}
- Unidad: ${context.unit}
- Bimestre: ${context.bimester}
- Duración: ${context.duration}
- Propósito: ${context.purpose}
- Competencia: ${context.competency}
- Capacidad(es): ${context.capacity}
- Campo temático: ${context.thematicField}
- Criterio: ${context.criterion}
- Evidencia: ${context.evidence}
- Instrumento: ${context.instrument}

Devuelve SOLO JSON válido:
{
  "eyebrow": "tipo de recurso",
  "heading": "título breve",
  "summary": "idea de entrada breve",
  "sessionInfo": {
    "sessionLabel": "Sesión N/Total",
    "sessionTitle": "",
    "purpose": "",
    "competency": "",
    "capacities": "",
    "criterion": "",
    "evidence": ""
  },
  "visualBrief": {
    "layoutIdea": "",
    "illustrationIdea": "",
    "paletteIdea": ""
  },
  "sections": [
    {
      "label": "",
      "body": "",
      "visualFormat": "concept|steps|example|diagram|table|checklist|questions|workspace|reminder"
    }
  ],
  "metadata": {
    "searchQuery": "",
    "duration": "",
    "tools": [],
    "deliverable": ""
  }
}

SESIÓN COMPLETA:
${JSON.stringify(context, null, 2)}
`.trim();
};

