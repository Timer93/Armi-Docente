# Error de arranque después de instalar 11.4.11

El último inicio del log instalado del 20/10/2026 registra, en UTC:

- 03:50:12: backend listo.
- 03:50:13: interfaz principal lista.
- 03:50:13: `ERR_ABORTED (-3) loading http://127.0.0.1:3000/`.
- El manejador fatal detuvo el backend y mostró el cuadro de error.

La cancelación de una navegación por una recarga se estaba tratando como un
fallo definitivo. La interfaz recarga al adoptar una nueva época de datos;
varias respuestas simultáneas podían programar múltiples recargas.

11.4.12 programa una sola recarga por documento y espera que termine la
navegación local que sustituye a la cancelada. No reinicia esa navegación ni
detiene el backend por el código -3. Un error real de conexión, caída del
renderer, dirección inesperada o vencimiento del plazo sí mantiene el fallo
explícito. Cerrar durante la carga libera la espera y sus listeners.

Validación:

- `npm run test:startup-navigation`: cancelación, rechazo tardío, fallo real,
  subframes, tiempo máximo, cierre, destino inesperado y recarga única.
- `npm run test:startup-navigation-real`: Electron real con ventana oculta,
  recarga durante la carga inicial y servidor disponible después de ella.
- Pruebas del cierre seguro, protección de la época de datos y contenido del
  instalador. Revisión de tipos y compilación de producción.
- Base instalada consultada únicamente en lectura: `quick_check=ok`, 21407
  notas, 1332 conclusiones y 168 estudiantes. No se restauró ni editó.

Generar manualmente el instalador con `npm run dist:win` e instalar 11.4.12.
Esta versión incluye las correcciones anteriores del portal y de las etiquetas
HTML de las sesiones. No es necesario reinstalar versiones intermedias.
