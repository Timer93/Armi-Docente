# Mantenimiento del acceso con Google Apps Script

La versión web usa el secreto de runtime `ARMI_AUTH_APPS_SCRIPT_URL` del Worker
`armi-docente-web`. Su valor es la URL de la implementación de autenticación,
con formato `https://script.google.com/macros/s/ID/exec`.
No guardar el valor real en este documento, GitHub ni archivos públicos.

## Actualizar Apps Script conservando la URL

1. Abrir el proyecto de autenticación en Google Apps Script.
2. Ir a **Implementar → Administrar implementaciones**.
3. Seleccionar la implementación web que utiliza ARMI y pulsar **Editar** (lápiz).
4. Elegir **Nueva versión** y pulsar **Implementar**.
5. Comprobar que la URL `/exec` sigue siendo la misma y probar el acceso web.

Guardar el código por sí solo no actualiza una implementación versionada.
Crear una implementación nueva puede generar otra URL; no eliminar la anterior
hasta actualizar y verificar todos sus consumidores, incluidos los de escritorio.

## Si es necesario cambiar la URL

1. Obtener la URL `/exec` de la implementación correcta. No usar la URL `/dev`
   ni la dirección del editor de Apps Script.
2. En Cloudflare abrir **Workers y Pages → armi-docente-web → Configuración →
   Variables y secretos de runtime → Producción**.
3. Editar `ARMI_AUTH_APPS_SCRIPT_URL`, conservar el tipo **Secreto**, pegar la URL
   nueva y guardar/implementar el cambio.
4. Probar un inicio de sesión nuevo con una cuenta válida. Una sesión ya abierta
   puede seguir funcionando durante un máximo de 30 minutos sin consultar Google;
   no demuestra que la nueva URL funcione.
5. Para desarrollo local, actualizar también `web/.dev.vars` sin subirlo a GitHub.
   El escritorio mantiene su propia configuración: cambiar este secreto solo
   actualiza el Worker web.

No se necesita recompilar el código web para cambiar este secreto. No modificar
`ARMI_ADMIN_USERNAMES`, la base D1 ni el token del túnel para resolver un cambio
de URL. No desactivar la autenticación como alternativa.

## Diagnóstico si no permite entrar

- Si todos los usuarios fallan después de cambiar Apps Script, comprobar primero
  la URL configurada, la implementación activa y sus permisos de acceso/ejecución.
- El mensaje «El acceso web todavía no está configurado» indica que falta el
  secreto o que su formato no es válido.
- «El servicio de acceso no respondió» también puede indicar una caída, un tiempo
  de espera agotado, un error HTTP o una respuesta que no sea JSON. No demuestra
  por sí solo que haya cambiado la URL.
- Si falla una sola cuenta, revisar sus credenciales y membresía. No cambiar el
  endpoint global solo por el rechazo de una cuenta.
- Revisar además D1 y sus migraciones si Google responde correctamente y aun así
  falla la creación de la sesión.
- Si la implementación anterior sigue disponible, se puede restaurar su URL en
  el mismo secreto y probar de nuevo, sin borrar datos de D1.

Referencia oficial de Google sobre edición de implementaciones versionadas:
https://developers.google.com/apps-script/concepts/deployments#edit_a_versioned_deployment
