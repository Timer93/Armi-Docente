(() => {
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const labels = { c: 'En inicio', b: 'En proceso', a: 'Logro esperado', ad: 'Logro destacado' };
  const key = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const badge = result => {
    const code = String(result?.code || '').toLowerCase();
    if (!labels[code]) return '<span class="sg-mark sg-pending" title="Todavía no hay una calificación registrada" aria-label="Pendiente">—</span>';
    const score = result?.numericScore;
    const numeric = typeof score === 'number' && Number.isFinite(score) ? new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 }).format(score) : '';
    return `<span class="sg-mark sg-${code}" title="${labels[code]}${numeric ? ` · ${numeric}/20` : ''}">${code.toUpperCase()}${numeric !== '' ? `<small>${numeric}</small>` : ''}</span>`;
  };
  const transName = name => key(name).includes('entornosvirtuales') ? 'TIC' : key(name).includes('aprendizaje') ? 'Autonomía' : name;
  const competency = (result, name) => (result?.competencies || []).find(item => item.source === 'transversal' && key(item.name) === key(name));
  window.armiStudentGrades = {
    create(host, { api, student }) {
      let data = null, areaId = '', bimester = '', view = 'bimester', unitNumber = '', revision = 0;
      const expanded = new Set();
      const render = () => {
        if (!data?.areas?.length) { host.innerHTML = '<div class="empty">Todavía no hay sesiones publicadas para mostrar tus calificaciones.</div>'; return; }
        const area = data.areas.find(item => item.id === areaId) || data.areas[0]; areaId = area.id;
        const periods = area.bimesters || [];
        const allUnits = periods.flatMap(period => period.units);
        if (!periods.some(item => item.label === bimester)) bimester = ([...periods].reverse().find(item => item.units.some(unit => unit.sessions.some(session => !!labels[session.code]))) || periods.find(item => item.units.some(unit => unit.sessionCount)) || periods[0])?.label || 'I';
        if (view === 'unit' && allUnits.some(unit => String(unit.number) === unitNumber)) bimester = periods.find(period => period.units.some(unit => String(unit.number) === unitNumber))?.label || bimester;
        const period = periods.find(item => item.label === bimester);
        if (!period) return;
        if (!period.units.some(unit => String(unit.number) === unitNumber)) unitNumber = String((period.units.find(unit => unit.gradedSessions) || period.units[0])?.number || '');
        const units = view === 'unit' ? period.units.filter(unit => String(unit.number) === unitNumber) : period.units;
        const names = [...new Set(units.flatMap(unit => [...(unit.competencies || []), ...unit.sessions.flatMap(session => session.competencies || [])]).filter(item => item.source === 'transversal').map(item => item.name))];
        const total = units.reduce((sum, unit) => sum + unit.sessionCount, 0), graded = units.reduce((sum, unit) => sum + unit.gradedSessions, 0);
        const span = 5 + names.length;
        const summaryRow = (result, title, className) => `<tr class="${className}"><th colspan="3" scope="row">${safe(title)}${result.inProgress ? ' <small>En progreso</small>' : ''}</th><td>${badge(result)}</td>${names.map(name => `<td>${badge(competency(result, name))}</td>`).join('')}<td></td></tr>`;
        const detail = session => `<div class="sg-detail-content"><div><strong>Sesión ${safe(session.number)} · ${safe(session.title)}</strong>${session.date ? `<time>${safe(session.date.split('-').reverse().join('/'))}</time>` : ''}${session.observation ? `<p><b>Comentario del docente:</b> ${safe(session.observation)}</p>` : ''}${(session.conclusions || []).map(text => `<p>${safe(text)}</p>`).join('')}</div><div>${(session.competencies || []).map(item => `<p class="sg-competency"><span><small>${item.source === 'transversal' ? 'Transversal' : 'Competencia del área'}</small>${safe(item.name || 'Competencia')}${item.observation ? `<em>${safe(item.observation)}</em>` : ''}</span>${badge(item)}</p>`).join('') || '<p>La nota se mostrará cuando el docente la registre.</p>'}</div></div>`;
        host.innerHTML = `<div class="sg-toolbar"><label>Área<select data-sg-area aria-label="Área">${data.areas.map(item => `<option value="${safe(item.id)}" ${item.id === areaId ? 'selected' : ''}>${safe(item.name)}</option>`).join('')}</select></label><label>Ver por<select data-sg-view aria-label="Ver por"><option value="bimester" ${view === 'bimester' ? 'selected' : ''}>Bimestre</option><option value="unit" ${view === 'unit' ? 'selected' : ''}>Unidad</option></select></label>${view === 'unit' ? `<label>Unidad<select data-sg-unit aria-label="Unidad">${allUnits.map(unit => `<option value="${unit.number}" ${String(unit.number) === unitNumber ? 'selected' : ''}>U${unit.number}</option>`).join('')}</select></label>` : `<div class="sg-period-tabs" role="tablist" aria-label="Bimestres">${periods.map(item => `<button type="button" role="tab" aria-selected="${item.label === bimester}" class="${item.label === bimester ? 'active' : ''}" data-sg-period="${safe(item.label)}" title="Bimestre ${safe(item.label)} · Unidades ${item.unitNumbers.join(' y ')}">${safe(item.label)}</button>`).join('')}</div>`}<span class="sg-year">${safe(data.year)}</span><button type="button" class="sg-refresh" data-sg-refresh>↻ Actualizar</button></div>
          <div class="sg-summary"><strong>${view === 'unit' ? `Unidad ${safe(unitNumber)} · Bimestre ${safe(bimester)}` : `Bimestre ${safe(bimester)} · Unidades ${period.unitNumbers.join(' y ')}`}</strong><span>${graded} de ${total} sesiones con nota</span><small>${area.gradingMode === 'hybrid_vigesimal' ? 'Notas de 0 a 20 y nivel de logro' : 'Niveles de logro'}</small></div>
          <div class="sg-grid-scroll" tabindex="0" aria-label="Tabla de calificaciones"><table class="sg-table"><thead><tr><th scope="col" class="sg-number">Unidad</th><th scope="col" class="sg-number">Sesión</th><th scope="col" class="sg-title">Sesión de aprendizaje</th><th scope="col" title="Resultado de las competencias del área">Área</th>${names.map(name => `<th scope="col" title="${safe(name)}">${safe(transName(name))}</th>`).join('')}<th scope="col" class="sg-action">Detalle</th></tr></thead><tbody>${units.map(unit => `<tr class="sg-unit-heading"><th colspan="${span}" scope="rowgroup">Unidad ${unit.number}${unit.title ? `<span title="${safe(unit.title)}">${safe(unit.title)}</span>` : ''}</th></tr>${unit.sessions.map(session => `<tr class="sg-session" data-sg-session="${safe(session.id)}"><td>U${unit.number}</td><td>S${safe(session.number)}</td><td class="sg-session-title" title="${safe(session.title)}">${safe(session.title)}</td><td>${badge(session)}</td>${names.map(name => `<td>${badge(competency(session, name))}</td>`).join('')}<td><button type="button" class="sg-detail-button" data-sg-detail="${safe(session.id)}" aria-label="Ver detalle de unidad ${unit.number}, sesión ${safe(session.number)}" aria-expanded="${expanded.has(session.id)}">${expanded.has(session.id) ? 'Ocultar' : 'Ver'}</button></td></tr>${expanded.has(session.id) ? `<tr class="sg-detail-row"><td colspan="${span}">${detail(session)}</td></tr>` : ''}`).join('') || `<tr><td colspan="${span}" class="sg-empty-unit">Aún no hay sesiones publicadas en esta unidad.</td></tr>`}${summaryRow(unit, `Resultado de la unidad ${unit.number}`, 'sg-unit-result')}`).join('')}${view === 'bimester' ? summaryRow(period, `Resultado del bimestre ${period.label}`, 'sg-bimester-result') : ''}</tbody></table></div>
          <div class="sg-legend"><span><b class="sg-ad">AD</b>Logro destacado</span><span><b class="sg-a">A</b>Logro esperado</span><span><b class="sg-b">B</b>En proceso</span><span><b class="sg-c">C</b>En inicio</span><span><b>—</b>Pendiente</span></div><p class="sg-note">Las notas se actualizan con el registro del docente. «Pendiente» indica que aún falta una calificación; no equivale a cero. Los resultados incompletos figuran en progreso.</p>`;
        host.querySelector('[data-sg-area]').onchange = event => { areaId = event.target.value; bimester = ''; unitNumber = ''; expanded.clear(); render(); };
        host.querySelector('[data-sg-view]').onchange = event => { view = event.target.value; expanded.clear(); render(); };
        const unitSelector = host.querySelector('[data-sg-unit]');
        if (unitSelector) unitSelector.onchange = event => { unitNumber = event.target.value; expanded.clear(); render(); };
        host.querySelectorAll('[data-sg-period]').forEach(button => { button.onclick = () => { bimester = button.dataset.sgPeriod; unitNumber = ''; expanded.clear(); render(); }; });
        host.querySelectorAll('[data-sg-detail]').forEach(button => { button.onclick = () => { const id = button.dataset.sgDetail; const scroll = host.querySelector('.sg-grid-scroll'); const position = scroll.scrollTop; expanded.has(id) ? expanded.delete(id) : expanded.add(id); render(); host.querySelector('.sg-grid-scroll').scrollTop = position; host.querySelectorAll('[data-sg-detail]').forEach(next => { if (next.dataset.sgDetail === id) next.focus(); }); }; });
        host.querySelector('[data-sg-refresh]').onclick = open;
      };
      const open = async () => {
        const request = ++revision, identity = String(student()?.id || '');
        host.innerHTML = '<div class="empty" role="status">Cargando tus calificaciones…</div>';
        try {
          const response = await api('/api/student-portal/grades');
          if (request !== revision || identity !== String(student()?.id || '')) return;
          data = response; render();
        } catch (error) {
          if (request !== revision || identity !== String(student()?.id || '')) return;
          host.innerHTML = `<div class="empty" role="alert"><p>${safe(error.message || 'No se pudieron cargar tus notas.')}</p><button type="button" class="sg-refresh" data-sg-retry>Volver a intentar</button></div>`;
          host.querySelector('[data-sg-retry]').onclick = open;
        }
      };
      return { open, reset() { revision++; data = null; areaId = ''; bimester = ''; unitNumber = ''; view = 'bimester'; expanded.clear(); host.replaceChildren(); } };
    },
  };
})();
