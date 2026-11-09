import { normalizeServerUrl, permissionPattern } from './policy.js';
const element = id => document.getElementById(id);
const labels = { applied: 'Reglas aplicadas', offline: 'Sin conexión', pending: 'Aplicación pendiente', revoked: 'Vinculación retirada', unpaired: 'Sin vincular' };
function show(state) {
  element('badge').textContent = labels[state.state] || 'Revisando';
  element('device').textContent = state.deviceName || 'Este navegador';
  element('count').textContent = String(state.blockedCount || 0);
  element('last-sync').textContent = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString('es') : '—';
  element('description').textContent = state.error || (state.native ? 'Configuración automática mediante ARMI Estudiante en Windows.' : state.paired ? `Vinculado con ${state.serverUrl}.` : 'Solicita un código al docente para vincular este equipo.');
  element('sync').hidden = !state.paired;
  element('settings').open = !state.paired;
  element('settings').hidden = state.native===true&&state.state!=='revoked';
  if (state.serverUrl) element('server').value = state.serverUrl;
}
function notice(message) { element('message').textContent = message; element('message').hidden = !message; }
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.success) throw new Error(result?.message || 'No se pudo contactar con la extensión.');
  show(result.data); return result.data;
}
async function busy(task) {
  document.body.setAttribute('aria-busy', 'true');
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  notice('');
  try { await task(); } catch (error) { notice(error.message); }
  finally { for (const button of document.querySelectorAll('button')) button.disabled = false; document.body.setAttribute('aria-busy', 'false'); }
}
element('pair-form').addEventListener('submit', event => {
  event.preventDefault();
  void busy(async () => {
    const serverUrl = normalizeServerUrl(element('server').value);
    const granted = await chrome.permissions.request({ origins: [permissionPattern(serverUrl)] });
    if (!granted) throw new Error('Autoriza la conexión a ARMI para vincular el equipo.');
    await send({ type: 'pair', serverUrl, code: element('code').value.trim() });
    element('code').value = ''; notice('Equipo vinculado y reglas aplicadas.');
  });
});
element('sync').addEventListener('click', () => void busy(async () => {
  const status = await send({ type: 'sync' });
  notice(status.state === 'applied' ? 'Reglas actualizadas.' : status.error || 'Se conservan las últimas reglas.');
}));
void busy(() => send({ type: 'status' }));
