# Fechas por sección, estabilidad de sesiones y consultas de conexión

## Hallazgos comprobados

La revisión de solo lectura de la base instalada examinó 21 sesiones compartidas con listas de fechas comparables. Encontró 20 asignaciones de fecha invertidas, todas de 5.º. La unidad conserva la relación correcta en `fechasPorSeccion`, pero el portal y la clasificación de evidencias asignaban la lista de fechas ordenada cronológicamente a la lista de secciones por posición.

En U7-S8 de 5.º, B tiene fecha 04/11/2026 y A tiene fecha 06/11/2026. El cálculo anterior las intercambiaba. En U7-S7, el panel docente mostraba la fecha general 02/11/2026 incluso al seleccionar B, cuya fecha es 03/11/2026. No se encontraron inversiones en los otros grados revisados; el error de interpretación era común a todos.

El cargador de sesiones dependía de objetos completos de asignaciones y programaciones. Sustituir esos objetos podía volver a cargar la sesión y repetir el aviso. Además, el evento general de sincronización comparaba contra una copia antigua del almacenamiento local, confundiendo cambios locales auxiliares con configuración académica recién recibida. La aplicación del estado portátil reescribía incluso valores idénticos, provocando trabajo adicional del guardado automático.

Había consultas periódicas duplicadas: diagnóstico completo cada 15 segundos, conectividad cada dos segundos y progreso cada dos segundos. La consulta frecuente del indicador podía exportar la base y recorrer recursos en modo local. La prueba de sincronización inicial también reprodujo pausas de aproximadamente siete segundos: preparación de notas antiguas y análisis de referencias sin ceder tiempo al servidor.

## Correcciones

- Un único resolvedor compartido obtiene la fecha explícita de la sección en la unidad. Admite metadatos explícitos en la sesión y usa el horario como respaldo; nunca asigna por posición alfabética. Los registros históricos ambiguos conservan sus fechas visibles. Las fechas generales antiguas no reemplazan una asignación explícita de otra sección.
- El portal, el cálculo de puntualidad de evidencias y el panel docente usan la misma fecha. La pestaña activa del registro determina la sección del control de plazos.
- Las nuevas excepciones pueden guardarse por sección mediante una clave compuesta en la tabla existente, sin migrar su esquema. Las excepciones generales antiguas siguen disponibles. Una apertura general guardada por el control excepcional antiguo no retrasa la apertura automática de B. Cerrar o restablecer B conserva las reglas de A.
- La carga inicial espera los datos necesarios y vuelve a ejecutarse por una selección efectiva, con cancelación de respuestas antiguas. Los cambios de objetos auxiliares conservan el borrador abierto. La hidratación escribe solo diferencias y sus eventos identifican los cambios realmente recibidos; caché de sesiones, avisos, consumo de IA y notas auxiliares no reinician el editor.
- El indicador solicita estado ligero sin exportación completa ni serialización de todas las preferencias. El diagnóstico completo en segundo plano pasa a una consulta por minuto; conectividad, cada diez segundos. Las consultas periódicas se pausan con la ventana oculta y no se solapan. Las peticiones simultáneas del diagnóstico comparten una única consulta. Salir de un panel cancela el trabajo sin iniciar reintentos repetidos.
- La revisión de referencias y la preparación inicial de notas se dividen en bloques. Se reutilizan las consultas SQL y la huella ya calculada del envío. Se conserva el diario de publicación y las mismas operaciones/versiones de sincronización.

## Verificación

Pruebas con bases temporales y datos de ejemplo: fechas distintas de A/B, otro grado, sesión de una sola sección con varios días, fecha general antigua, igualdad entre panel y portal, reglas independientes por sección y clasificación de entrega tardía. También se comprueba que el estado ligero no exporte la base ni devuelva todo el almacenamiento portátil.

Las pruebas de interfaz reproducen cambios de los objetos auxiliares conservando un borrador, un único aviso de carga y el descarte de respuestas de una selección anterior. Se comprueban consultas compartidas, cancelación, hidratación sin escrituras repetidas y pausa de paneles ocultos.

Comandos principales:

```text
node scripts/test-section-delivery-dates.mjs
node scripts/test-session-load-stability.mjs
node scripts/test-portable-refresh-stability.mjs
node scripts/test-sync-status-polling.mjs
node --experimental-strip-types scripts/test-access-panel-isolation.mjs
node scripts/test-sync-transfer-controls.mjs
node scripts/test-sync-status-performance.mjs
npm run test:sync-efficiency
npm run typecheck
npm run build
```

También se ejecutaron las pruebas de notas, identidades de estudiantes, escrituras concurrentes, foro y observación del almacenamiento portátil. El control de rendimiento conserva su límite de dos segundos y ahora observa 20 segundos de sincronización inicial para incluir fases posteriores.

En la ejecución final de ese control: estado 477 ms, máxima latencia de salud del servidor 971 ms y consulta de cierre 933 ms. Antes de corregir los bloques de preparación se reprodujeron latencias de aproximadamente siete segundos. Son medidas de esta prueba local, no una garantía sobre toda pantalla, equipo o transferencia de Drive.

## Instalación

Son cambios del proyecto. La revisión de la base instalada fue de solo lectura; las pruebas no modificaron las sesiones, notas, evidencias ni Drive de uso diario. El aplicativo instalado necesita una actualización que incluya estas correcciones para utilizarlas. El análisis detallado de fechas quedó en `recovery-candidates/section-dates-refresh-2026-11-03/date-audit.json`.
