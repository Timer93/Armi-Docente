# ARMI: informe para decidir mejoras

Fecha: 6 de septiembre de 2026.

Este documento propone cambios. No autoriza ni aplica ninguno. Puedes editarlo directamente y devolverlo con tus decisiones.

## Cómo usar este informe

En cada propuesta cambia **PENDIENTE** por **APLICAR**, **NO APLICAR**, **MÁS ADELANTE** o **MODIFICAR**. Escribe tus condiciones en “Mis comentarios”. Si una propuesta depende de otra, se indica expresamente.

Las recomendaciones son mi criterio técnico; tú decides el comportamiento del producto. Los tamaños son mediciones de archivos, no promesas de cuánto bajará el instalador. Los tiempos futuros necesitan pruebas.

## Primero: tres cosas que parecen iguales, pero son diferentes

Piensa en ARMI como una escuela:

- **El instalador es el camión de mudanza.** Lleva las cosas necesarias para preparar la escuela. Si quitamos cajas repetidas, el camión pesa menos.
- **La aplicación abierta es la escuela funcionando.** Puede tener un camión pequeño y aun así trabajar despacio si todos hacen fila ante una sola oficina.
- **Google Drive es el mensajero.** Lleva copias a otro lugar. Que el mensajero esté presente no demuestra que ya entregó todos los paquetes.

Por eso, reducir el instalador no garantiza que las pantallas carguen más rápido. Son trabajos relacionados, pero hay que medirlos por separado.

## Qué revisé y qué falta medir

Revisé la configuración de instalación, el contenido real de `app.asar` del paquete más reciente, el inicio del servidor, la detección de Drive y partes de las pantallas de Sesiones, Unidades y Estudiantes.

**Confirmado:** hay archivos de compilación y respaldos históricos dentro del paquete; Drive puede iniciarse al consultar su estado; existen consultas consecutivas y cargas de información que pueden reducirse.

**Todavía no confirmado:** qué causa explica la mayor parte de la demora que tú percibes en cada pantalla, cuánto ahorrará el instalador final y por qué Google Drive muestra su ventana en tu equipo. Para eso hace falta observar la aplicación en funcionamiento y registrar tiempos y eventos.

Esta revisión no modificó el código, la base de datos ni la configuración de Drive. Solo creó este informe.

---

## 1. Un instalador más liviano, con lo necesario adentro

### Lo que encontramos

El instalador más reciente revisado pesa aproximadamente **253 MiB**. MiB es una medida de tamaño parecida a los MB que ves en Windows.

Dentro de la aplicación hay estos grupos importantes:

| Grupo | Tamaño aproximado sin comprimir | Explicación sencilla |
|---|---:|---|
| Herramienta para elegir carpetas y sus archivos de construcción | 232 MiB | Lleva el programa final y materiales usados para construirlo. |
| Base de datos y respaldos dentro del paquete principal | 89 MiB | Incluye la base actual y dos respaldos antiguos. |
| Otra copia de esa carpeta de base de datos, fuera del paquete principal | 89 MiB | El mismo grupo también se distribuye como recurso externo. |
| Bibliotecas incluidas en el inventario del paquete | 229 MiB | Herramientas que utiliza ARMI; algunas contienen partes adicionales. |
| Cloudflare para el acceso remoto | 52 MiB | Permite las conexiones remotas que usan esa herramienta. |

Estas cifras **no se suman para calcular el ahorro del instalador**. El instalador comprime archivos y parte del inventario corresponde a archivos distribuidos fuera de `app.asar`.

### I1. No llevar los materiales de construcción de la herramienta de carpetas

**Hoy:** `FolderPickerHelper` ocupa aproximadamente 114 MiB en `bin`, 10 MiB en `obj` y 108 MiB en `publish`. Es como llevar el escritorio terminado, otro escritorio desmontado y las herramientas de fabricación.

**Propuesta:** comprobar qué utiliza ARMI y empaquetar solamente lo que necesita para elegir una carpeta. Empezar por excluir `bin` y `obj` del instalador, conservándolos en el proyecto si se necesitan para desarrollar.

**Qué ganarías:** esos dos grupos representan alrededor de 124 MiB de contenido sin comprimir que podrían dejar de distribuirse. El ahorro comprimido será distinto.

**Qué debes decidir:** mantener exactamente la experiencia actual de selección de carpetas. No estamos proponiendo eliminar esa función.

