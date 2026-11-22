import { createApiClient } from './api-client.js';

const byId = id => document.getElementById(id);
let session = null;
let expiryTimer;
let unmountResponsables = null;
let loadingResponsables = false;
let viewGeneration = 0;
const client = createApiClient({ onUnauthorized: () => { if (session) showLogin('Tu sesión venció. Ingresa nuevamente para continuar.'); } });
const api = (path, method = 'GET', body) => client.request(path, method, body);
const message = (id, text, success = false) => {
  byId(id).textContent = text;
  byId(id).classList.toggle('success', success);
};
function showLogin(note = '') {
  viewGeneration++;
  loadingResponsables = false;
  unmountResponsables?.();
  unmountResponsables = null;
  byId('responsables-root').replaceChildren();
  showProfile();
  document.body.classList.remove('signed-in');
  client.reset();
  clearTimeout(expiryTimer);
  session = null;
  byId('loading').hidden = true;
  byId('workspace-view').hidden = true;
  byId('login-view').hidden = false;
  byId('profile-form').reset();
  byId('usage-panel').hidden = true;
  byId('usage-toggle').hidden = true;
  byId('usage-toggle').setAttribute('aria-expanded', 'false');
  byId('usage-accounts').replaceChildren();
  byId('usage-summary').replaceChildren();
  byId('greeting').textContent = '';
  for (const id of ['sidebar-avatar', 'sidebar-name', 'hero-institution']) byId(id).textContent = '';
  for (const id of ['account-user', 'account-plan', 'account-expiry']) byId(id).textContent = '';
  message('login-message', note);
}
function showWorkspace(data) {
  document.body.classList.add('signed-in');
  client.reset();
  session = data;
  clearTimeout(expiryTimer);
  byId('loading').hidden = true;
  byId('login-view').hidden = true;
  byId('workspace-view').hidden = false;
  byId('greeting').textContent = `Hola, ${data.user.displayName}`;
  updateProfileIdentity(data.user);
  byId('display-name').value = data.user.displayName;
  byId('institution-name').value = data.user.institutionName;
  byId('account-user').textContent = data.user.username;
  byId('account-plan').textContent = data.membership.plan || 'Membresía ARMI';
  byId('account-expiry').textContent = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' }).format(new Date(data.sessionExpiresAt));
  message('profile-message', '');
  byId('usage-toggle').hidden = !data.admin?.canViewUsage;
  expiryTimer = setTimeout(() => showLogin('Tu sesión venció. Ingresa nuevamente para continuar.'), Math.max(0, Date.parse(data.sessionExpiresAt) - Date.now()));
}
function showProfile() {
  byId('current-view-label').textContent = 'Mi perfil';
  byId('workspace-welcome').hidden = false;
  byId('responsables-panel').hidden = true;
  byId('responsables-toggle').setAttribute('aria-expanded', 'false');
  byId('responsables-toggle').classList.remove('selected');
  const profileLink = document.querySelector('.sidebar-link[href="#profile-card"]');
  profileLink.classList.add('selected');
  profileLink.setAttribute('aria-current', 'page');
  byId('profile-grid').hidden = false;
}
document.querySelector('.sidebar-link[href="#profile-card"]').addEventListener('click', showProfile);
byId('responsables-toggle').addEventListener('click', async () => {
  if (!session) return;
  byId('current-view-label').textContent = 'Responsables';
  byId('workspace-welcome').hidden = true;
  byId('profile-grid').hidden = true;
  byId('responsables-panel').hidden = false;
  byId('responsables-toggle').setAttribute('aria-expanded', 'true');
  byId('responsables-toggle').classList.add('selected');
  const profileLink = document.querySelector('.sidebar-link[href="#profile-card"]');
  profileLink.classList.remove('selected'); profileLink.removeAttribute('aria-current');
  if (unmountResponsables || loadingResponsables) return;
  loadingResponsables = true;
  const generation = viewGeneration;
  byId('responsables-root').textContent = 'Preparando responsables…';
  try {
    if (!byId('shared-responsables-css')) {
      const css = document.createElement('link'); css.id = 'shared-responsables-css'; css.rel = 'stylesheet'; css.href = '/generated/responsables.css'; document.head.append(css);
    }
    const { mountResponsables } = await import('/generated/responsables.js');
    if (generation !== viewGeneration || !session) return;
    unmountResponsables = mountResponsables(byId('responsables-root'), api);
  } catch {
    if (generation === viewGeneration) byId('responsables-root').textContent = 'No se pudo cargar el formulario. Pulsa Responsables para reintentar.';
  } finally { if (generation === viewGeneration) loadingResponsables = false; }
});
function updateProfileIdentity(user) {
  const name = user.displayName || user.username;
  byId('sidebar-name').textContent = name;
  byId('sidebar-avatar').textContent = name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase();
  byId('hero-institution').textContent = user.institutionName;
  byId('hero-institution').hidden = !user.institutionName;
}
byId('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = byId('login-button');
  button.disabled = true;
  button.textContent = 'Comprobando acceso…';
  message('login-message', '');
  try {
    const data = await api('/api/auth/login', 'POST', { username: byId('username').value.trim(), password: byId('password').value });
    byId('password').value = '';
    showWorkspace(data);
    byId('display-name').focus();
  } catch (error) { message('login-message', error.message); }
  finally { byId('password').value = ''; button.disabled = false; button.textContent = 'Ingresar'; }
});
byId('profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = byId('profile-button');
  button.disabled = true;
  message('profile-message', '');
  try {
    const displayName = byId('display-name').value.trim();
    const institutionName = byId('institution-name').value.trim();
    await api('/api/profile', 'PUT', { displayName, institutionName });
    session.user.displayName = displayName;
    session.user.institutionName = institutionName;
    byId('greeting').textContent = `Hola, ${displayName}`;
    updateProfileIdentity(session.user);
    message('profile-message', 'Tus cambios se guardaron.', true);
  } catch (error) { message('profile-message', error.message); }
  finally { button.disabled = false; }
});
byId('logout-button').addEventListener('click', async () => {
  const button = byId('logout-button');
  button.disabled = true;
  try { await api('/api/auth/logout', 'POST', {}); showLogin(); }
  catch (error) { message('profile-message', error.message); }
  finally { button.disabled = false; }
});

