import type {
    SessionLearningResource,
    SessionResourceAIContent,
    SessionResourceKey
} from '../SessionLearningResources';

const buildResourceStructure = (
    key: SessionResourceKey,
    resource: SessionLearningResource
) => {
    if (key === 'instructive') {
        return `
ESTRUCTURA VISUAL OBLIGATORIA DEL INSTRUCTIVO:

La imagen debe reconocerse inmediatamente como un INSTRUCTIVO EDUCATIVO.

CABECERA SUPERIOR — aproximadamente 15 % del espacio:
- En la esquina superior izquierda o dentro de una cinta destacada escribe exactamente:
  "INSTRUCTIVO N.° 1"
- Debe ser grande, claramente visible y funcionar como identificador del recurso.
- Al lado o debajo coloca de manera compacta:
  Sesión, área, grado y sección.
- Incluye el título de la sesión de forma breve y legible.
- Incluye el propósito resumido en una franja o bloque secundario.

CUERPO PRINCIPAL — aproximadamente 75 % del espacio:
Debe estar dedicado principalmente a ENSEÑAR EL CAMPO TEMÁTICO de la sesión.
NO conviertas esta zona en información administrativa.
Explica el aprendizaje siguiendo una progresión pedagógica:

1. CONCEPTO CENTRAL
   Explica a detalle el/los concepto/s del contenido principal que se aprenderá.
2. ¿PARA QUÉ SIRVE?
   Explica brevemente su utilidad.
3. PROCEDIMIENTO O TÉCNICA
   Muestra visualmente los pasos necesarios para aplicarlo/s.
4. TÉCNICAS, ELEMENTOS O RECURSOS
   Presenta aquello que el estudiante realmente debe conocer y utilizar.
5. EJEMPLO SIMPLE Y CONTEXTUALIZADO
   Incluye un ejemplo breve relacionado a los productos de la sesión.
6. RECOMENDACIONES O ERRORES FRECUENTES
   Incluye solo aquellos que ayuden al estudiante a aplicar correctamente el aprendizaje.

Adapta automáticamente esta estructura al campo temático real.
Nota:Si el area es Educación Para el Trabajo, por ejemplo, si corresponde a Design Thinking, fase Prototipar:
- qué es prototipar;
- para qué sirve;
- tipos o técnicas de prototipado pertinentes;
- materiales de bajo costo o reciclados;
- pasos para elaborar el prototipo;
- ejemplo sencillo;
- recomendaciones.
Lo mismo con otra fase. Esto segun el area, grado y contenido de la sesión pues cada area tiene sus propias características y contenidos.

CIERRE — aproximadamente 10 %:
Incluye una síntesis, idea clave, resultado esperado o recordatorio útil.

DATOS PEDAGÓGICOS:
Competencia, capacidad, criterio y evidencia pueden aparecer en una franja compacta,
pero NO deben competir visualmente con el contenido educativo.
`;
    }

    if (key === 'annex1') {
        return `
ESTRUCTURA VISUAL OBLIGATORIA DEL ANEXO N.° 1:

La imagen debe reconocerse inmediatamente como un recurso de INICIO,
MOTIVACIÓN, OBSERVACIÓN O CONFLICTO COGNITIVO.

CABECERA SUPERIOR — aproximadamente 15 %:
- En la esquina superior izquierda o cinta destacada escribe exactamente:
  "ANEXO N.° 1"
- Al lado coloca "Sesión X/X".
- Incluye de manera compacta área, grado, sección y título relacionado con la sesión.
- NO presentes una gran cantidad de datos curriculares.

CUERPO PRINCIPAL — aproximadamente 75 %:
El diseño debe depender estrictamente del tipo: ${resource.kind}.

Si el tipo es YOUTUBE o VIDEO:
- representa claramente que se observará un video;
- incluye un espacio visual principal asociado al tema del video;
- muestra "Propósito de observación";
- muestra "¿Qué debemos observar?";
- organiza preguntas en:
  "ANTES DE VER",
  "DURANTE EL VIDEO",
  "DESPUÉS DE VER";
- finaliza con una "PREGUNTA PUENTE" que conduzca al aprendizaje central de la sesión.

IMPORTANTE:
NO inventes URL, la URL debe ser real.
NO inventes código QR.
NO inventes nombre de canal, el canal debe ser real y existir.
NO inventes datos técnicos del video, estos deben ser reales.

Si existe metadata.searchQuery, puede aparecer al pie como:
"Búsqueda sugerida:"
seguida únicamente por el texto de búsqueda.

El Anexo 1 NO debe parecer un instructivo teórico.
Debe despertar curiosidad y preparar al estudiante para aprender.

CIERRE — aproximadamente 10 %:
Destaca únicamente la pregunta puente o reto cognitivo principal.
`;
    }

    return `
ESTRUCTURA VISUAL OBLIGATORIA DEL ANEXO N.° 2:

La imagen debe reconocerse inmediatamente como una FICHA DE TRABAJO
para producir la evidencia de la sesión.

CABECERA SUPERIOR — aproximadamente 15 %:
- En la esquina superior izquierda o cinta destacada escribe exactamente:
  "ANEXO N.° 2"
- Al lado coloca "Sesión X/X".
- Incluye título breve, área, grado y sección.
- Agrega campos pequeños como:
  Nombre: _________________________ Equipo: ____  Fecha: __/__/____
cuando sean útiles.

CUERPO PRINCIPAL — aproximadamente 80 %:
Debe estar destinado principalmente al TRABAJO DEL ESTUDIANTE o mejor dicho las EVIDENCIAS A PRESENTAR para la presente sesión.

Organiza el recurso como una secuencia de producción:

1. RETO O SITUACIÓN
   Explica en pocas líneas qué debe resolver o producir.
2. CONSIGNA
   Indica exactamente qué debe hacer el estudiante.
3. PROCESO DE TRABAJO
   Presenta pasos numerados y concretos.
4. ESPACIOS PARA PRODUCIR LA EVIDENCIA
   Según las evidencias que deben presentar en esta sesión incluye tablas, cuadros, líneas, casillas,
   organizadores o zonas de dibujo reales y suficientemente grandes.
   Debe ser claro lo que el estudiante debe hacer y producir en cada espacio.
   Cada evidencia debe estar numerada y tener su propio espacio de trabajo, no mezcles evidencias en un mismo cuadro.
5. PRODUCTO ENTREGABLE
   Indica claramente qué debe presentar en pocas lineas de texto viñetado según lo que se indica en la evidenciade esta sesión.
6. CRITERIOS CLAVE
   Incluye criterios breves que permitan al estudiante evaluar su trabajo.
7. AUTOEVALUACIÓN
   Incluye una sección pequeña de comprobación o reflexión.

REGLA CRÍTICA:
NO rellenes las respuestas que corresponden al estudiante.
Los cuadros deben tener espacio real para completar.
No conviertas esta ficha en una infografía expositiva.

Solo la evidencia incluye:
- cuadro de recursos;
- cronograma o Gantt;
- plan de contingencia;
deben existir espacios o tablas concretas para que el estudiante los complete.
No debes agregar contenido adicional que no corresponda a las evidencias de la sesión.
`;
};

