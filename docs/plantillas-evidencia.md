# Plantillas de evidencia

En **Sesiones → Planificación**, al lado de Práctica HTML, aparece una fila por evidencia del área o transversal **de la sesión guardada**. Después de cambiar los entregables, guarda la sesión y pulsa Actualizar en el panel.

1. Selecciona Individual o Grupal, copia el prompt y genera un archivo HTML en ChatGPT.
2. Usa Buscar HTML para importarlo. Si la fecha de la sesión y el Horario Semanal permiten resolver cada sección, se activa automáticamente. Se ve en el portal, pero solo se puede editar durante esos bloques de clase.
3. El horario se muestra en la tarjeta. Si falta una fecha o un bloque semanal, el HTML se conserva en borrador con un aviso que identifica la sección pendiente. Corrige la fecha/horario o define un plazo excepcional y pulsa Activar con horario de sesión. Para borradores ya cargados, existe Activar las cargadas con horario de sesión. No se activa silenciosamente un borrador anterior ni se inventa un horario de todo el día.
4. El estudiante encuentra Desarrollar plantilla junto a la evidencia esperada en Mis entregas, con su fecha/horario de disponibilidad, y también en Recursos. El acceso se conserva visible aunque cierre la recepción de archivos. Debe entrar con su propia cuenta, incluso cuando trabaja en grupo.
5. En el registro, NL abre únicamente los trabajos de la competencia seleccionada. El indicador violeta ✎ señala borradores del estudiante. Desde la plantilla puedes seleccionar un fragmento, abrir Aportes y comentarios, comentar, revisar cambios anteriores y restaurarlos.

## Reglas de trabajo

- Editar reserva un campo durante 30 segundos renovables mientras la ventana está visible y conectada. Otros integrantes ven el nombre del editor y pueden trabajar en otros campos.
- El borrador se envía después de 850 ms sin escribir. Solo se envía el campo modificado; las consultas cada 2 segundos omiten el contenido si no cambió. No hay conexiones colaborativas cuando el editor está cerrado ni se cargan bibliotecas adicionales.
- Guardar y liberar confirma una versión del campo y lo deja disponible. No equivale a entregar todo el trabajo.
- Cada integrante guarda al menos un campo y confirma personalmente la revisión actual. Una modificación invalida las confirmaciones. La entrega se registra cuando todos confirman; el docente puede autorizar una excepción con motivo, visible para el grupo y conservada en el historial.
- El horario incluye los bloques de clase y los recreos configurados. Fuera de ese horario se conserva el borrador, pero no se permite editar ni confirmar. Reabrir una entrega no amplía el horario: configura también el plazo excepcional cuando corresponda.
- El trabajo conserva la plantilla, modalidad e integrantes con que comenzó. La modalidad no se puede cambiar si ya hay trabajos iniciados. Los cambios en el HTML afectan a futuros trabajos.
- Los cambios, borrados, guardados manuales, restauraciones y excepciones tienen autor y fecha. El historial se carga por páginas de 100 cambios por campo.
- Los comentarios se anclan al campo, fragmento, posición y versión. Si cambia ese campo, el comentario permanece y avisa que el texto original fue modificado. No se recoloca sobre otro texto.
- Si falla la conexión, los cambios pendientes se conservan en el dispositivo. Al recuperar la reserva, se restauran si coinciden las versiones; si alguien cambió el campo, el borrador queda disponible para comparar y copiar, sin reemplazar el aporte ajeno.
- La entrega genera un HTML fijo por integrante, vinculado a la evidencia y competencia originales. Una reapertura conserva las entregas anteriores. No asigna una calificación automática.

## Encabezados y diseño

Las tarjetas usan el color de su competencia de área o transversal. Copiar todos los prompts reúne los archivos solicitados con las reglas comunes una sola vez; siguen disponibles los prompts individuales.

Cada nueva plantilla incluye Nombre del proyecto (`project_name`), Equipo/grupo (`data-armi-meta="team"`), Fecha (`data-armi-meta="date"`), Versión (`data-armi-meta="version"`) y Observaciones y dificultades (`observations`). El encabezado puede reorganizarse según la técnica. Si el HTML importado no incluye algún dato, ARMI añade el dato faltante.

El proyecto se recuerda por equipo, sección y área durante el año, incluso entre evidencias individuales y grupales, para nuevas plantillas de otras sesiones y unidades. Cuando no existe grupo, se recuerda por estudiante. No modifica documentos anteriores ni se comparte con otros equipos. La fecha cambia al guardar una modificación en otro día; leer el trabajo no cambia su fecha. La versión del trabajo comienza en 1.0 y aumenta con cada modificación (1.1, 1.2, etc.), independientemente de la versión del HTML importado.

El bot se incorpora desde los nombres reales de la biblioteca mediante `img[data-armi-image]`, sin rutas externas ni scripts. Solo se incrustan las imágenes utilizadas y se conservan en la copia entregada.

Cada prompt individual y cada archivo del prompt conjunto recomienda un estado según la evidencia: portapapeles para entrevistas, lupa para observación/investigación, computadora para archivos y aplicaciones, lápiz para bocetos, lectura para comprensión, etc. Son recomendaciones basadas en los nombres disponibles, con alternativas reales; no se obliga a que dos tareas similares usen personajes distintos. No se añade una galería ni se cargan todos los estados en la plantilla.

Cuando la biblioteca contiene estados del bot, una importación nueva debe incluir una etiqueta `img` con `data-armi-image` de un bot real y visible. Un recuadro `bot-slot`, un comentario HTML o una imagen oculta no bastan. Los nombres inexistentes se rechazan incluso cuando se aporta un `src` incrustado. El cliente avisa antes del envío y el servidor vuelve a comprobarlo. Una biblioteca vacía no exige personajes inexistentes. Se permite retirar de publicación una plantilla antigua sin que una imagen faltante bloquee esa acción.

Un `canvas[data-armi-field]` activa el dibujo con lápiz, color, deshacer y vaciar. Tiene el mismo bloqueo, autoría, borrador, historial y restauración que el texto. Los dibujos se guardan como trazos normalizados (máximo 200 trazos y 2500 puntos por campo, 90 000 caracteres), y el historial muestra vistas previas en páginas de 20. Funcionan con ratón o táctil. Se utilizan cuando la técnica los requiere; no es obligatorio dibujar en todas las evidencias.

## Límites

Máximo 512 KB de estructura por plantilla (2 MB con imágenes del bot) y 80 campos, incluidos los del encabezado; hasta 12 000 caracteres por campo de texto y aproximadamente 300 KB de respuestas por documento. Se aceptan HTML y CSS internos, input de texto/número/fecha/casilla, textarea, select y canvas. Cada campo necesita un `data-armi-field` único y un `aria-label`. No se aceptan scripts, conexiones, iframes, recursos externos ni contenteditable; ARMI aporta el editor y la colaboración. Usa el prompt específico del panel, no el de Práctica HTML.

Pruebas aisladas: `npm run test:evidence-templates`. No utilizan estudiantes ni bases de datos reales.