**Qué hay que cuidar:** confirmar que ninguna ruta de ejecución utiliza `bin`. La búsqueda revisada no encontró una referencia directa por nombre al ayudante, pero eso no basta para asegurar que todo él sea prescindible.

**Prueba para aceptar:** elegir carpetas de evidencias, sincronización y exportación de documentos en una instalación limpia.

**Recomendación:** prioridad alta; primero verificar las rutas de uso.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### I2. Guardar los respaldos antiguos, pero no repartirlos en cada instalación

**Hoy:** se empaquetan dos respaldos históricos que suman aproximadamente 58 MiB, y la carpeta que los contiene aparece en dos ubicaciones del paquete.

**Propuesta:** conservar esos respaldos en tu almacenamiento de seguridad y excluirlos únicamente de los nuevos instaladores.

**Ejemplo:** guardamos las copias de seguridad en el archivo del director; no entregamos todas esas copias cada vez que alguien instala una escuela nueva.

**Qué ganarías:** menos contenido distribuido, sin borrar tus respaldos originales.

**Implicación:** un usuario nuevo no recibiría esos puntos históricos de restauración. Sí conservaría la base inicial que decidamos distribuir.

**Qué hay que cuidar:** preparar la base inicial con una copia consistente de SQLite. No quitar archivos `-wal` a ciegas: pueden contener cambios aún no integrados en el archivo principal.

**Prueba para aceptar:** instalar desde cero y actualizar una instalación con datos, comprobando que los datos existentes permanecen.

**Recomendación:** prioridad alta.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### I3. Llevar una sola copia de la base inicial y las plantillas

**Hoy:** las reglas de empaquetado incluyen la base tanto dentro de `app.asar` como en recursos externos. Las plantillas de Word también tienen dos ubicaciones previstas.

**Propuesta:** elegir una ubicación oficial y hacer que todos los lectores la utilicen.

**Ejemplo:** una sola biblioteca bien señalizada, en lugar de dos bibliotecas con los mismos libros.

**Ventaja:** menos tamaño y menos dudas sobre qué copia usa cada función.

**Implicación para desarrollo:** revisar el primer arranque, la recuperación de catálogos y las exportaciones. No basta con borrar una carpeta.

**Protección de datos:** esto trata de la base que viaja en el instalador, no de sustituir la base del docente. En la aplicación instalada los datos de trabajo se guardan en el perfil del usuario.

**Prueba para aceptar:** instalación nueva, actualización con datos y generación de los tres tipos de documentos Word.

**Recomendación:** prioridad alta, después de definir la base inicial con I2.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### I4. Llevar solo las bibliotecas y archivos necesarios

**Hoy:** se distribuyen bibliotecas de la interfaz, código fuente y herramientas. Algunas bibliotecas de la interfaz ya forman parte del resultado compilado.

**Propuesta:** revisar una por una las dependencias reales del servidor y de Electron; excluir del instalador las que solo se necesitan para construir la interfaz. Hacer lo mismo con código fuente, ejemplos y archivos de depuración que no se usan al ejecutar.

**Ejemplo:** llevar el libro terminado, sin llevar también todos los borradores y las herramientas de imprenta.

**Qué hay que cuidar:** no eliminar `src` completo. ARMI usa imágenes e iconos de esa carpeta al arrancar y en el portal estudiantil. Tampoco retirar SQLite, las herramientas de imágenes o las de documentos solo porque pesan mucho.

**Implicación:** exige pruebas de todas las funciones, porque una biblioteca puede usarse únicamente al pulsar un botón poco frecuente.

**Recomendación:** prioridad media, después de las duplicaciones más evidentes.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### I5. Comprimir más el instalador

**Propuesta:** comparar configuraciones de compresión después de limpiar el contenido.

**Ejemplo:** doblar mejor la ropa que sí necesitamos llevar.

**Ventaja:** puede disminuir la descarga. **Costo:** puede tardar más en fabricarse o instalarse. No acelera por sí solo las pantallas de ARMI.

**Prueba para aceptar:** comparar tamaño, tiempo de instalación y funcionamiento en el mismo equipo.

**Recomendación:** prioridad baja, al final.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### I6. Descargar herramientas después de instalar

**Propuesta alternativa:** un instalador pequeño que descargue algunas herramientas cuando se necesiten.

**Ventaja:** descarga inicial más pequeña. **Implicación importante:** una instalación sin Internet podría quedar sin funciones hasta descargar esas herramientas. Traslada parte del peso a otro momento; no lo hace desaparecer.

