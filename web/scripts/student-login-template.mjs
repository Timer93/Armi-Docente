// Reuse the actual Windows portal login at build time. Desktop files stay intact.
export function desktopStudentLogin(source) {
 const css=source.match(/<style>([\s\S]*?)<\/style>/)?.[1];
 const body=source.match(/<main class="shell">([\s\S]*?)<section id="appView"/ )?.[1];
 if(!css||!body||!body.includes('id="loginForm"'))throw new Error('Desktop student login structure changed; review the web adapter.');
 let html=body;
 html=html.replace(/<p class="muted">[\s\S]*?<\/p>/,'<p class="muted">Ingresa con tu DNI para consultar las sesiones publicadas por tu docente y enviar tus respuestas.</p>')
  .replaceAll('/estudiante-assets/Logo_bar.ico','/favicon.ico')
  .replaceAll('for="dni"','for="student-dni"').replace('id="dni"','id="student-dni"')
  .replace('maxlength="12"','type="text" pattern="[0-9]{8}" minlength="8" maxlength="8"')
  .replace('id="loginButton"','id="loginButton" disabled')
  .replaceAll('type="password"','type="password" maxlength="128"')
  .replace('id="loginMessage"','id="loginMessage" role="status" aria-live="polite"');
 if(!html.includes('id="studentPassword"')||!html.includes('id="passwordChangeForm"')||html.includes('<script'))throw new Error('Unexpected desktop login content');
 return {css,html};
}
