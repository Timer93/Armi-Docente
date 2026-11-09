(function () {
  'use strict';

  if (window.__armiGradingRuntimeLoaded) return;
  window.__armiGradingRuntimeLoaded = true;

  const MODES = {
    literal_traditional: { short: 'Literal', label: 'Literal tradicional', color: '#334155' },
    criterial_predominance: { short: 'Criterial', label: 'Criterial por evidencias', color: '#047857' },
    hybrid_vigesimal: { short: 'Híbrido', label: 'Híbrido vigesimal–literal', color: '#7c3aed' }
  };
  const MODE_DETAILS = {
    literal_traditional: {
      description: 'El docente selecciona directamente C, B, A o AD en cada criterio. El sistema conserva la escala literal durante la consolidación de sesiones, unidades y bimestre.',
      recommended: 'Conviene si desea trabajar únicamente con niveles de logro y mantener el registro tradicional solicitado por el MINEDU.',
    },
    criterial_predominance: {
      description: 'El docente también registra C, B, A o AD, pero la consolidación considera el nivel que predomina en las evidencias. Si existe empate, conserva el nivel menor para no sobrevalorar el logro; NE no participa.',
      recommended: 'Conviene para una decisión pedagógica basada en el desempeño que el estudiante demuestra con mayor frecuencia.',
    },
    hybrid_vigesimal: {
      description: 'El docente ingresa una nota de 0 a 20 por criterio y el sistema la convierte automáticamente a C, B, A o AD. Los promedios numéricos permiten diferenciar avances dentro de un mismo nivel.',
      recommended: 'Conviene si desea conservar la escala literal del MINEDU y, a la vez, disponer de mayor precisión para sesiones, unidades y bimestre.',
    },
  };
  const MODE_KEY = 'armi_active_grading_mode_v1';
  const SCORE_KEY = 'armi_hybrid_numeric_scores_v1';
  let activeMode = localStorage.getItem(MODE_KEY) || 'literal_traditional';
  window.__armiActiveGradingMode = activeMode;
  let currentSessionId = '';
  let currentScope = null;
  let modeButton = null;
  let modal = null;
  let popover = null;
  const approvedInputs = new WeakSet();
  const approvedBulkHeaders = new WeakSet();
  const recordCache = new Map();
  const pendingScores = new Map();
  const scoreRevisions = new Map();
  let loadedDataEpoch = null;
  let dataRefreshRequired = false;
  const observeGradeEpoch = (response) => {
    const epoch = response.headers.get('X-ARMI-Data-Epoch') || 'legacy';
    if (loadedDataEpoch !== null && loadedDataEpoch !== epoch) dataRefreshRequired = true;
    else loadedDataEpoch = epoch;
  };
  const gradeWriteHeaders = (headers) => {
    if (dataRefreshRequired) throw new Error('Los datos cambiaron. Recarga la vista antes de modificar las notas.');
    const result = new Headers(headers);
    let epoch = loadedDataEpoch;
    if (epoch === null) { try { epoch = window.sessionStorage.getItem('armi_backend_data_epoch'); } catch {} }
    result.set('X-ARMI-Data-Epoch', epoch || 'legacy');
    return result;
  };
  const stageScore = (key, score) => {
    pendingScores.set(key, score);
    scoreRevisions.set(key, (scoreRevisions.get(key) || 0) + 1);
  };

  const readScores = () => {
    try { return JSON.parse(localStorage.getItem(SCORE_KEY) || '{}'); } catch { return {}; }
  };
  const writeScores = (scores) => localStorage.setItem(SCORE_KEY, JSON.stringify(scores));
  const scoreKey = (sessionId, studentId, criteriaId) => `${sessionId}::${studentId}::${criteriaId}`;
  const getLevel = (score) => score >= 18 ? 'ad' : score >= 14 ? 'a' : score >= 11 ? 'b' : 'c';
  const normalizeLevel = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (['c', 'b', 'a', 'ad'].includes(raw)) return raw;
    if (raw.includes('destacad')) return 'ad';
    if (raw.includes('lograd')) return 'a';
    if (raw.includes('proceso')) return 'b';
    if (raw.includes('inicio')) return 'c';
    return '';
  };
  const formatScore = (score) => Number(score).toFixed(1).replace('.', ',');
  const formatAggregateScore = (score) => {
    const rounded = Math.round(Number(score) * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',');
  };
  const SCORE_TONES = {
    c: { background: '#e11d48', color: '#ffffff' },
    b: { background: '#f97316', color: '#ffffff' },
    a: { background: '#10b981', color: '#ffffff' },
    ad: { background: '#0ea5e9', color: '#ffffff' },
  };

  const parseSessionScope = (sessionId) => {
    const match = String(sessionId || '').match(/^(\d{4})-(.+?)-([^-]+)-([^-]+)-U(\d+)-S(\d+)$/);
    if (!match) return null;
    return { year: match[1], areaId: match[2], grade: match[3], section: match[4] };
  };

  const updateButton = () => {
    if (!modeButton) return;
    const meta = MODES[activeMode] || MODES.literal_traditional;
    modeButton.dataset.mode = activeMode;
    modeButton.style.borderColor = meta.color;
    modeButton.style.boxShadow = `0 16px 40px rgba(15,23,42,.16), 0 0 0 2px ${meta.color}20`;
    modeButton.title = `Modo de calificación: ${meta.label}. Clic para cambiar.`;
    modeButton.setAttribute('aria-label', `Cambiar modo de calificación. Modo actual: ${meta.label}`);
  };

  const saveModeForScope = async () => {
    if (!currentScope) return;
    try {
      await window.__armiOriginalFetch('/api/evaluacion/modo-calificacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...currentScope, gradingMode: activeMode })
      });
    } catch {}
  };

  const closeModal = () => {
    if (modal) modal.remove();
    modal = null;
  };

  const showModeModal = () => {
    closeModal();
    modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.52);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Segoe UI,Arial,sans-serif';
    const card = document.createElement('div');
    card.style.cssText = 'width:min(690px,95vw);max-height:90vh;overflow-y:auto;background:white;border-radius:28px;padding:26px;box-shadow:0 28px 80px rgba(15,23,42,.35)';
    card.innerHTML = '<div style="font-size:11px;font-weight:900;letter-spacing:.16em;color:#64748b;text-transform:uppercase">Configuración de evaluación</div><h2 style="margin:8px 0 5px;font-size:24px;color:#0f172a">Modo de calificación</h2><p style="margin:0 0 20px;color:#64748b;font-size:13px;line-height:1.5">Elija según la forma en que desea registrar y consolidar los aprendizajes. Cambiar de modo no convierte, mezcla ni reemplaza notas: cada modo conserva sus propios registros.</p>';
    Object.entries(MODES).forEach(([id, meta]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.cssText = `width:100%;display:block;text-align:left;margin:10px 0;padding:15px 17px;border-radius:17px;border:2px solid ${activeMode === id ? meta.color : '#e2e8f0'};background:${activeMode === id ? '#f8fafc' : 'white'};cursor:pointer`;
      const details = MODE_DETAILS[id];
      button.innerHTML = `<span style="display:flex;align-items:center;justify-content:space-between;gap:12px"><strong style="display:block;color:${meta.color};font-size:14px">${meta.label}</strong>${activeMode === id ? `<span style="padding:3px 8px;border-radius:999px;background:${meta.color};color:white;font-size:9px;font-weight:900;text-transform:uppercase">Modo actual</span>` : ''}</span><span style="display:block;margin-top:6px;color:#475569;font-size:12px;line-height:1.45">${details.description}</span><span style="display:block;margin-top:7px;color:#64748b;font-size:11px;line-height:1.4"><strong style="color:${meta.color}">Cuándo elegirlo:</strong> ${details.recommended}</span>`;
      button.addEventListener('click', async () => {
        if (id === activeMode) { closeModal(); return; }
        activeMode = id;
        window.__armiActiveGradingMode = activeMode;
        localStorage.setItem(MODE_KEY, activeMode);
        await saveModeForScope();
        updateButton();
        closeModal();
        window.location.reload();
      });
      card.appendChild(button);
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Cancelar';
    close.style.cssText = 'margin-top:12px;width:100%;padding:12px;border:0;border-radius:14px;background:#e2e8f0;color:#334155;font-weight:800;cursor:pointer';
    close.addEventListener('click', closeModal);
    card.appendChild(close);
    modal.appendChild(card);
    modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
    document.body.appendChild(modal);
  };

  const createButton = () => {
    const host = document.getElementById('armi-grading-mode-control');
    if (!host) { modeButton?.remove(); return; }
    if (modeButton) {
      if (modeButton.parentElement !== host) host.appendChild(modeButton);
      return;
    }
    modeButton = document.createElement('button');
    modeButton.type = 'button';
    modeButton.setAttribute('data-armi-grading-mode', 'true');
    modeButton.style.cssText = 'display:flex;flex-shrink:0;width:36px;height:36px;align-items:center;justify-content:center;border:1px solid #cbd5e1;border-radius:999px;padding:0;background:rgba(255,255,255,.95);box-shadow:0 16px 40px rgba(15,23,42,.16);backdrop-filter:blur(8px);cursor:pointer;transition:background .2s ease,border-color .2s ease';
    const icon = document.createElement('img');
    icon.src = '/mode.png';
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    icon.draggable = false;
    icon.style.cssText = 'width:20px;height:20px;object-fit:contain;pointer-events:none';
    modeButton.appendChild(icon);
    modeButton.addEventListener('mouseenter', () => { modeButton.style.background = '#ffffff'; });
    modeButton.addEventListener('mouseleave', () => { modeButton.style.background = 'rgba(255,255,255,.95)'; });
    modeButton.addEventListener('click', showModeModal);
    host.appendChild(modeButton);
    updateButton();
  };

  const getRadioIdentity = (input) => {
    const name = String(input.name || '');
    const prefixes = ['session-register-', 'rubrica-', 'guide-'];
    const prefix = prefixes.find((item) => name.startsWith(item));
    if (!prefix || !currentSessionId) return null;
    const rest = name.slice(prefix.length);
    const splitAt = rest.indexOf('-');
    if (splitAt < 1) return null;
    return { studentId: rest.slice(0, splitAt), criteriaId: rest.slice(splitAt + 1) };
  };

  const getRadioGroup = (input) =>
    [...document.getElementsByName(input.name)].filter((item) => item instanceof HTMLInputElement && item.type === 'radio');

  const getInputLevel = (input) => {
    const explicit = normalizeLevel(input.value || input.getAttribute('data-level') || input.closest('label')?.textContent);
    if (explicit) return explicit;
    const levels = ['c', 'b', 'a', 'ad'];
    return levels[getRadioGroup(input).indexOf(input)] || '';
  };

  const closePopover = () => {
    if (popover) popover.remove();
    popover = null;
  };

  const persistNumericScores = async (entries, sessionId = currentSessionId) => {
    const records = entries.flatMap(({ identity, level, score }) => {
      const cached = recordCache.get(scoreKey(sessionId, identity.studentId, identity.criteriaId));
      return cached ? [{ ...cached, level, grading_mode: 'hybrid_vigesimal', numeric_score: score }] : [];
    });
    if (!records.length) return;
    const response = await window.__armiOriginalFetch('/api/evaluacion/registros', {
      method: 'POST',
      headers: gradeWriteHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ gradingMode: 'hybrid_vigesimal', records }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'No se pudo guardar la nota vigesimal.');
    records.forEach(record => {
      const key = scoreKey(record.session_id, record.student_id, record.criteria_id);
      recordCache.set(key, record);
      if (pendingScores.get(key) === record.numeric_score) pendingScores.delete(key);
      scoreRevisions.set(key, (scoreRevisions.get(key) || 0) + 1);
    });
  };

  const showScorePopover = (input, identity) => {
    closePopover();
    const sessionIdAtOpen = currentSessionId;
    const epochAtOpen = loadedDataEpoch;
    const rect = input.getBoundingClientRect();
    popover = document.createElement('div');
    popover.style.cssText = `position:fixed;z-index:100001;left:${Math.min(rect.left, window.innerWidth - 265)}px;top:${Math.min(rect.bottom + 7, window.innerHeight - 175)}px;width:250px;background:white;border:2px solid #7c3aed;border-radius:18px;padding:14px;box-shadow:0 18px 45px rgba(15,23,42,.3);font-family:Segoe UI,Arial,sans-serif`;
    popover.innerHTML = `<div style="font-size:11px;font-weight:900;color:#7c3aed;text-transform:uppercase">Nota vigesimal del criterio</div><div style="margin:3px 0 10px;font-size:12px;color:#64748b">Escriba una nota de 0 a 20. El nivel C, B, A o AD se asignará automáticamente.</div><input data-score-input inputmode="decimal" style="box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:12px;font-size:16px;font-weight:800;outline:none"><div data-error style="min-height:17px;margin-top:5px;color:#dc2626;font-size:11px;font-weight:700"></div><div style="display:flex;gap:8px"><button data-cancel style="flex:1;padding:9px;border:0;border-radius:10px;background:#e2e8f0;font-weight:800;cursor:pointer">Cancelar</button><button data-save style="flex:1;padding:9px;border:0;border-radius:10px;background:#7c3aed;color:white;font-weight:800;cursor:pointer">Guardar</button></div>`;
    document.body.appendChild(popover);
    const scoreInput = popover.querySelector('[data-score-input]');
    const error = popover.querySelector('[data-error]');
    const existing = readScores()[scoreKey(currentSessionId, identity.studentId, identity.criteriaId)];
    if (existing !== undefined) scoreInput.value = String(existing).replace('.', ',');
    let saving = false;
    const save = async () => {
      if (saving) return;
      if (currentSessionId !== sessionIdAtOpen || loadedDataEpoch !== epochAtOpen || dataRefreshRequired || !document.contains(input)) {
        error.textContent = 'La sesión o los datos cambiaron. Cierra esta ventana y vuelve a abrir el criterio.';
        return;
      }
      const entered = String(scoreInput.value || '').trim();
      const score = Number(entered.replace(',', '.'));
      if (!entered || !Number.isFinite(score) || score < 0 || score > 20) {
        error.textContent = 'Ingrese una nota válida entre 0 y 20.';
        scoreInput.focus();
        return;
      }
      const level = getLevel(score);
      const target = getRadioGroup(input)[['c', 'b', 'a', 'ad'].indexOf(level)] || input;
      const scores = readScores();
      const key = scoreKey(sessionIdAtOpen, identity.studentId, identity.criteriaId);
      const previousScore = scores[key];
      const previousPending = pendingScores.get(key);
      const hadPending = pendingScores.has(key);
      scores[key] = score;
      stageScore(key, score);
      const stagedRevision = scoreRevisions.get(key);
      writeScores(scores);
      error.textContent = 'Guardando...';
      saving = true;
      try {
        // Persist the pair before React's deferred autosave can read an older cache.
        await persistNumericScores([{identity, level, score}], sessionIdAtOpen);
        if (!target.checked) {
          approvedInputs.add(target);
          target.click();
        }
        closePopover();
        window.setTimeout(decorateScores, 80);
      } catch (saveError) {
        if (scoreRevisions.get(key) === stagedRevision) {
          const restored = readScores();
          if (previousScore === undefined) delete restored[key]; else restored[key] = previousScore;
          writeScores(restored);
          if (hadPending) pendingScores.set(key, previousPending); else pendingScores.delete(key);
          scoreRevisions.set(key, stagedRevision + 1);
        }
        error.textContent = saveError.message || 'No se pudo guardar la nota.';
      } finally {
        saving = false;
      }
    };
    popover.querySelector('[data-save]').addEventListener('click', save);
    popover.querySelector('[data-cancel]').addEventListener('click', closePopover);
    scoreInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') save();
      if (event.key === 'Escape') closePopover();
    });
    scoreInput.focus();
    scoreInput.select();
  };

  const getBulkHeaderContext = (header) => {
    const levels = ['c', 'b', 'a', 'ad'];
    const level = normalizeLevel(header.textContent);
    const row = header.parentElement;
    const table = header.closest('table');
    if (!level || !row || !table) return null;
    const headers = [...row.children].filter((cell) => (
      cell.tagName === 'TH' && levels.includes(normalizeLevel(cell.textContent))
    ));
    const headerIndex = headers.indexOf(header);
    if (headerIndex < 0) return null;
    const criterionIndex = Math.floor(headerIndex / levels.length);
    const targets = [];

    table.querySelectorAll('tbody tr').forEach((studentRow) => {
      const groups = new Map();
      studentRow.querySelectorAll('input[type="radio"][name^="session-register-"]').forEach((input) => {
        if (!groups.has(input.name)) groups.set(input.name, []);
        groups.get(input.name).push(input);
      });
      const group = [...groups.values()][criterionIndex];
      if (!group?.length || group.some((input) => input.disabled)) return;
      const target = group[levels.indexOf(level)];
      const identity = target ? getRadioIdentity(target) : null;
      if (target && identity) targets.push({ target, group, identity });
    });

    return { header, level, targets };
  };

  const decorateBulkHeaders = () => {
    document.querySelectorAll('th').forEach((header) => {
      const title = String(header.title || '');
      if (header.dataset.armiBulkHeader !== 'true' && !title.startsWith('Aplicar ')) return;
      if (!['c', 'b', 'a', 'ad'].includes(normalizeLevel(header.textContent))) return;
      header.dataset.armiBulkHeader = 'true';
      const level = normalizeLevel(header.textContent).toUpperCase();
      header.title = activeMode === 'hybrid_vigesimal'
        ? `${level}: clic izquierdo para asignar una nota numérica a toda la columna · Clic derecho para limpiar la columna`
        : `${level}: clic izquierdo para aplicar el nivel a toda la columna · Clic derecho para limpiar la columna`;
    });
  };

  const showBulkScorePopover = (context) => {
    closePopover();
    const sessionIdAtOpen = currentSessionId;
    const epochAtOpen = loadedDataEpoch;
    const ranges = {
      c: { label: '0 a 10,9', placeholder: 'Ejemplo: 10' },
      b: { label: '11 a 13,9', placeholder: 'Ejemplo: 13' },
      a: { label: '14 a 17,9', placeholder: 'Ejemplo: 16' },
      ad: { label: '18 a 20', placeholder: 'Ejemplo: 19' },
    };
    const range = ranges[context.level];
    const rect = context.header.getBoundingClientRect();
    popover = document.createElement('div');
    popover.style.cssText = `position:fixed;z-index:100001;left:${Math.min(Math.max(12, rect.left - 90), window.innerWidth - 282)}px;top:${Math.min(rect.bottom + 7, window.innerHeight - 205)}px;width:270px;background:white;border:2px solid #7c3aed;border-radius:18px;padding:14px;box-shadow:0 18px 45px rgba(15,23,42,.3);font-family:Segoe UI,Arial,sans-serif`;
    popover.innerHTML = `<div style="font-size:11px;font-weight:900;color:#7c3aed;text-transform:uppercase">Nota masiva · Nivel ${context.level.toUpperCase()}</div><div style="margin:3px 0 10px;font-size:12px;color:#64748b;line-height:1.45">Ingrese una nota de ${range.label}. Se aplicará a ${context.targets.length} estudiantes evaluables de este criterio.</div><input data-score-input inputmode="decimal" placeholder="${range.placeholder}" style="box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:12px;font-size:16px;font-weight:800;outline:none"><div data-error style="min-height:17px;margin-top:5px;color:#dc2626;font-size:11px;font-weight:700"></div><div style="display:flex;gap:8px"><button data-cancel style="flex:1;padding:9px;border:0;border-radius:10px;background:#e2e8f0;font-weight:800;cursor:pointer">Cancelar</button><button data-save style="flex:1;padding:9px;border:0;border-radius:10px;background:#7c3aed;color:white;font-weight:800;cursor:pointer">Aplicar</button></div>`;
    document.body.appendChild(popover);
    const scoreInput = popover.querySelector('[data-score-input]');
    const error = popover.querySelector('[data-error]');
    let saving = false;
    const save = async () => {
      if (saving) return;
      if (currentSessionId !== sessionIdAtOpen || loadedDataEpoch !== epochAtOpen || dataRefreshRequired || !document.contains(context.header)) {
        error.textContent = 'La sesión o los datos cambiaron. Vuelve a abrir la columna.';
        return;
      }
      const entered = String(scoreInput.value || '').trim();
      const score = Number(entered.replace(',', '.'));
      if (!entered || !Number.isFinite(score) || score < 0 || score > 20 || getLevel(score) !== context.level) {
        error.textContent = `Ingrese una nota válida del nivel ${context.level.toUpperCase()} (${range.label}).`;
        scoreInput.focus();
        return;
      }
      if (!context.targets.length) {
        error.textContent = 'No hay estudiantes evaluables en esta columna.';
        return;
      }
      const scores = readScores();
      const previous = [];
      context.targets.forEach(({ identity }) => {
        const key = scoreKey(sessionIdAtOpen, identity.studentId, identity.criteriaId);
        const old = {key,score:scores[key],pending:pendingScores.get(key),hadPending:pendingScores.has(key)};
        scores[key] = score;
        stageScore(key, score);
        previous.push({...old,revision:scoreRevisions.get(key)});
      });
      writeScores(scores);
      saving = true;
      error.textContent = 'Guardando...';
      try {
        // Numeric-only edits must persist even if React's letter stays the same.
        await persistNumericScores(context.targets.map(({identity})=>({identity,level:context.level,score})),sessionIdAtOpen);
        if (currentSessionId === sessionIdAtOpen && document.contains(context.header)) {
          approvedBulkHeaders.add(context.header);
          context.header.click();
        }
        closePopover();
        window.setTimeout(() => { decorateScores(); decorateNlTitles(); }, 100);
      } catch (saveError) {
        const restored = readScores();
        previous.forEach(old=>{
          if(scoreRevisions.get(old.key)!==old.revision)return;
          if(old.score===undefined)delete restored[old.key];else restored[old.key]=old.score;
          if(old.hadPending)pendingScores.set(old.key,old.pending);else pendingScores.delete(old.key);
          scoreRevisions.set(old.key,old.revision+1);
        });
        writeScores(restored);
        error.textContent = saveError.message || 'No se pudieron guardar las notas.';
      } finally { saving = false; }
    };
    popover.querySelector('[data-save]').addEventListener('click', save);
    popover.querySelector('[data-cancel]').addEventListener('click', closePopover);
    scoreInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') save();
      if (event.key === 'Escape') closePopover();
    });
    scoreInput.focus();
  };

  const clearBulkColumn = (context) => {
    closePopover();
    if (activeMode === 'hybrid_vigesimal') {
      const scores = readScores();
      context.targets.forEach(({ identity }) => {
        delete scores[scoreKey(currentSessionId, identity.studentId, identity.criteriaId)];
      });
      writeScores(scores);
    }
    context.targets.forEach(({ group }) => {
      const checked = group.find((input) => input.checked);
      const cell = checked?.closest('td');
      if (cell) cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    });
    window.setTimeout(() => {
      decorateScores();
      decorateNlTitles();
    }, 100);
  };

  const decorateScores = () => {
    if (activeMode !== 'hybrid_vigesimal' || !currentSessionId) return;
    const scores = readScores();
    const selector = 'input[type="radio"][name^="session-register-"], input[type="radio"][name^="rubrica-"], input[type="radio"][name^="guide-"]';
    const checkedSelector = selector.split(', ').map((item) => `${item}:checked`).join(', ');

    document.querySelectorAll(selector).forEach((input) => {
      const label = input.closest('label') || input.parentElement;
      if (label) {
        label.querySelectorAll('[data-armi-score-badge]').forEach((badge) => badge.remove());
        const cleanTitle = String(label.title || '')
          .replace(/(?:\s*·\s*)?Equivalente vigesimal:\s*[\d,.]+/gi, '')
          .trim();
        if (label.title !== cleanTitle) label.title = cleanTitle;
      }
      input.closest('td')?.querySelectorAll('[data-armi-tooltip-score]').forEach((badge) => {
        if (!input.checked) badge.remove();
      });
    });

    document.querySelectorAll(checkedSelector).forEach((input) => {
      const identity = getRadioIdentity(input);
      if (!identity) return;
      const score = scores[scoreKey(currentSessionId, identity.studentId, identity.criteriaId)];
      if (score === undefined) return;
      const cell = input.closest('td');
      const tooltipHeader = cell?.querySelector('.pointer-events-none > div:first-child');
      if (!tooltipHeader) return;
      const level = getLevel(Number(score));
      const tone = SCORE_TONES[level] || SCORE_TONES.c;
      let badge = tooltipHeader.querySelector('[data-armi-tooltip-score]');
      if (!badge) {
        badge = document.createElement('span');
        badge.setAttribute('data-armi-tooltip-score', 'true');
        badge.style.cssText = 'display:inline-flex;align-items:center;margin-left:6px;padding:2px 7px;border-radius:999px;color:white;font-size:10px;font-weight:900;line-height:1.2;vertical-align:middle';
        tooltipHeader.appendChild(badge);
      }
      const inconsistent = getInputLevel(input) !== level;
      const formattedScore = inconsistent ? `${formatScore(score)} · Revisar letra/nota` : formatScore(score);
      if (badge.textContent !== formattedScore) badge.textContent = formattedScore;
      if (badge.dataset.level !== level) {
        badge.dataset.level = level;
        badge.style.background = tone.background;
        badge.style.color = tone.color;
      }
    });
  };

  const decorateNlTitles = () => {
    if (activeMode !== 'hybrid_vigesimal' || !currentSessionId) return;
    const evidenceHint = 'Clic para adjuntar evidencias de esta nota';
    if (!document.getElementById('armi-nl-tooltip-styles')) {
      const style = document.createElement('style');
      style.id = 'armi-nl-tooltip-styles';
      style.textContent = `
        [data-armi-nl-tooltip-host="true"] { position: relative !important; }
        [data-armi-nl-tooltip="true"] { display: none; }
        [data-armi-nl-tooltip-host="true"]:hover > [data-armi-nl-tooltip="true"],
        [data-armi-nl-tooltip-host="true"]:focus-within > [data-armi-nl-tooltip="true"] { display: block; }
      `;
      document.head.appendChild(style);
    }
    const scores = readScores();
    const candidates = [...document.querySelectorAll('td')].filter((cell) => (
      cell.dataset.armiNlTitle === 'true' || String(cell.title || '').includes(evidenceHint)
    ));

    candidates.forEach((cell) => {
      const originalTitle = String(cell.title || '').trim();
      if (!cell.dataset.armiNlDescription && originalTitle.includes(evidenceHint)) {
        const description = originalTitle
          .replace(evidenceHint, '')
          .replace(/^[\s·|\-–—]+|[\s·|\-–—]+$/g, '')
          .replace(/^(?:AD|A|B|C)(?:\s+\d+(?:[.,]\d+)?)?\s*[:\-–—·]\s*/i, '')
          .trim();
        if (description) cell.dataset.armiNlDescription = description;
      }
      cell.dataset.armiNlTitle = 'true';
      cell.dataset.armiNlTooltipHost = 'true';
      cell.removeAttribute('title');
    });
    candidates.forEach((cell) => {
      const row = cell.closest('tr');
      if (!row) return;
      const cells = [...row.children];
      const cellIndex = cells.indexOf(cell);
      let startIndex = 0;
      for (let index = cellIndex - 1; index >= 0; index -= 1) {
        if (cells[index]?.dataset?.armiNlTitle === 'true') {
          startIndex = index + 1;
          break;
        }
      }

      const groups = new Map();
      cells.slice(startIndex, cellIndex).forEach((currentCell) => {
        currentCell.querySelectorAll('input[type="radio"][name^="session-register-"]').forEach((input) => {
          if (!groups.has(input.name)) groups.set(input.name, input);
        });
      });

      const numericValues = [...groups.values()].map((input) => {
        const identity = getRadioIdentity(input);
        if (!identity) return null;
        const value = Number(scores[scoreKey(currentSessionId, identity.studentId, identity.criteriaId)]);
        return Number.isFinite(value) && value >= 0 && value <= 20 ? value : null;
      });
      const complete = numericValues.length > 0 && numericValues.every((value) => value !== null);
      const levelSpan = [...cell.querySelectorAll('span')].find((span) => !span.closest('[data-armi-nl-tooltip="true"]'));
      const displayedLevel = String(levelSpan?.textContent || '').trim();
      let level = !displayedLevel || displayedLevel === '...' || displayedLevel === '-' ? '' : displayedLevel.toLowerCase();
      let numericScore = null;

      if (complete) {
        numericScore = numericValues.reduce((sum, value) => sum + Number(value), 0) / numericValues.length;
        const scoreForLevel = cell.closest('[data-numeric-average-rounding="nearest_integer"]') ? Math.round(numericScore) : numericScore;
        level = getLevel(scoreForLevel);
      }

      let tooltip = cell.querySelector(':scope > [data-armi-nl-tooltip="true"]');
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.dataset.armiNlTooltip = 'true';
        tooltip.style.cssText = 'position:absolute;bottom:calc(100% + 8px);left:50%;z-index:80;width:260px;transform:translateX(-50%);border:1px solid #e2e8f0;border-radius:14px;background:rgba(255,255,255,.98);padding:12px;text-align:left;box-shadow:0 18px 40px rgba(15,23,42,.20);backdrop-filter:blur(8px);pointer-events:none;color:#334155;font-family:inherit;white-space:normal';
        const header = document.createElement('div');
        header.dataset.armiNlHeader = 'true';
        header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;color:#334155;font-size:13px;font-weight:900;line-height:1.2';
        const description = document.createElement('div');
        description.dataset.armiNlDescriptionText = 'true';
        description.style.cssText = 'color:#475569;font-size:12px;font-weight:500;line-height:1.45';
        const footer = document.createElement('div');
        footer.textContent = evidenceHint;
        footer.style.cssText = 'margin-top:10px;color:#94a3b8;font-size:10px;font-weight:700;line-height:1.3';
        tooltip.append(header, description, footer);
        cell.appendChild(tooltip);
      }

      const levelLabel = level ? level.toUpperCase() : '...';
      const formattedScore = numericScore === null ? '' : formatScore(numericScore);
      const descriptionText = cell.dataset.armiNlDescription || (complete
        ? 'Resultado consolidado de los criterios evaluados para esta nota de logro.'
        : 'Complete las notas numéricas de todos los criterios para obtener el promedio vigesimal.');
      const signature = `${levelLabel}|${formattedScore}|${descriptionText}`;
      if (tooltip.dataset.signature !== signature) {
        tooltip.dataset.signature = signature;
        const header = tooltip.querySelector('[data-armi-nl-header="true"]');
        const description = tooltip.querySelector('[data-armi-nl-description-text="true"]');
        header.replaceChildren(document.createTextNode(`NL · ${levelLabel}`));
        if (formattedScore) {
          const tone = SCORE_TONES[level] || SCORE_TONES.c;
          const badge = document.createElement('span');
          badge.textContent = formattedScore;
          badge.style.cssText = `display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;background:${tone.background};color:${tone.color};font-size:10px;font-weight:900;line-height:1.2`;
          header.appendChild(badge);
        }
        description.textContent = descriptionText;
      }
    });
  };

  document.addEventListener('contextmenu', (event) => {
    if (activeMode === 'hybrid_vigesimal' && event.target instanceof Element) {
      const input = event.target.closest('td')?.querySelector('input[type="radio"]');
      const identity = input && !input.disabled ? getRadioIdentity(input) : null;
      if (identity) {
        const key = scoreKey(currentSessionId, identity.studentId, identity.criteriaId);
        const scores = readScores();
        delete scores[key];
        stageScore(key, null);
        writeScores(scores);
      }
    }
    const header = event.target instanceof Element ? event.target.closest('th[data-armi-bulk-header="true"]') : null;
    if (!header) return;
    const context = getBulkHeaderContext(header);
    if (!context) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    clearBulkColumn(context);
  }, true);

  document.addEventListener('click', (event) => {
    const header = event.target instanceof Element ? event.target.closest('th[data-armi-bulk-header="true"]') : null;
    if (!header || activeMode !== 'hybrid_vigesimal') return;
    if (approvedBulkHeaders.has(header)) {
      approvedBulkHeaders.delete(header);
      return;
    }
    const context = getBulkHeaderContext(header);
    if (!context) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showBulkScorePopover(context);
  }, true);

  document.addEventListener('click', (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (!input || input.type !== 'radio' || activeMode !== 'hybrid_vigesimal') return;
    const identity = getRadioIdentity(input);
    if (!identity) return;
    if (approvedInputs.has(input)) { approvedInputs.delete(input); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    showScorePopover(input, identity);
  }, true);

  window.__armiOriginalFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    let url = typeof input === 'string' ? input : input.url;
    let recordsToCache = [];
    const isRecords = /\/api\/evaluacion\/registros(?:\?|$)/.test(url);
    const method = String(init?.method || (typeof input !== 'string' ? input.method : 'GET') || 'GET').toUpperCase();

    if (isRecords && method === 'GET') {
      const parsed = new URL(url, window.location.origin);
      parsed.searchParams.set('gradingMode', activeMode);
      currentSessionId = parsed.searchParams.get('sessionId') || currentSessionId;
      currentScope = parseSessionScope(currentSessionId) || currentScope;
      url = parsed.href;
      const revisionsAtRead = new Map(scoreRevisions);
      const response = await window.__armiOriginalFetch(url, init);
      if (response.ok) observeGradeEpoch(response);
      if (activeMode === 'hybrid_vigesimal') {
        try {
          const payload = await response.clone().json();
          const scores = readScores();
          (payload?.data || []).forEach((record) => {
            const key = scoreKey(record.session_id, record.student_id, record.criteria_id);
            if (pendingScores.has(key) || (revisionsAtRead.get(key) || 0) !== (scoreRevisions.get(key) || 0)) return;
            recordCache.set(key, record);
            if (record.numeric_score === null || record.numeric_score === undefined) delete scores[key];
            else scores[key] = Number(record.numeric_score);
          });
          writeScores(scores);
          window.setTimeout(decorateScores, 30);
        } catch {}
      }
      return response;
    }

    if (isRecords && method === 'POST' && init?.body) {
      try {
        const payload = JSON.parse(String(init.body));
        payload.gradingMode = activeMode;
        if (activeMode === 'hybrid_vigesimal') {
          const scores = readScores();
          for (const record of (payload.records || [])) {
            const key = scoreKey(record.session_id, record.student_id, record.criteria_id);
            const value = pendingScores.has(key) ? pendingScores.get(key) : scores[key];
            record.numeric_score = String(record.level || '').trim() ? (value ?? record.numeric_score ?? null) : null;
            const score = record.numeric_score;
            if (String(record.level || '').trim() && (score === null || !Number.isFinite(Number(score)) || Number(score) < 0 || Number(score) > 20 || normalizeLevel(record.level) !== getLevel(Number(score)))) {
              return new Response(JSON.stringify({ success: false, message: 'La letra y la nota numérica no coinciden. Abra el criterio e ingrese la nota correcta antes de guardar.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
          }
        }
        recordsToCache = Array.isArray(payload.records) ? payload.records : [];
        init = { ...init, body: JSON.stringify(payload) };
      } catch {}
    }

    if (/\/api\/evaluacion\/modo-calificacion(?:\?|$)/.test(url) && method === 'POST') {
      init = { ...init, headers: gradeWriteHeaders(init?.headers) };
    }
    const response = await window.__armiOriginalFetch(url, init);
    if (isRecords && method === 'POST' && response.ok) {
      recordsToCache.forEach((record) => {
        const key = scoreKey(record.session_id, record.student_id, record.criteria_id);
        recordCache.set(key, record);
        if (pendingScores.get(key) === record.numeric_score) pendingScores.delete(key);
        scoreRevisions.set(key, (scoreRevisions.get(key) || 0) + 1);
      });
    }
    return response;
  };

  const observer = new MutationObserver(() => {
    createButton();
    decorateScores();
    decorateNlTitles();
    decorateBulkHeaders();
  });
  const start = () => {
    createButton();
    decorateScores();
    decorateNlTitles();
    decorateBulkHeaders();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();


