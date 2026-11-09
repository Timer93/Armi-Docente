# Prácticas HTML y calificaciones docentes — 11.4.13

La integración anterior guardaba los resultados de prácticas en dos sitios:
`interactive_activity_results` y `evaluacion_registros`. La segunda escritura
era literal y llevaba una observación con el prefijo `[Actividad HTML:...]`.
El portal de entregas leía esos registros y mostraba la sesión como revisada.
En Edwin, unidad 7 sesión 3, el AD–18 mostrado corresponde a esa escritura.

Cambios:

- Completar, abandonar o agotar el tiempo de una práctica solo guarda su
  resultado/intento. No crea ni actualiza calificaciones docentes.
- Reiniciar una práctica tampoco elimina notas de evaluación.
- Los registros automáticos antiguos permanecen en almacenamiento para su
  trazabilidad. Los que conservan el prefijo, nota y nivel automático originales
  se excluyen de la consulta académica, del portal y del motor de consolidación.
  Una corrección de nota o nivel realizada por el docente se conserva aunque
  todavía tenga la observación antigua.
- Las entregas usan el mismo modo de calificación activo que el registro docente.
- Un número ausente no se presenta como 0 ni C en las etiquetas del portal.

No se editó ni depuró masivamente la base instalada. Los resultados de prácticas
siguen disponibles en sus consultas propias. La actualización aplica la
separación también a datos antiguos sin borrar resultados o evidencias.

Pruebas: endpoints reales de prácticas individuales/grupales y reinicios,
preservación de notas manuales, entrega no revisada, calificaciones antiguas
excluidas, motor de unidad/bimestre y etiquetas con nota ausente. También se
verificaron las entregas existentes, los tipos y la compilación.

Generar el instalador con `npm run dist:win` e instalar 11.4.13 en las PC docentes
que sirven el portal. Actualizar la página del estudiante después del reinicio.