export const buildSessionResourceImagePrompt = (
    key: SessionResourceKey,
    resource: SessionLearningResource,
    content: SessionResourceAIContent
) => {
    const visualType =
        key === 'instructive'
            ? 'INSTRUCTIVO INFORMATIVO'
            : key === 'annex1'
                ? `ANEXO 1 · ${String(resource.kind || '').toUpperCase()}`
                : `ANEXO 2 · ${String(resource.kind || '').toUpperCase()}`;

    const resourceName =
        key === 'instructive'
            ? 'INSTRUCTIVO N.° 1'
            : key === 'annex1'
                ? 'ANEXO N.° 1'
                : 'ANEXO N.° 2';

    const forbiddenResources =
        key === 'instructive'
            ? 'ANEXO N.° 1 ni ANEXO N.° 2'
            : key === 'annex1'
                ? 'INSTRUCTIVO N.° 1 ni ANEXO N.° 2'
                : 'INSTRUCTIVO N.° 1 ni ANEXO N.° 1';

    return `
GENERA EXACTAMENTE UNA SOLA IMAGEN.

RECURSO QUE DEBES GENERAR:
"${resourceName}"

REGLA DE AISLAMIENTO:
Esta solicitud corresponde EXCLUSIVAMENTE a "${resourceName}".

NO incluyas ${forbiddenResources}.
NO combines recursos.
NO hagas collage.
NO hagas tríptico.
NO hagas mosaico.
NO coloques varias páginas dentro de una sola imagen.
NO generes una portada adicional.
NO generes una vista previa adicional.
NO generes una versión alternativa.
NO generes variantes.
NO generes una segunda imagen.
NO generes imágenes complementarias.

RESULTADO DE ESTA LLAMADA:
EXACTAMENTE 1 IMAGEN = "${resourceName}".

RELACIÓN DE ASPECTO:
${resource.aspectRatio}

TIPO:
${visualType}

IDENTIFICACIÓN OBLIGATORIA:
El texto "${resourceName}" DEBE aparecer dentro de la imagen,
preferentemente en la esquina superior izquierda,
con tamaño grande y alta jerarquía visual.

Debe poder reconocerse qué recurso es, el grado y sección con solo mirar la cabecera.

IDIOMA:
Español.

CONTENIDO PEDAGÓGICO OBLIGATORIO:
${JSON.stringify(content)}

${buildResourceStructure(key, resource)}

JERARQUÍA GENERAL:
1. Identificación del recurso.
2. Información básica de la sesión.
3. Contenido o actividad principal.
4. Elementos de apoyo.
5. Cierre o comprobación.

DISTRIBUCIÓN:
- Reserva poco espacio para datos administrativos.
- Utiliza la mayor parte de la imagen para el aprendizaje o trabajo del estudiante.
- No desperdicies espacio con ilustraciones decorativas gigantes.
- Las ilustraciones deben apoyar directamente la comprensión.
- Incluye un texto muy pequeño al final de la parte inferior de la pagina que diga: "Generado por Armi Docente - ARMAR 369 EIRL Todos los derechos reservados." y nada más.

DISEÑO:
- Material pedagógico editorial moderno para secundaria.
- Fondo predominantemente blanco.
- Paleta de violeta o azul combinada con verde, naranja y celeste.
- Usa cintas, franjas o cápsulas para encabezados.
- Usa diagramas, flechas, pasos, tablas, esquemas e iconos cuando ayuden.
- Evita una cuadrícula monótona de tarjetas idénticas.
- Evita apariencia de dashboard empresarial.
- Evita apariencia infantil.

ILUSTRACIONES:
- Estilo vectorial limpio.
- Adolescentes peruanos o latinoamericanos.
- Contextos educativos y de emprendimiento.
- No fotorrealista.
- No usar personajes como decoración sin función pedagógica.

TEXTO:
- Todo en español correcto.
- Tipografía grande y legible.
- No cortar palabras.
- No cortar frases.
- No usar texto diminuto para forzar contenido.
- No usar puntos suspensivos para ocultar información.
- Priorizar conceptos, pasos, ejemplos, tablas y esquemas frente a párrafos largos.

PROHIBIDO:
- logos;
- marcas comerciales;
- códigos QR;
- marcas de agua;
- URLs inventadas;
- recursos adicionales;
- imágenes extra.

COMPROBACIÓN FINAL ANTES DE GENERAR:
Verifica mentalmente:
1. ¿Aparece claramente "${resourceName}"?
2. ¿Se reconoce inmediatamente qué tipo de recurso es?
3. ¿La mayor parte del espacio corresponde al aprendizaje o actividad?
4. ¿Solo existe un recurso dentro del lienzo?
5. ¿La salida contiene exactamente una imagen?
Si cualquiera de las respuestas es NO, corrige la composición antes de generar.

GENERA AHORA ÚNICAMENTE "${resourceName}".
`.trim();
};
