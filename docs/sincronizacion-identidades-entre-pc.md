# Identidades entre computadoras — actualización 11.4.7

## Causa comprobada

El ID numérico de SQLite es local. Los padrones de PC1 y PC2 tenían 27
estudiantes con DNI coincidente e ID diferente. Una relación recibida como
`student_id=181` podía terminar en otra persona si se copiaba sin traducirla.

## Corrección permanente

- El protocolo 2 transmite identidades portables y traduce cada referencia al
  ID local. Un DNI válido y único establece la identidad inicial; se conserva
  después aunque el DNI se corrija. Sin DNI se usa una identidad persistente.
- Instrumentos y evidencias usan claves naturales. Se traducen también listas
  de alumnos, grupos, diarios, cachés, actividades, asistencias y conclusiones.
  Los UUID existentes de sesiones, unidades y contenido se conservan.
- Un número extranjero sin correspondencia demostrable queda pendiente. No se
  interpreta por coincidencia numérica ni se confirma su incorporación.
- Literal e híbrida son registros distintos. Un borrado antiguo sin modalidad
  inequívoca no elimina ambos registros. Las marcas de alumnos borrados no se
  aplican a una nueva inscripción por compartir su nombre o un ID extranjero.
- Los filtros recordados y avisos ya vistos convergen con el mismo reloj
  determinista, sin tratarlos como conflictos de notas. Los conflictos de
  contenido académico conservan el detalle para revisión.

`armi_sync_identity_map`, `armi_sync_migration_archive` y
`armi_sync_migration_log` son tablas locales excluidas de la sincronización.

## Conciliación preparada del caso real

La migración privada `identidades-2026-10-19-v4` une la copia verificada de PC1
con los paquetes recibidos de PC2. Antes de incorporar datos comprueba la huella
del paquete y que la base no tenga trabajo posterior sin conciliar.

- PC1 compara las huellas de las tablas con el respaldo inspeccionado.
- PC2 comprueba sus registros contra su último checkpoint publicado y que
  todos sus paquetes estén incluidos. Si hay trabajo no comprobado, lo conserva
  y detiene la migración; nunca lo descarta para forzar la actualización.
- Antes de modificar cada base crea un respaldo SQLite consistente, checkpoint
  y estado de interfaz en
  `sync-runtime/identity-upgrade-backups/identidades-2026-10-19-v4/`.
- La importación y su registro se realizan en una transacción. Archiva las filas
  originales, incluidos duplicados, marcas antiguas y borradores inválidos.
- Seis marcas de borrado de inscripciones antiguas, sin DNI, se archivan porque
  existían inscripciones activas distintas; no eliminan a esos estudiantes.
- Regenera las cachés de notas/conclusiones. Una ventana anterior a la migración
  debe recargarse antes de guardar, para no restaurar referencias antiguas.
- La migración se ejecuta una sola vez. Las reaperturas posteriores no vuelven a
  importar el paquete ni deshacen ediciones nuevas.

Los paquetes privados están en `.armi-sync/identity-migrations/` del espejo.
El manifiesto `.armi-sync/identity-migration-v4.json` se publica al final, después
de verificar la copia del paquete. No forman parte del instalador distribuible.

## Comprobaciones

Las pruebas cubren IDs cruzados, altas simultáneas, cambios de DNI, estudiantes
sin DNI, egresados, instrumentos globales, notas, asistencia, evidencias,
actividades, diarios, cachés, borrados, recuperación y escrituras concurrentes.
También prueban la protección del trabajo no publicado y la repetición de la
migración sin sobrescribir ediciones posteriores.

La reproducción aislada del caso real usa la base respaldada de PC1 y un modelo
de PC2 construido con su padrón y paquetes recibidos: no es una copia directa
del disco de PC2. El control de su checkpoint se vuelve a realizar en PC2 real.
El motor real de consolidación compara los resultados del III bimestre para
todos los grupos. Se conservan los resultados y las 1332 conclusiones.

El destino contiene 21407 registros lógicos de notas; siete filas duplicadas se
conservan en el archivo y respaldo, en lugar de duplicar el mismo criterio.
Los archivos físicos de evidencias no se eliminan con esta preparación.

## Actualización

Seguir [actualizacion-11.4.7.md](actualizacion-11.4.7.md). Es obligatorio actualizar
ambas computadoras antes de retomar el trabajo. El código del proyecto no cambia
las aplicaciones que ya están instaladas.
