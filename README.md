<div align="center">
  <img
    width="1200"
    height="475"
    alt="GHBanner"
    src="https://drive.google.com/uc?export=view&id=1gIUL2sunSAjwzAhh54hzYAkT3T6TRw-p"
  />
</div>

# Ejecuta e implementa tu aplicación de AI Studio

Esto contiene todo lo necesario para ejecutar tu aplicación localmente.

Visualiza tu app en AI Studio: https://ai.studio/apps/drive/1AEweDx5ZnJrswEH3srppr8gY6tsPc9Ai

## Ejecutar localmente

**Requisitos previos:** Node.js

1. Instala las dependencias:

`npm install`
2. Configura `GEMINI_API_KEY` en [.env.local](.env.local) con tu clave API de Gemini.
3. Ejecuta la app:

`npm run dev`

## Modo local y modo espejo de Google Drive

Este proyecto ahora admite dos modos de almacenamiento:

- `Solo local`: todo permanece en el ordenador actual.
- `Espejo de Google Drive`: la app sigue funcionando localmente, pero también mantiene una carpeta espejo sincronizada en Google Drive para escritorio.

Qué se sincroniza:

- Datos SQLite exportados desde la base de datos local.
- Archivos de `uploads/`.
- Archivos de `temp/`.
- Estado del frontend almacenado en `localStorage` en `armi_*`

Cómo funciona el modo espejo:

- La aplicación guarda sus datos de trabajo localmente.
- Se escribe una copia espejo en una carpeta de Google Drive en el escritorio, elegida por el usuario.
- La aplicación compara los manifiestos mediante la marca de tiempo y el resumen.
- Si el espejo es más reciente, la aplicación puede descargarlo al equipo local.
- Si el equipo local es más reciente, la aplicación puede enviar los cambios al espejo.

Medidas de seguridad incluidas:

- Se crean puntos de restauración locales antes de descargar los datos del espejo.
- Los archivos del espejo eliminados se mueven a una papelera de seguridad dentro de `.armi-sync/trash`.
- Se utilizan escrituras atómicas para los manifiestos y los archivos copiados.
- Si faltan archivos a los que hace referencia el manifiesto del espejo, la sincronización se detiene en lugar de sobrescribir los datos correctos.

Configuración recomendada:

1. Instalar Google Drive para escritorio.
2. Iniciar sesión con la cuenta de Google que alojará el espejo.
3. En la aplicación, seleccionar el modo `Google Drive Mirror`.
4. Seleccionar o pegar una ruta de espejo, como por ejemplo: `C:\Usuarios\TuUsuario\Google Drive\ARMI Sync`

Nota importante:

- Los datos no deben almacenarse dentro de la carpeta de instalación de la aplicación.
- La carpeta espejo es independiente de la aplicación instalada y está destinada únicamente a copias sincronizadas.
