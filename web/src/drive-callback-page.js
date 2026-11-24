// Fixed messages only: never echo OAuth codes, state, provider errors or secrets.
const diagnostics={
 'DRIVE-CREDENCIALES':'Google no aceptó las credenciales de ARMI. El administrador debe comprobar que el ID de cliente y el secreto guardados en Cloudflare pertenecen al mismo cliente OAuth ARMI Web.',
 'DRIVE-AUTORIZACION':'Esta autorización venció, ya fue utilizada o pertenece a otra sesión. Vuelve a ARMI y comienza otra conexión desde Google Drive; no recargues este enlace.',
 'DRIVE-CANCELADO':'Google no devolvió una autorización completa. Vuelve a ARMI y autoriza el acceso a los archivos seleccionados desde Google Drive.',
 'DRIVE-TOKEN':'No se pudo completar el intercambio de autorización con Google. Vuelve a iniciar la conexión desde ARMI. Si se repite, comparte únicamente la referencia de este aviso con el administrador.',
 'DRIVE-PERMISOS':'Google no devolvió todos los permisos necesarios para mantener la conexión. Vuelve a ARMI y autoriza el acceso a los archivos seleccionados.',
 'DRIVE-IDENTIDAD':'No se pudo confirmar el correo verificado de tu cuenta de Google. Vuelve a conectar desde ARMI y permite el acceso a la identidad básica y a los archivos seleccionados.',
 'DRIVE-CIFRADO':'No se pudo proteger la conexión. El administrador debe revisar la clave de cifrado configurada en Cloudflare sin reemplazarla si ya hay conexiones guardadas.',
 'DRIVE-GUARDADO':'No se pudo guardar la conexión de forma segura. Vuelve a ARMI y comprueba el estado de Google Drive antes de iniciar otro intento.',
 'DRIVE-DATOS':'El administrador debe activar las tablas de la conexión de Drive en la base web.',
 'DRIVE-CONFIG':'El administrador debe completar la configuración de Google Drive en Cloudflare.',
};
export function driveCallbackPage(status=200,diagnostic=''){
 const reference=status!==200&&status!==401&&Object.hasOwn(diagnostics,diagnostic)?diagnostic:'';
 const responseReference=status===200?'DRIVE-INICIO':status===401?'DRIVE-SESION':reference||'DRIVE-CONEXION';
 const session=status===401;
 const title=status===200?'Conecta tu Google Drive':session?'Vuelve a iniciar sesión':'No se completó la conexión';
 const message=status===200?'Esta página recibe la autorización de Google. Para comenzar, abre ARMI y pulsa Google Drive → Conectar mi cuenta.':session?'Tu sesión de ARMI terminó. Inicia sesión y vuelve a conectar tu cuenta desde Google Drive.':reference?diagnostics[reference]:'La autorización pudo vencer, cancelarse o requerir que terminemos la configuración. Regresa a ARMI y vuelve a intentarlo desde Google Drive.';
 return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} · ARMI</title><style>
 *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at top,#322067,#11102a 70%);color:#fff;font:16px/1.65 system-ui,sans-serif}main{width:100%;max-width:540px;padding:40px;border:1px solid #ffffff25;border-radius:28px;background:#ffffff0c;box-shadow:0 24px 80px #0004}.brand{display:flex;align-items:center;gap:14px;font-weight:800;letter-spacing:2px}.mark{display:grid;place-items:center;width:48px;height:48px;border-radius:15px;background:#ffda35;color:#19132f;font-size:28px}small{color:#c7bedf}h1{font-size:clamp(24px,5vw,32px);line-height:1.2;margin:30px 0 16px}p{color:#ded8ed}a{display:block;margin-top:28px;padding:13px 20px;border-radius:13px;text-align:center;text-decoration:none;background:#ffda35;color:#19132f;font-weight:750}a:focus-visible{outline:3px solid white;outline-offset:5px}.note{font-size:13px;margin:20px 0 0;color:#bcb3d2}@media(max-width:480px){main{padding:28px}}
 </style></head><body><main><div class="brand"><span class="mark" aria-hidden="true">A</span><div>ARMI<br><small>DOCENTE · GOOGLE DRIVE</small></div></div><h1>${title}</h1><p>${message}</p>${reference?`<p class="note">Referencia: <strong>${reference}</strong></p>`:''}<a href="/">${session?'Iniciar sesión en ARMI':'Volver a ARMI'}</a><p class="note">Los archivos de tu Drive permanecen en tu cuenta de Google.</p></main></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow','x-armi-drive-reference':responseReference}});
}
