# Vista previa de impresión en escritorio

El inicio de la interfaz instala un manejador común para `window.print()` cuando está disponible el puente de Electron. Incluye los botones de horario, calendario, diagnóstico y registros, y Ctrl+P. En la web se conserva la impresión nativa del navegador.

Electron genera un PDF con los estilos `@media print`, el tamaño y la orientación de `@page`, espera fuentes e imágenes y abre el visor PDF integrado. El usuario puede revisar páginas, ampliar, guardar una copia o imprimir desde el visor. El diálogo final de la impresora puede seguir siendo el de Windows; la revisión del documento se realiza previamente en el visor de ARMI.

Los PDF se generan en una carpeta temporal independiente por vista previa, fuera de los datos sincronizados. Al cerrar la vista se elimina solo el archivo creado por ARMI. El visor no tiene acceso al puente privilegiado de la aplicación. La generación no envía automáticamente un trabajo a la impresora.

`npm run test:print-preview` comprueba el manejador común y ejecuta Electron real con un perfil separado y ventanas ocultas. Cubre PDF vertical, horizontal y varias páginas, apertura del visor, rechazo de otras ventanas y limpieza de archivos temporales. Deja los PDF de prueba en `artifacts/print-preview-test` para revisar el diseño. No imprime físicamente.

El cambio del proceso principal y del preload requiere reiniciar Electron. Para actualizar una instalación existente debe generarse e instalarse una nueva compilación de escritorio; recargar la web no actualiza el ejecutable instalado.
