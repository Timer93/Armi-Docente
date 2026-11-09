# Reparación del pendiente de identidad: 11.4.10

El aviso puede permanecer aunque Google Drive esté actualizado: ARMI protege
datos locales posteriores a la conciliación anterior. Drive solo confirma que
los archivos existentes se transfirieron, no que ARMI haya conciliado sus datos.

La revisión conserva los cambios recientes mediante una comparación de tres
copias: respaldo original, conciliación anterior y datos actuales. La reparación
base permanece inmutable para las PC que ya la aplicaron. Esas PC reciben las
correcciones nuevas incrementalmente; no vuelven a importar la copia antigua.

Los guardados equivalentes que solo cambian identificadores de almacenamiento,
fechas de guardado de notas/conclusiones o el cifrado local de recuperación se
reconocen automáticamente. Una nota, texto o relación de estudiante diferente
sigue deteniendo la reparación hasta que se concilie. No borrar el control para
ocultar el pendiente.

## Instalación manual

1. Terminar el trabajo y cerrar ARMI normalmente en ambas PC.
2. Esperar que Drive termine sus transferencias.
3. Generar el instalador desde este proyecto con `npm run dist:win`.
4. Instalar 11.4.10 en ambas PC. No hace falta instalar 11.4.9 primero.
5. Abrir PC1 y dejar terminar la primera reparación y sincronización. Esperar
   que Drive envíe los archivos antes de abrir PC2, que debe recibirlos primero.
6. Verificar el III bimestre y que ambas PC terminen sin tareas pendientes.

El programa crea el respaldo local antes de la transacción de reparación en:

```text
%APPDATA%\ARMI Docente\sync-runtime\identity-upgrade-backups\identidades-2026-10-19-v4\
```

La preparación y las pruebas no modifican la base instalada. La activación del
paquete actualizado requiere que coincida con los últimos datos revisados. Si
hay nuevas ediciones, se conserva todo y se debe refrescar la revisión antes de
activarla. El informe de activación queda en la carpeta local de preparación.

## Comprobaciones

Pruebas de guardados equivalentes, protección de ediciones reales posteriores,
conservación de notas y textos recientes, respaldo, recepción incremental en
una PC ya migrada y aperturas sucesivas sin reimportación. La simulación con
copias reales verifica promedios por capacidad/competencia, las nueve notas
recientes y los 1332 textos de conclusiones en ambas PC.