**Recomendación:** dejar pendiente si tu condición es que el instalador incluya todo lo necesario. No retirar Cloudflare del paquete sin decidir primero cómo quedaría el acceso remoto.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

---

## 2. Google Drive: que ayude sin interrumpir

### Qué hace hoy, explicado paso a paso

1. ARMI pregunta a Windows si existe el proceso de Google Drive.
2. Guarda esa respuesta durante 15 segundos para no repetir siempre la consulta.
3. Si encuentra Drive abierto, esta ruta del código no vuelve a lanzarlo.
4. Si considera que está cerrado, está activado el modo espejo y encuentra el programa, intenta abrirlo con una opción de inicio silencioso.
5. Impide otro intento durante 60 segundos. Después puede volver a intentarlo si otra consulta sigue dando “cerrado”.

**Dos detalles importantes:** un error al preguntar a Windows también termina convertido en “no está abierto”. Y comprobar el estado tiene el efecto adicional de poder abrir Drive. Esta comprobación se utiliza en varios lugares, incluido el trabajo de sincronización.

Los 15 y 60 segundos son límites y tiempos de recuerdo, no una afirmación de que la ventana se abre exactamente cada minuto. La sincronización tiene un intervalo predeterminado de 30 segundos y también puede recibir solicitudes anticipadas; no todos los ciclos llegan necesariamente a abrir Drive.

El código intenta un inicio silencioso. Eso no garantiza que Google Drive nunca muestre ventanas propias de inicio de sesión, avisos o errores. Todavía no hemos registrado cuál de esas situaciones ocurre en tu equipo.

### D1. Abrir Drive como máximo una vez por sesión de ARMI

**Esta opción se parece a tu ejemplo.**

**Comportamiento propuesto:** “Al iniciar la sincronización, ARMI pregunta si Drive está abierto. Si está abierto, lo deja tranquilo. Si está cerrado, intenta abrirlo una sola vez. Después puede seguir comprobando su estado, pero no vuelve a abrirlo automáticamente durante esa sesión de ARMI”.

**Ejemplo:** el profesor llama una vez al mensajero. Si ya vino, no vuelve a llamarlo. Si no vino después del intento, deja un aviso y continúa trabajando.

**Ventaja:** mantiene la comodidad del inicio automático y elimina los reintentos automáticos repetidos de ARMI.

**Implicaciones que debes aceptar:** si cierras Drive voluntariamente, ARMI no lo vuelve a abrir. Si el primer intento falla, tendrás que usar un botón para reintentar. Al cerrar y volver a abrir ARMI comienza una nueva sesión y puede haber otro intento.

**Trabajo de desarrollo:** separar la consulta del arranque, distinguir “cerrado” de “no pude comprobarlo”, compartir una consulta cuando varias partes pregunten a la vez y registrar si ya se hizo el intento. Bloquear también dos intentos simultáneos.

**Prueba para aceptar:** Drive abierto, cerrado, arranque lento, error de consulta y cierre manual. En todos los casos, máximo un intento automático por sesión; ningún intento por un resultado desconocido.

**Recomendación:** opción preferida si quieres conservar la comodidad automática.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### D2. ARMI nunca abre Drive por su cuenta

**Comportamiento propuesto:** “ARMI solo mira si Drive está abierto. Si está cerrado, te muestra un aviso y un botón. Lo abre únicamente cuando tú pulsas ese botón”.

**Ventaja:** control completo. ARMI no solicita aperturas automáticas.

**Implicación:** puedes trabajar y guardar localmente, pero las copias no viajarán a la nube mediante Drive Desktop mientras este no esté funcionando. Según cómo esté configurada la carpeta de Drive, puede no estar accesible cuando el programa esté cerrado.

**Prueba para aceptar:** iniciar ARMI y consultar todos los paneles con Drive cerrado; no debe producirse ningún lanzamiento automático.

**Recomendación:** alternativa a D1. No aplicar ambas como comportamiento predeterminado a la vez.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### D3. Permitir elegir entre D1 y D2 en Configuración

**Propuesta:** una opción clara: “Abrir Google Drive automáticamente una vez al iniciar la sincronización”. Activada usa D1; desactivada usa D2.

**Ventaja:** cada docente decide. **Implicación:** hay que definir el valor inicial, guardar la preferencia y comprobar ambos modos.

