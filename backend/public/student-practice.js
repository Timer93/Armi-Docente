(() => {
  let active = null, opening = false;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const deviceInfo = () => ({ mobile: navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent),
    platform: navigator.userAgentData?.platform || navigator.platform || '',
    maxTouchPoints: navigator.maxTouchPoints || 0, screenShortSide: Math.min(screen.width, screen.height) });
  const mobile = () => {
    const info = deviceInfo();
    return info.mobile || /Android|iOS|iPadOS/i.test(info.platform) || (/arm|aarch64/i.test(info.platform) && info.maxTouchPoints > 0)
      || (info.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) || (info.maxTouchPoints > 0 && info.screenShortSide <= 600);
  };
  const isUnfinished = () => active?.attempt?.token && ['running', 'paused', 'extension_ready'].includes(active.attempt.status);
  const request = (action, extras = {}) => active.api(`${active.url}/attempt`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, attemptToken: active.attempt?.token, device: deviceInfo(), ...extras }) });
  const lockFrame = (message) => active?.frame?.contentWindow?.postMessage({ type: 'armi:activity-lock', message }, '*');
  const status = (message) => { const element = document.getElementById('interactiveActivityStatus'); if (element) element.textContent = message; };
  const panel = (title, message, buttons = []) => {
    if (!active) return;
    lockFrame(title);
    active.frame?.remove(); active.frame = null;
    const content = active.modal.querySelector('[data-practice-content]');
    content.innerHTML = `<div class="practice-panel" role="status"><div class="practice-symbol">${mobile() ? '🖥️' : '⏱️'}</div><h2>${escape(title)}</h2><p>${escape(message)}</p><div class="practice-actions"></div></div>`;
    buttons.forEach(({ text, click, danger }) => {
      const button = document.createElement('button'); button.textContent = text; button.className = danger ? 'practice-danger' : 'practice-primary';
      button.onclick = click; content.querySelector('.practice-actions').appendChild(button);
    });
  };
  const remove = () => {
    if (!active) return;
    clearInterval(active.timer); clearTimeout(active.progressTimer);
    const app = document.getElementById('appView'); if (app) app.inert = active.previousInert;
    active.modal.remove(); active = null; window.armiPracticeIsRunning = false;
    if (document.fullscreenElement?.id === 'armiInteractiveActivityModal') document.exitFullscreen().catch(() => {});
  };
  const syncProgress = async () => {
    const current = active;
    if (!current || current.attempt?.status !== 'running' || !current.checkpoint) return;
    if (current.saving) return current.savePromise;
    current.saving = true;
    const checkpoint = current.checkpoint;
    current.savePromise = (async () => {
      try {
        await request('progress', { checkpoint });
        if (active === current) { current.savedCheckpoint = checkpoint; status('Avance guardado. Las respuestas confirmadas no se pueden cambiar.'); }
      } catch (error) { if (active === current && current.attempt.status === 'running') status(`Avance pendiente: ${error.message}`); }
      finally { current.saving = false; }
    })();
    return current.savePromise;
  };
  const renderAttempt = (attempt) => {
    if (!active) return;
    if (attempt.status === 'running' && active.frame && Number.isFinite(attempt.deadline) && Number.isFinite(attempt.serverNow)) {
      const left = Math.max(0, active.timeLeft - (performance.now() - active.clockStart));
      active.timeLeft = Math.max(0, Math.min(left, attempt.deadline - attempt.serverNow));
      active.clockStart = performance.now();
    }
    active.attempt = { ...active.attempt, ...attempt }; // Status replies do not expose the lease token.
    window.armiPracticeIsRunning = attempt.status === 'running';
    if (attempt.status !== 'running' && active.displayedStatus === attempt.status) return;
    active.displayedStatus = attempt.status;
    if (attempt.status === 'paused' || attempt.status === 'extension_ready') {
      panel('Terminó el primer periodo', 'Tu avance queda guardado. Puedes continuar desde el mismo reto con 5 minutos adicionales, una sola vez.',
        [{ text: 'Continuar desde mi avance · +5 minutos', click: () => launch('continue') }]);
      status('La continuación conserva tus respuestas. No vuelve al inicio.');
    } else if (['completed', 'expired', 'abandoned'].includes(attempt.status)) {
      active.modal.querySelector('.practice-delivery-retry')?.remove();
      panel(attempt.status === 'completed' ? 'Práctica entregada' : attempt.status === 'expired' ? 'Tiempo terminado' : 'Práctica cerrada definitivamente',
        'Este intento ya no se puede resolver nuevamente. Se conserva el resultado o avance registrado.', [{ text: 'Volver al portal', click: remove }]);
      status('Intento cerrado.');
    }
  };
  const refreshAttempt = async () => {
    const current = active;
    if (!current || current.polling) return;
    current.polling = true;
    try { const response = await request('status'); if (active === current) renderAttempt(response.attempt); }
    catch (error) { if (active === current) status(error.message); }
    finally { current.polling = false; }
  };
  const tick = () => {
    if (!active) return;
    const attempt = active.attempt;
    if (attempt?.status === 'running') {
      const elapsed = performance.now() - active.clockStart;
      const left = Math.max(0, active.timeLeft - elapsed);
      active.modal.querySelector('[data-practice-timer]').textContent = `Periodo ${attempt.stage}/2 · ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
      if (left <= 0) { lockFrame('Tiempo agotado.'); void refreshAttempt(); }
      else if (active.checkpoint !== active.savedCheckpoint) void syncProgress();
    }
    if (Date.now() - (active.lastPoll || 0) > 5000) { active.lastPoll = Date.now(); void refreshAttempt(); }
  };
  const launch = async (action) => {
    const current = active;
    if (!current || current.launching) return;
    current.launching = true;
    try {
      current.touch();
      const response = await request(action);
      if (active !== current) return;
      current.attempt = response.attempt; current.checkpoint = response.attempt.checkpoint;
      current.displayedStatus = 'running';
      current.savedCheckpoint = current.checkpoint; current.clockStart = performance.now();
      current.timeLeft = response.attempt.deadline - response.attempt.serverNow;
      current.modal.querySelector('[data-practice-content]').innerHTML = '';
      const frame = document.createElement('iframe'); current.frame = frame;
      frame.title = current.title; frame.setAttribute('sandbox', 'allow-scripts allow-forms');
      current.modal.querySelector('[data-practice-content]').appendChild(frame); frame.srcdoc = response.html;
      window.armiPracticeIsRunning = true;
      status('Resuelve la práctica. Tu reloj no se reinicia con la interacción.');
      tick();
    } catch (error) { if (active === current) status(error.message); }
    finally { current.launching = false; }
  };
  const close = () => {
    if (!isUnfinished()) return remove();
    if (active.modal.querySelector('.practice-exit-warning')) return;
    const warning = document.createElement('div'); warning.className = 'practice-exit-warning'; warning.setAttribute('role', 'alertdialog');
    warning.setAttribute('aria-modal', 'true'); warning.setAttribute('aria-label', 'Confirmar salida definitiva');
    warning.innerHTML = '<div><h2>⚠️ SALIR CIERRA TU PRÁCTICA</h2><p>Si sales, se registrará el avance disponible y no podrás volver a resolverla ni usar los 5 minutos adicionales. El reloj sigue corriendo mientras decides.</p><button class="practice-primary" data-stay>Seguir en mi práctica</button><button class="practice-danger" data-leave disabled>Salir definitivamente (3)</button></div>';
    active.modal.appendChild(warning);
    warning.querySelector('[data-stay]').onclick = () => warning.remove(); warning.querySelector('[data-stay]').focus();
    let seconds = 3;
    const countdown = setInterval(() => { seconds -= 1; const button = warning.querySelector('[data-leave]'); button.textContent = seconds ? `Salir definitivamente (${seconds})` : 'Entregar el avance y salir definitivamente'; if (!seconds) { button.disabled = false; clearInterval(countdown); } }, 1000);
    warning.querySelector('[data-leave]').onclick = async () => {
      if (!active) return;
      try {
        await syncProgress();
        if (active.checkpoint !== active.savedCheckpoint) await syncProgress();
        const response = await request('abandon'); renderAttempt(response.attempt); warning.remove();
      }
      catch (error) { status(error.message); }
    };
  };
  const open = async (uri, { api, touch, token }) => {
    if (active) { close(); return; }
    if (opening) return;
    opening = true;
    try {
      const parts = String(uri || '').replace(/^armi-activity:/, '').split(':');
      const sessionId = decodeURIComponent(parts[0] || ''), activityId = decodeURIComponent(parts.slice(1).join(':'));
      if (!sessionId || !activityId) throw new Error('El enlace de práctica no es válido.');
      const url = `/api/student-portal/interactive-activities/${encodeURIComponent(sessionId)}/${encodeURIComponent(activityId)}`;
      const activity = await api(url);
      const modal = document.createElement('div'); modal.id = 'armiInteractiveActivityModal'; modal.className = 'interactive-activity-modal';
      modal.innerHTML = `<section><header><div><b>${escape(activity.title)}</b><span>${activity.mode === 'group' ? 'Un intento compartido por tu grupo.' : 'Un intento por estudiante.'} · 5 minutos + una continuación de 5.</span></div><div><strong data-practice-timer></strong><button type="button" data-fullscreen>Ampliar pantalla</button><button type="button" aria-label="Cerrar práctica" data-close>×</button></div></header><div data-practice-content></div><footer><span>Práctica en computadora de aula</span><strong id="interactiveActivityStatus"></strong></footer></section>`;
      document.body.appendChild(modal);
      active = { modal, title: activity.title, url, api, touch, token, attempt: activity.attempt, frame: null };
      const app = document.getElementById('appView');
      if (app) { active.previousInert = app.inert; app.inert = true; }
      modal.querySelector('[data-close]').onclick = close;
      modal.querySelector('[data-fullscreen]').onclick = () => modal.requestFullscreen?.().catch(() => status('El navegador no permitió ampliar la pantalla.'));
      if (mobile()) panel('Esta práctica requiere una computadora', 'Usa una computadora del aula con tu docente. El modo escritorio del celular no habilita la práctica.', [{ text: 'Volver al portal', click: remove }]);
      else if (!activity.recoverySupported && activity.attempt?.status === 'ready') panel('El docente debe actualizar este HTML', 'Este archivo todavía no guarda el avance necesario para continuar. Pide una versión creada con el nuevo prompt.', [{ text: 'Volver al portal', click: remove }]);
      else if (activity.attempt?.status === 'ready') panel('Antes de comenzar', 'Tienes 5 minutos y, si no terminas, una continuación de 5 minutos desde tu avance. Cada respuesta confirmada es definitiva. Salir cierra el intento; cambiar de pestaña o minimizar no detiene el reloj.', [{ text: 'Comenzar mi único intento · 5 minutos', click: () => launch('start') }]);
      else if (activity.attempt?.status === 'running') panel('Ya existe un intento abierto', 'Vuelve a la ventana donde comenzaste. Abrir otra ventana no reinicia la práctica ni su tiempo.');
      else renderAttempt(activity.attempt);
      if (!mobile()) active.timer = setInterval(tick, 1000);
    } catch (error) { alert(error.message); }
    finally { opening = false; }
  };
  const submitResult = async (current, payload) => {
    if (active !== current || current.submitting || current.attempt.status !== 'running') return;
    current.submitting = true; lockFrame('Registrando tu resultado…');
    try {
      await syncProgress();
      if (current.checkpoint !== current.savedCheckpoint) await syncProgress();
      const result = await current.api(`${current.url}/result`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: payload.type, version: 1, completed: payload.completed, score: payload.score, maxScore: payload.maxScore,
          answersSummary: String(payload.answersSummary || '').slice(0, 500), attemptToken: current.attempt.token }) });
      if (active === current) { renderAttempt({ status: 'completed' }); status(result.message); }
    } catch (error) {
      if (active === current) {
        status(`No se confirmó la entrega: ${error.message}`);
        let retry = current.modal.querySelector('.practice-delivery-retry');
        if (!retry) {
          retry = document.createElement('button'); retry.className = 'practice-primary practice-delivery-retry';
          retry.textContent = 'Reintentar el envío del resultado'; current.modal.querySelector('footer').appendChild(retry);
        }
        retry.onclick = () => submitResult(current, payload);
        void refreshAttempt();
      }
    }
    finally { current.submitting = false; }
  };
  window.addEventListener('message', async (event) => {
    const current = active;
    if (!current || !current.frame || event.source !== current.frame.contentWindow || current.attempt?.status !== 'running') return;
    const payload = event.data;
    if (!payload || Number(payload.version) !== 1) return;
    if (payload.type === 'armi:activity-interaction') { current.touch(); return; }
    if (payload.type === 'armi:activity-error') { status(payload.message); return; }
    if (payload.type === 'armi:activity-progress') {
      current.checkpoint = payload.checkpoint;
      clearTimeout(current.progressTimer); current.progressTimer = setTimeout(syncProgress, 150); return;
    }
    if (payload.type !== 'armi:activity-result' || current.submitting) return;
    await submitResult(current, payload);
  });
  window.addEventListener('beforeunload', (event) => { if (isUnfinished()) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', (event) => {
    if (!isUnfinished()) return;
    fetch(`${active.url}/attempt`, { method: 'POST', keepalive: true, headers: { Authorization: `Bearer ${active.token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'abandon', attemptToken: active.attempt.token }) }).catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (!active?.frame || document.hidden || active.attempt?.status !== 'running') return;
    status('Mantén la práctica en primer plano. Cambiar de pestaña o minimizar no detiene el reloj.');
    void refreshAttempt();
  });
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && active) close(); });
  window.armiPracticePortal = { open, close };
})();
