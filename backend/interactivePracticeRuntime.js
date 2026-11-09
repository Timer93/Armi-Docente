// Injected before the activity's scripts. The portal owns time and attempts;
// generated HTML owns only its educational state and partial result.
function practiceBridge(config) {
  let hooks, locked = false, last = '', scheduled = 0;
  const send = (type, extra = {}) => window.parent.postMessage({ type, version: 1, ...extra }, '*');
  const lock = (message) => {
    if (locked) return;
    locked = true;
    const panel = document.createElement('div');
    panel.id = 'armiPracticeLock';
    panel.setAttribute('role', 'status');
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#0f172af2;color:white;font:700 24px system-ui;text-align:center;padding:40px';
    panel.textContent = message;
    document.body.appendChild(panel);
  };
  const checkpoint = () => {
    if (!hooks || locked) return;
    try {
      const result = hooks.getResult();
      const checkpoint = { state: hooks.getState(), score: result.score, maxScore: result.maxScore, answersSummary: result.answersSummary || '' };
      const encoded = JSON.stringify(checkpoint);
      if (encoded !== last) { last = encoded; send('armi:activity-progress', { checkpoint }); }
    } catch { send('armi:activity-error', { message: 'La práctica no pudo guardar su avance. Avisa al docente.' }); }
  };
  const register = (value) => {
    if (hooks) return;
    if (!value || ['getState', 'restoreState', 'getResult'].some((name) => typeof value[name] !== 'function')) {
      send('armi:activity-error', { message: 'El HTML necesita las funciones de recuperación del nuevo prompt.' });
      return;
    }
    hooks = value;
    try {
      if (config.checkpoint?.state) hooks.restoreState(config.checkpoint.state);
      send('armi:activity-ready');
      checkpoint();
    } catch { lock('No se pudo recuperar el avance. Avisa al docente.'); }
  };
  Object.defineProperty(window, 'ARMI_PRACTICE', { value: Object.freeze({ register, checkpoint }), writable: false });
  const interaction = () => {
    if (locked) return;
    send('armi:activity-interaction');
    clearTimeout(scheduled); scheduled = setTimeout(checkpoint, 0);
  };
  ['pointerdown', 'keydown', 'input', 'change', 'scroll'].forEach((name) => document.addEventListener(name, interaction, true));
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.data?.type !== 'armi:activity-lock') return;
    checkpoint(); lock(event.data.message || 'Esta práctica ya terminó.');
  });
  const endsIn = Number(config.deadline || 0) - Number(config.serverNow || 0);
  const started = performance.now();
  setInterval(() => {
    if (!config.preview && endsIn > 0 && performance.now() - started >= endsIn) lock('Tiempo agotado. Revisa las opciones en el portal.');
    else checkpoint();
  }, 1000);
}

export const buildPracticeBridge = (config = {}) => `<script>(${practiceBridge.toString()})(${JSON.stringify(config).replace(/</g, '\\u003c')});</script>`;

export const supportsPracticeRecovery = (html) => /ARMI_PRACTICE\s*\.\s*register\s*\(/.test(String(html));