**Mi valor predeterminado deseado:** ____________________

**Recomendación:** útil si ARMI será usado por personas con preferencias distintas.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### D4. Explicar dónde está guardado el trabajo

**Propuesta:** distinguir “Guardado en esta PC”, “Copia preparada en la carpeta espejo” y “Drive disponible para sincronizar”. Mostrar “Confirmado en la nube” únicamente si tenemos una verificación real que lo respalde.

**Ejemplo:** poner el sobre en la bandeja del mensajero no significa que ya llegó al destinatario.

**Ventaja:** el docente sabe qué puede esperar al cambiar de computadora.

**Implicación:** puede requerir ajustar etiquetas actuales. Ver Drive abierto y una carpeta accesible no prueba por sí solo que la transferencia remota haya terminado.

**Recomendación:** compatible con D1 o D2; prioridad alta.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### D5. Dejar de depender de Drive Desktop por completo

**Propuesta de mayor alcance:** que ARMI se comunique directamente con el servicio en la nube.

**Ventaja:** no necesita abrir el programa de escritorio para ese transporte.

**Implicación:** habría que diseñar acceso a la cuenta, permisos, transferencias, reintentos, trabajo sin Internet y conflictos entre computadoras. No es un interruptor pequeño ni equivale a D2. Sus requisitos actuales necesitarían una investigación específica.

**Recomendación:** proyecto futuro independiente, no necesario para resolver las aperturas repetidas.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

---

## 3. Pantallas más rápidas

### Lo que sí sabemos

La mejora anterior dividió módulos: el archivo JavaScript principal pasó aproximadamente de 2,86 MB a 1,02 MB. Esto reduce código inicial, pero una pantalla aún puede esperar consultas o cálculos. El primer acceso a un módulo separado también necesita cargarlo.

En el código revisado hay ejemplos concretos:

- Sesiones pide datos generales, luego programaciones y luego estudiantes.
- Unidades descarga todas las unidades al entrar para saber si existe alguna, usando después solo la cantidad de elementos para esa comprobación.
- Estudiantes solicita egresados al entrar al módulo, aunque esa sección puede no ser la que estás viendo.
- El gestor de Sesiones pide todas las sesiones al abrirlo; no es una consulta que ocurra necesariamente al entrar a la pantalla principal.
- Algunas consultas de competencias y estándares se hacen consecutivamente.

Estas son oportunidades verificables. Todavía no representan un diagnóstico completo de la demora de tu equipo.

### R1. Medir antes de cambiar más cosas

**Propuesta:** registrar cuánto tarda en aparecer la pantalla, cuánto tardan sus datos y cuándo ya permite trabajar. Medir primera apertura y regreso a la misma pantalla, con sincronización activa e inactiva y con una copia representativa de los datos.

**Ejemplo:** antes de cambiar la cocina, vemos si la comida tarda por el horno, por la fila o por el reparto.

**Ventaja:** elegir la mejora que realmente ayuda. **Implicación:** es una fase de diagnóstico; por sí sola no acelera el producto.

**Prueba para aceptar:** una tabla de antes y después bajo condiciones comparables. No fijar porcentajes de mejora sin medir.

**Recomendación:** primer paso de rendimiento.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### R2. Pedir a la vez lo que no necesita esperar

**Propuesta:** en Sesiones y otros lugares, iniciar juntas las consultas independientes.

**Ejemplo:** tres alumnos buscan tres libros al mismo tiempo, en vez de mandar al segundo cuando regresa el primero.

**Ventaja:** reduce la espera acumulada cuando las consultas pueden avanzar juntas.

**Qué hay que cuidar:** si una consulta necesita el año que trae otra, debe esperar ese dato. Lanzar todo a la vez también puede saturar el servidor; se controla cuántas consultas trabajan simultáneamente.

**Prueba para aceptar:** mismos datos, errores manejados por separado y menor tiempo medido.

**Recomendación:** prioridad alta después de R1.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### R3. Hacer preguntas pequeñas cuando necesitamos respuestas pequeñas

**Propuesta concreta:** en Unidades, preguntar “¿existe alguna unidad?” en lugar de traer todas las unidades para responder sí o no. En los gestores, pedir un listado resumido y traer el documento completo al elegirlo.

**Ejemplo:** para saber si la biblioteca tiene libros, no necesitamos llevar todos los libros al escritorio.

**Ventaja:** menos lectura, envío y procesamiento, especialmente cuando crece la información.

