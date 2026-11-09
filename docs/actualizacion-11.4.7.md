# Generar e instalar ARMI Docente 11.4.7

1. Mantener ARMI cerrado en ambas computadoras hasta instalar la actualización.
2. Desde la carpeta del proyecto ejecutar:

   ```powershell
   npm run dist:win
   ```

   El comando imprime la carpeta de salida dentro de `dist_electron`. No es
   necesario ejecutar scripts de modificación de notas ni copiar una base de
   datos manualmente.

3. Instalar el mismo instalador 11.4.7 en PC1 y PC2.
4. En PC1, dejar que Drive termine de sincronizar la carpeta espejo. Abrir ARMI
   y esperar que termine su primera sincronización. La preparación inicial puede
   tardar más que una apertura habitual y recargar la vista una vez.
5. Esperar que Drive termine de enviar los cambios de PC1. En PC2, esperar su
   descarga, abrir ARMI y esperar que termine la sincronización.
6. Comprobar los registros del III bimestre, incluidos 2.º B, 3.º U y 4.º U.
   Reabrir y comprobar que mantienen los mismos resultados antes de editar.

La conciliación se aplica automáticamente una sola vez y crea un respaldo por
computadora en:

```text
%APPDATA%\ARMI Docente\sync-runtime\identity-upgrade-backups\identidades-2026-10-19-v4\
```

Si Drive todavía no entregó un archivo, ARMI conserva lo local y reintenta.
Si detecta trabajo posterior sin comprobar, conserva esa base y genera un
informe en `sync-runtime`; ese caso requiere conciliar los nuevos datos antes
de continuar. No borrar checkpoints ni reemplazar bases para saltar el control.

La preparación no ha cambiado las notas de la aplicación instalada. La reparación
de las referencias y la incorporación de los paquetes verificados ocurren al
abrir la versión nueva. Los resultados académicos aprobados de PC1 se conservan.
