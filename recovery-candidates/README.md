Recuperacion de copias locales

Estas carpetas son copias de seguridad separadas del runtime. No reemplazan tu base actual por si solas.

Candidatas principales

1. `2026-05-14_1335_remote-download`
   Fecha del manifiesto: `2026-05-14T20:21:07.081Z`
   Resumen: `1335` asistencias, `0` rostros
   Origen original: `sync-runtime/remote-download/2026-05-17T01-33-21-565Z`

2. `2026-05-17_1239_restore-point`
   Fecha del manifiesto: `2026-05-17T06:38:15.357Z`
   Resumen: `1239` asistencias, `11` rostros
   Origen original: `sync-runtime/restore-points/2026-05-17T06-38-14-982Z`

Estado actual confirmado

- Copia local activa: `1238` asistencias
- Copia actual de Drive: `1238` asistencias

Hallazgo importante

- No encontre un manifiesto guardado con resumen exacto de `1285` asistencias en los runtimes revisados.
- Los resultados donde aparecia `id: 1285` dentro de `database-dump.json` corresponden a identificadores internos de registros, no al total de asistencias.

Recomendacion

- Si el objetivo es rescatar la mayor cantidad posible de asistencias, la mejor candidata encontrada es la copia de `1335`.
- Si prefieres una copia mas cercana al estado reciente con los `11` rostros presentes, la mejor candidata encontrada es la de `1239`.
- No uses `Subir` ni `Traer` todavia hasta decidir cual copia quieres recuperar.
