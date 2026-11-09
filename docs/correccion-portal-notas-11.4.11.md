# Notas del portal estudiantil — 11.4.11

El portal de 2.º estaba eligiendo un modo criterial guardado para A y B el
16/10/2026. El registro docente usa el modo híbrido activo. Al filtrar por el
modo antiguo, el portal omitía las notas híbridas existentes y mostraba guiones.

El portal ahora respeta el mismo modo activo que usa el docente. Las
configuraciones de ámbito solo se consultan si no existe un modo activo válido.
Cada modo conserva sus registros separados: no se convierten ni mezclan notas.
No se modificó la base de datos instalada.

Verificación mediante el endpoint autenticado real, con una copia aislada de la
base: 138 estudiantes de 2.º A/B, 3.º U, 4.º U y 5.º A/B. Los promedios y niveles
por unidad, bimestre y competencia coinciden con el motor docente. Los 112
estudiantes con resultados visibles conservan sus notas; no quedan estudiantes
activos con notas híbridas guardadas pero ninguna sesión visible. Esmeralda
Yanira muestra sus 13 sesiones del III bimestre.

Informe local: `artifacts/auditoria-portal-notas-1792465882248/results.json`.
Pruebas: `npm run test:student-grades` y
`node scripts/test-student-portal-deliveries.mjs`, con un modo criterial antiguo
deliberadamente incluido en la prueba de integración.

Generar manualmente `npm run dist:win` e instalar 11.4.11 en la PC docente que
sirve el portal. Reiniciar el servicio con esa versión y actualizar el portal.

## Etiquetas HTML visibles en sesiones generadas con IA

La misma versión limpia `title`, `purpose`, `situation` y `extension`, que se
editan como texto plano. La IA podía devolver `<p>...</p>` y el código copiaba
esas cadenas directamente a los cuadros de texto. El prompt ahora distingue
esos cuatro campos de los campos HTML.

La normalización se ejecuta al generar, cargar o importar sesiones mediante
`ensureSessionAssessmentModel`; los cuadros de texto también cubren contenido
ya cargado. Conserva saltos de párrafo, viñetas, acentos y comparaciones; no
transforma el HTML de criterios, evidencias ni secuencias didácticas. Las
sesiones existentes se muestran limpias al abrirlas, sin una migración masiva.
La base instalada no se editó durante esta corrección.

Verificación: `npm run test:session-plain-text` prueba la respuesta de IA real,
la carga de datos guardados y el componente que muestra los cuadros de texto.