**Implicación:** crear consultas específicas. La búsqueda global y la exportación de todos los registros deben seguir funcionando cuando se soliciten.

**Prueba para aceptar:** comparar resultados con la consulta anterior, usando pocos y muchos registros.

**Recomendación:** prioridad alta.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### R4. Cargar cada sección cuando realmente se abra

**Propuesta:** cargar egresados al entrar en Egresados; cargar editores, gráficos y funciones especiales cuando hagan falta. Evitar traerlos por adelantado sin una razón.

**Ejemplo:** repartir los materiales de pintura en la clase de Arte, no al llegar a Matemáticas.

**Ventaja:** menos trabajo inicial. **Implicación:** la primera apertura de esa sección puede mostrar una espera breve. Podemos preparar algunas secciones durante momentos de descanso del equipo, si las mediciones lo justifican.

**Prueba para aceptar:** no cargar la sección oculta, pero mostrarla completa al abrirla; conservar las funciones y selecciones del usuario.

**Recomendación:** prioridad alta para egresados y media para divisiones más complejas.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### R5. Recordar información compartida sin mostrar información vieja

**Propuesta:** varias pantallas reutilizan temporalmente datos generales y catálogos ya consultados. Si se guarda un cambio o llega una sincronización, actualizamos ese recuerdo.

**Ejemplo:** recordar el horario escolar, pero reemplazarlo cuando el director publique uno nuevo.

**Ventaja:** volver a una pantalla requiere menos consultas.

**Implicación importante:** recordar no significa convertir esa copia en la fuente definitiva. Hay que separar los datos por usuario y año, y evitar mostrar notas o estudiantes desactualizados tras cambios.

**Prueba para aceptar:** editar en una pantalla y comprobar otra; recibir un cambio desde otra PC; cambiar de usuario y año.

**Recomendación:** prioridad media; requiere buen manejo de actualización.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### R6. Mostrar listas por partes y usar vistas pequeñas de las imágenes

**Propuesta:** mostrar una página o las filas visibles de listas largas. Para evidencias, usar miniaturas conservando el archivo original para abrirlo o descargarlo.

**Ejemplo:** mirar el índice y una página del álbum, sin desplegar todas las fotos sobre la mesa.

**Ventaja:** puede reducir memoria y trabajo al dibujar la pantalla.

**Implicación:** decidir cómo funcionan “seleccionar todos”, búsqueda, impresión y exportación. Una miniatura ocupa espacio adicional; no debe reemplazar el original.

**Prueba para aceptar:** buscar y exportar registros que no estén visibles; abrir el original con su calidad intacta.

**Recomendación:** aplicar donde R1 muestre listas o imágenes costosas.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### R7. Dar prioridad al docente mientras trabaja

**Propuesta:** revisar recorridos de archivos, comparación de cambios y tareas repetidas. Repartir tareas largas en partes o llevarlas a un proceso de trabajo separado cuando sea apropiado.

**Ejemplo:** el personal puede ordenar el archivo mientras el profesor da clase, sin ocupar continuamente la misma ventanilla.

**Ventaja:** menos pausas al pulsar botones o cambiar pantallas.

**Implicación:** algunas tareas de mantenimiento podrían terminar más tarde. Un proceso separado también consume memoria. Nunca retrasar silenciosamente el guardado local ni mostrar “guardado” antes de confirmarlo.

**Prueba para aceptar:** trabajar mientras se sincroniza una copia grande; interrumpir y reanudar sin perder cambios.

**Recomendación:** prioridad según las pausas medidas; ya existen mejoras de este tipo y conviene evaluar lo restante.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

### R8. Mejorar búsquedas en la base y evitar cálculos repetidos

**Propuesta:** revisar consultas lentas e incorporar índices cuando sean útiles. Revisar también efectos de la interfaz que repiten cálculos o consultas sin cambios relevantes.

**Ejemplo:** usar un índice para encontrar a un alumno en vez de leer toda la lista cada vez.

**Ventaja:** acelera operaciones concretas si ese es el cuello de botella.

**Implicación:** los índices ocupan espacio y añaden trabajo al guardar. No se agregan a todas las columnas sin medir. Cambiar los disparadores de la interfaz puede hacer que algún dato deje de actualizarse si se hace mal.

**Prueba para aceptar:** comparar lectura y guardado; comprobar que cambios de grado, sección, unidad y año siguen refrescando lo correcto.