const number = value => new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 }).format(value);
async function refreshUsage() {
  const button = byId('usage-refresh');
  if (button.disabled) return;
  button.disabled = true;
  message('usage-message', 'Consultando mediciones…', true);
  try {
    const report = await api('/api/admin/usage?day=' + encodeURIComponent(byId('usage-day').value));
    byId('usage-summary').replaceChildren();
    byId('usage-accounts').replaceChildren();
    if (!report.available) { message('usage-message', report.message); return; }
    const labels = { requests: 'Solicitudes', rowsRead: 'Filas leídas', rowsWritten: 'Filas escritas' };
    for (const reference of report.referenceUsage) {
      const card = document.createElement('div');
      card.className = 'usage-stat ' + reference.level;
      const title = document.createElement('span'); title.textContent = labels[reference.metric];
      const total = document.createElement('strong'); total.textContent = number(report.totals[reference.metric]);
      const fraction = document.createElement('span'); fraction.textContent = `${reference.percentage.toFixed(1)} % de referencia gratuita (${number(reference.limit)})`;
      card.append(title, total, fraction); byId('usage-summary').append(card);
    }
    for (const account of report.accounts) {
      const row = document.createElement('tr');
      for (const value of [account.username, number(account.requests), number(account.rowsRead), number(account.rowsWritten), number(account.authCalls), number(account.errors)]) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      byId('usage-accounts').append(row);
    }
    message('usage-message', report.note + ' Se muestran hasta 100 cuentas con mayor actividad.', true);
  } catch (error) { message('usage-message', error.message); }
  finally { button.disabled = false; }
}
byId('usage-toggle').addEventListener('click', () => {
  const panel = byId('usage-panel');
  panel.hidden = !panel.hidden;
  byId('usage-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) {
    const today = new Date().toISOString().slice(0, 10);
    byId('usage-day').value = today;
    byId('usage-day').max = today;
    byId('usage-day').min = new Date(Date.now() - 88 * 86400_000).toISOString().slice(0, 10);
    void refreshUsage();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
byId('usage-refresh').addEventListener('click', () => { void refreshUsage(); });
api('/api/auth/session').then(showWorkspace).catch(error => showLogin(error.message === 'Inicia sesión para continuar.' ? '' : error.message));
