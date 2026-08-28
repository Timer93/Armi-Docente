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
    if (modeButton || !document.body) return;
    modeButton = document.createElement('button');
    modeButton.type = 'button';
    modeButton.setAttribute('data-armi-grading-mode', 'true');
    modeButton.style.cssText = 'position:fixed;right:116px;bottom:20px;z-index:99990;display:flex;width:36px;height:36px;align-items:center;justify-content:center;border:1px solid #cbd5e1;border-radius:999px;padding:0;background:rgba(255,255,255,.95);box-shadow:0 16px 40px rgba(15,23,42,.16);backdrop-filter:blur(8px);cursor:pointer;transition:transform .2s ease,background .2s ease,border-color .2s ease';
    const icon = document.createElement('img');
    icon.src = '/mode.png';
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    icon.draggable = false;
    icon.style.cssText = 'width:20px;height:20px;object-fit:contain;pointer-events:none';
    modeButton.appendChild(icon);
    modeButton.addEventListener('mouseenter', () => { modeButton.style.transform = 'translateY(-2px)'; modeButton.style.background = '#ffffff'; });
    modeButton.addEventListener('mouseleave', () => { modeButton.style.transform = ''; modeButton.style.background = 'rgba(255,255,255,.95)'; });
    modeButton.addEventListener('click', showModeModal);
    document.body.appendChild(modeButton);
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

  const persistNumericScore = async (identity, level, score) => {
    const key = scoreKey(currentSessionId, identity.studentId, identity.criteriaId);
    const cached = recordCache.get(key);
    if (!cached) return;
    const record = {
      ...cached,
      level,
      grading_mode: 'hybrid_vigesimal',
      numeric_score: score,
    };
    const response = await window.__armiOriginalFetch('/api/evaluacion/registros', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gradingMode: 'hybrid_vigesimal', records: [record] }),
    });
    if (!response.ok) throw new Error('No se pudo guardar la nota vigesimal.');
    recordCache.set(key, record);
  };

  const showScorePopover = (input, identity) => {
    closePopover();
    const rect = input.getBoundingClientRect();
    popover = document.createElement('div');
    popover.style.cssText = `position:fixed;z-index:100001;left:${Math.min(rect.left, window.innerWidth - 265)}px;top:${Math.min(rect.bottom + 7, window.innerHeight - 175)}px;width:250px;background:white;border:2px solid #7c3aed;border-radius:18px;padding:14px;box-shadow:0 18px 45px rgba(15,23,42,.3);font-family:Segoe UI,Arial,sans-serif`;
    popover.innerHTML = `<div style="font-size:11px;font-weight:900;color:#7c3aed;text-transform:uppercase">Nota vigesimal del criterio</div><div style="margin:3px 0 10px;font-size:12px;color:#64748b">Escriba una nota de 0 a 20. El nivel C, B, A o AD se asignará automáticamente.</div><input data-score-input inputmode="decimal" style="box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:12px;font-size:16px;font-weight:800;outline:none"><div data-error style="min-height:17px;margin-top:5px;color:#dc2626;font-size:11px;font-weight:700"></div><div style="display:flex;gap:8px"><button data-cancel style="flex:1;padding:9px;border:0;border-radius:10px;background:#e2e8f0;font-weight:800;cursor:pointer">Cancelar</button><button data-save style="flex:1;padding:9px;border:0;border-radius:10px;background:#7c3aed;color:white;font-weight:800;cursor:pointer">Guardar</button></div>`;
    document.body.appendChild(popover);
    const scoreInput = popover.querySelector('[data-score-input]');
    const error = popover.querySelector('[data-error]');
    const existing = readScores()[scoreKey(currentSessionId, identity.studentId, identity.criteriaId)];
    if (existing !== undefined) scoreInput.value = String(existing).replace('.', ',');
    const save = async () => {
      const score = Number(String(scoreInput.value || '').replace(',', '.'));
      if (!Number.isFinite(score) || score < 0 || score > 20) {
        error.textContent = 'Ingrese una nota válida entre 0 y 20.';
        scoreInput.focus();
        return;
      }
      const level = getLevel(score);
      const target = getRadioGroup(input)[['c', 'b', 'a', 'ad'].indexOf(level)] || input;
      const scores = readScores();
      scores[scoreKey(currentSessionId, identity.studentId, identity.criteriaId)] = score;
      writeScores(scores);
      error.textContent = 'Guardando...';
      try {
        if (target.checked) {
          await persistNumericScore(identity, level, score);
        } else {
          approvedInputs.add(target);
          target.click();
        }
        closePopover();
        window.setTimeout(decorateScores, 80);
      } catch (saveError) {
        error.textContent = saveError.message || 'No se pudo guardar la nota.';
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
    const save = () => {
      const score = Number(String(scoreInput.value || '').replace(',', '.'));
      if (!Number.isFinite(score) || score < 0 || score > 20 || getLevel(score) !== context.level) {
        error.textContent = `Ingrese una nota válida del nivel ${context.level.toUpperCase()} (${range.label}).`;
        scoreInput.focus();
        return;
      }
      if (!context.targets.length) {
        error.textContent = 'No hay estudiantes evaluables en esta columna.';
        return;
      }
      const scores = readScores();
      context.targets.forEach(({ identity }) => {
        scores[scoreKey(currentSessionId, identity.studentId, identity.criteriaId)] = score;
      });
      writeScores(scores);
      approvedBulkHeaders.add(context.header);
      context.header.click();
      closePopover();
      window.setTimeout(() => {
        decorateScores();
        decorateNlTitles();
      }, 100);
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
      const formattedScore = formatScore(score);
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
        level = getLevel(numericScore);
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
      const response = await window.__armiOriginalFetch(url, init);
      if (activeMode === 'hybrid_vigesimal') {
        response.clone().json().then((payload) => {
          const scores = readScores();
          (payload?.data || []).forEach((record) => {
            recordCache.set(scoreKey(record.session_id, record.student_id, record.criteria_id), record);
            if (record.numeric_score === null || record.numeric_score === undefined) return;
            scores[scoreKey(record.session_id, record.student_id, record.criteria_id)] = Number(record.numeric_score);
          });
          writeScores(scores);
          window.setTimeout(decorateScores, 30);
        }).catch(() => {});
      }
      return response;
    }

    if (isRecords && method === 'POST' && init?.body) {
      try {
        const payload = JSON.parse(String(init.body));
        payload.gradingMode = activeMode;
        if (activeMode === 'hybrid_vigesimal') {
          const scores = readScores();
          (payload.records || []).forEach((record) => {
            const value = scores[scoreKey(record.session_id, record.student_id, record.criteria_id)];
            if (value !== undefined) record.numeric_score = value;
          });
        }
        recordsToCache = Array.isArray(payload.records) ? payload.records : [];
        init = { ...init, body: JSON.stringify(payload) };
      } catch {}
    }

    const response = await window.__armiOriginalFetch(url, init);
    if (isRecords && method === 'POST' && response.ok) {
      recordsToCache.forEach((record) => {
        recordCache.set(scoreKey(record.session_id, record.student_id, record.criteria_id), record);
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