**Recomendación:** después de identificar consultas o repeticiones problemáticas.

**Mi decisión:** PENDIENTE. **Mis comentarios:** ____________________

---

## Hoja de decisiones del desarrollador

Puedes completar esta tabla sin tener que modificar todas las explicaciones anteriores. Nada está seleccionado por defecto.

| ID | Cambio | Mi decisión | Condiciones o comentarios |
|---|---|---|---|
| I1 | Excluir materiales de compilación del ayudante de carpetas | PENDIENTE | |
| I2 | Excluir respaldos históricos del instalador, conservándolos | PENDIENTE | |
| I3 | Una sola copia de base inicial y plantillas | PENDIENTE | |
| I4 | Revisar bibliotecas, fuentes y archivos innecesarios | PENDIENTE | |
| I5 | Comparar compresión | PENDIENTE | |
| I6 | Descargar componentes después de instalar | PENDIENTE | |
| D1 | Un intento automático de abrir Drive por sesión | PENDIENTE | Alternativa a D2 |
| D2 | Abrir Drive solo mediante un botón | PENDIENTE | Alternativa a D1 |
| D3 | Configuración para elegir D1 o D2 | PENDIENTE | Indicar valor inicial |
| D4 | Estados claros de guardado y sincronización | PENDIENTE | |
| D5 | Sustituir Drive Desktop por conexión directa | PENDIENTE | Proyecto independiente |
| R1 | Medir pantallas y operaciones | PENDIENTE | |
| R2 | Consultas independientes al mismo tiempo | PENDIENTE | |
| R3 | Consultas pequeñas y listados resumidos | PENDIENTE | |
| R4 | Cargar secciones cuando se abren | PENDIENTE | |
| R5 | Reutilizar datos y actualizarlos cuando cambien | PENDIENTE | |
| R6 | Listas por partes y miniaturas | PENDIENTE | |
| R7 | Reducir interferencia del trabajo de fondo | PENDIENTE | |
| R8 | Índices y eliminación de cálculos repetidos | PENDIENTE | |

### Mi orden recomendado, sujeto a tu decisión

1. Elegir D1 o D2 y precisar si quieres D3. Tu ejemplo encaja con D1.
2. Medir con R1 y empezar por R3, R2 y la carga de egresados de R4.
3. Preparar un instalador de prueba con I1, I2 e I3.
4. Comparar resultados antes de avanzar a I4 y optimizaciones de rendimiento más amplias.
5. Dejar I6 y D5 para una decisión de producto independiente.

### Condiciones generales que puedes editar

- Datos que deben conservarse: todos los datos del docente y archivos originales.
- Funcionamiento requerido sin Internet: ____________________
- Pantallas que más me molestan, en orden: ____________________
- Comportamiento deseado si cierro Drive manualmente: ____________________
- Tiempo de espera que considero aceptable: ____________________
- Funciones que deben probarse antes de aceptar un instalador: ____________________
- Cambios que no autorizo: ____________________

## Referencias técnicas para localizar los hallazgos

Estas referencias sirven al desarrollar; no necesitas leerlas para decidir.

- `package.json`: reglas `build.files`, `extraResources` y dependencias.
- `dist_electron/build-2026-09-06T21-20-24-055Z/win-unpacked/resources/app.asar`: inventario real inspeccionado; no se ejecutó ni alteró.
- `backend/sync.js`: `isGoogleDriveDesktopRunning`, `launchGoogleDriveDesktop`, `getDriveDesktopHealth` y `startContinuousMirrorSync`.
- `backend/paths.js` y `electron/main.cjs`: separación de recursos instalados y datos del usuario.
- `backend/server.js`: imágenes del portal y carga de Vite condicionada al entorno.
- `components/SessionsView.tsx`: consultas iniciales y `handleOpenManager`.
- `components/UnitsView.tsx`: carga de todas las unidades para calcular `hasStoredUnits`; consultas transversales.
- `components/StudentsView.tsx`: `loadStudents`, `loadGraduates` y efectos de carga.
- `App.tsx`: carga diferida de módulos y consultas compartidas.

**Límite de este informe:** identifica hallazgos del código y del paquete examinado. No certifica que la aplicación que está abierta sea exactamente esa compilación, ni promete eliminar todas las demoras sin medición. Las pruebas de instalación y rendimiento descritas son requisitos propuestos para los cambios futuros, no pruebas ya ejecutadas en esta revisión.
