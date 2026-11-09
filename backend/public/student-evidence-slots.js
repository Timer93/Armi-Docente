(() => {
  const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const color = item => /^#[a-f0-9]{6}$/i.test(item?.color || '') ? item.color : '#334155';
  const label = item => `<small>${item.source === 'transversal' ? 'Competencia transversal' : 'Competencia del área'} · ${escape(item.competency)}</small><b>${escape(item.text)}</b>`;
  const templateLink=(session,item)=>{
    const template=(session.evidenceTemplates || []).find(t=>t.evidence_id===item.id);if(!template)return '';
    const w=template.window || {},date=value=>new Intl.DateTimeFormat('es-PE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/Bogota'}).format(new Date(value));
    const hasWindow=Number.isFinite(Date.parse(w.openAt)) && Number.isFinite(Date.parse(w.closeAt));
    const status=w.status==='open'?`Disponible hasta ${hasWindow?date(w.closeAt):'el fin de la clase'}`:w.status==='upcoming'?`Disponible desde ${hasWindow?date(w.openAt):'el inicio de la clase'}`:w.status==='closed'?'Horario de edición finalizado':'Consulta el horario de clase';
    return `<a class="requested-evidence-picker" style="margin-top:8px" href="armi-template:${encodeURIComponent(session.id)}:${encodeURIComponent(template.id)}">✎ Desarrollar plantilla · ${template.mode==='group'?'Grupal':'Individual'}</a><small>${escape(status)}</small>`;
  };
  window.ArmiEvidenceSlots = {
    renderExpected(session, host) {
      const items = session.requestedEvidences || [];
      host.innerHTML = items.length ? `<span class="feedback-label">Evidencias que debes presentar</span>${items.map(item => `<div class="requested-evidence-summary" style="--evidence-color:${color(item)}">${label(item)}${templateLink(session,item)}</div>`).join('')}` : '';
      host.classList.toggle('hidden', !items.length);
    },
    render(state, { accept, onSelect }) {
      const host = document.getElementById('requestedEvidenceSlots');
      const items = state.selected?.requestedEvidences || [];
      host.hidden = !items.length || Boolean(state.replaceEvidenceId);
      const legacyPicker = document.querySelector('#uploadArea > label.drop');
      if (legacyPicker) legacyPicker.hidden = items.length > 0 || Boolean(state.replaceEvidenceId);
      host.innerHTML = host.hidden ? '' : items.map(item => {
        const sent = state.files.filter(file => file.isLatest && file.requestedEvidence?.id === item.id).length;
        return `<section class="requested-evidence-slot" style="--evidence-color:${color(item)}" data-requested-slot="${escape(item.id)}">
          <header>${label(item)}<span>${sent} archivo(s) enviado(s)</span></header>
          <label class="requested-evidence-picker">＋ Agregar archivos para esta evidencia
            <input class="file-input" type="file" multiple accept="${escape(accept)}" data-requested-input="${escape(item.id)}" ${window.armiStudentUploadStatus && window.armiStudentUploadStatus !== 'IDLE' ? 'disabled' : ''}>
          </label><div class="evidence-drafts" data-requested-drafts="${escape(item.id)}"></div>
        </section>`;
      }).join('');
      host.querySelectorAll('[data-requested-input]').forEach(input => input.onchange = () => {
        const files = Array.from(input.files || []); input.value = '';
        onSelect(files, input.dataset.requestedInput);
      });
    },
    placeDrafts(state) {
      const host = document.getElementById('fileDrafts');
      document.querySelectorAll('[data-requested-drafts]').forEach(container => container.replaceChildren());
      host.querySelectorAll('[data-file-draft]').forEach(node => {
        const file = state.filesToUpload[Number(node.dataset.fileDraft)];
        const container = [...document.querySelectorAll('[data-requested-drafts]')].find(container => container.dataset.requestedDrafts === file?.requestedEvidenceId);
        if (container) container.appendChild(node);
      });
    },
    fileLabel(item) {
      const requested = item.requestedEvidence;
      return requested ? `<div class="requested-file-label" style="--evidence-color:${color(requested)}">${label(requested)}</div>` : '<div class="requested-file-label legacy">Entrega anterior sin categoría asignada</div>';
    },
    setBusy(busy) {
      document.querySelectorAll('#uploadArea input[type=file], #uploadArea [data-remove-draft]').forEach(input => input.disabled = busy);
    },
  };
})();
