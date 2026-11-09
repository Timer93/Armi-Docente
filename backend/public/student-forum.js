(() => {
  'use strict';
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const labels = { pregunta: 'Preguntas', aporte: 'Aportes', proyecto: 'Proyectos', debate: 'Debates' };
  const stamp = (value) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const size = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
  const categoryOptions = (selected = '') => Object.entries(labels).map(([key, label]) => `<option value="${key}" ${selected === key ? 'selected' : ''}>${label}</option>`).join('');
  // LAN portals can run over HTTP, where randomUUID is not available.
  const id = () => crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const create = (root, { api, token, student = () => ({}), onProfile = () => {}, onReplacePhoto, onUnread = () => {} }) => {
    let resources = { sessions: [], evidences: [] }, draft = { post: {}, comments: {} }, draftTimer, notificationTimer, notices = { items: [], unread: 0 }, userKey = '', initialized = false, initializing = null, loginGeneration = 0;
    const storageKey = () => `armi-forum-draft:${userKey}`;
    const storeDraft = () => { try { localStorage.setItem(storageKey(), JSON.stringify({ data: draft, updatedAt: new Date().toISOString() })); } catch {} };
    const saveDraft = async () => { clearTimeout(draftTimer); if (!token() || !userKey) return; try { await api('/api/student-portal/forum/draft', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }); } catch { /* Local backup stays available when offline. */ } };
    const changedDraft = () => { storeDraft(); clearTimeout(draftTimer); draftTimer = setTimeout(() => { void saveDraft(); }, 650); };
    const pollNotices = async () => { const capturedToken = token(), login = loginGeneration; if (!capturedToken) return; try { const result = await api('/api/student-portal/forum/notifications'); if (capturedToken !== token() || login !== loginGeneration) return; notices = result; onUnread(notices.unread); const host = root.querySelector('[data-forum-notices]'); if (host) { host.innerHTML = noticeMarkup(); bindNotices(); } } catch {} };
    const noticeMarkup = () => `<details class="forum-notices"><summary>Respuestas y avisos · ${notices.unread} sin leer</summary>${notices.items.map((item) => `<button type="button" data-forum-notice="${escape(item.postId)}" class="${item.readAt ? '' : 'unread'}">${escape(item.message)}<small>${stamp(item.createdAt)}</small></button>`).join('') || '<p>No tienes avisos todavía.</p>'}<button type="button" data-forum-read-all>Marcar todos como leídos</button></details>`;
    const bindNotices = () => { root.querySelectorAll('[data-forum-notice]').forEach((button) => { button.onclick = () => { void openPost(button.dataset.forumNotice); }; }); root.querySelector('[data-forum-read-all]')?.addEventListener('click', () => { void api('/api/student-portal/forum/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(pollNotices); }); };
    const start = () => {
      if (initializing) return initializing;
      if (initialized) return Promise.resolve();
      const login = loginGeneration;
      initializing = (async () => {
      userKey = String(student().id || token());
      initialized = true; const capturedToken = token();
      try {
        const [saved, available] = await Promise.all([api('/api/student-portal/forum/draft'), api('/api/student-portal/forum/resources')]);
        if (capturedToken !== token() || login !== loginGeneration) return;
        userKey = `${student().id || capturedToken}:${available.year || ''}`;
        let local; try { local = JSON.parse(localStorage.getItem(storageKey()) || 'null'); } catch {}
        draft = local?.updatedAt > saved.updatedAt ? local.data : saved.data;
        draft = { post: draft?.post || {}, comments: draft?.comments || {} }; resources = available;
      } catch { if (login !== loginGeneration) return; try { draft = JSON.parse(localStorage.getItem(storageKey()) || '{}').data || draft; } catch {} }
      await pollNotices(); if (login === loginGeneration) notificationTimer = setInterval(() => { void pollNotices(); }, 30000);
      })();
      return initializing.finally(() => { if (login === loginGeneration) initializing = null; });
    };
    let feed = null, detail = null, filters = { category: '', search: '', mine: false, unit: '', bimester: '' }, offset = 0, active = false, generation = 0, busy = false, composeId = id(), commentId = id();
    const urls = new Map(); let imageObserver = null, dialog = null;
    const blockMediaAction = event => { if (event.target.closest?.('.forum-avatar, .forum-attachment')) event.preventDefault(); };
    root.addEventListener('contextmenu', blockMediaAction);
    root.addEventListener('dragstart', blockMediaAction);
    const notify = (message, error = false) => {
      const host = root.querySelector('[data-forum-status]');
      if (host) { host.textContent = message; host.classList.toggle('error', error); }
    };
    const dispose = () => { imageObserver?.disconnect(); imageObserver = null; urls.forEach((url) => URL.revokeObjectURL(url)); urls.clear(); closePreview(); };
    const closePreview = () => { if (dialog) { dialog.close(); dialog.remove(); dialog = null; } };
    const fileBlob = async (file) => {
      const currentToken = token();
      const response = await fetch(file.url, { headers: { Authorization: `Bearer ${currentToken}` } });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.message || 'No se pudo abrir el archivo.'); }
      if (response.status === 204) throw new Error('Sin foto de perfil.');
      const blob = await response.blob();
      if (!active || currentToken !== token()) throw new Error('La vista del foro cambió.');
      return blob;
    };
    const objectUrl = async (file) => {
      if (urls.has(file.id)) return urls.get(file.id);
      const captured = generation, blob = await fileBlob(file);
      if (captured !== generation) throw new Error('La vista cambió.');
      const url = URL.createObjectURL(blob); urls.set(file.id, url); return url;
    };
    const attachmentMarkup = (files) => files.length ? `<div class="forum-attachments">${files.map((file) => `<button type="button" class="forum-attachment" data-forum-file="${escape(file.id)}" title="${escape(file.name)}"><span class="forum-file-thumb" ${(['image', 'svg'].includes(file.kind) && file.size < 8 * 1048576) || file.kind === 'video' ? `data-forum-thumbnail="${escape(file.id)}"` : ''}>${({ image: '▧', svg: '▧', video: '▶', audio: '♫', pdf: 'PDF', html: 'HTML', text: '≡' })[file.kind] || '▤'}</span><span><b>${escape(file.name)}</b><small>${escape(file.kind === 'html' ? 'HTML interactivo' : file.kind === 'video' ? 'Video' : 'Archivo')} · ${size(file.size)}</small></span></button>`).join('')}</div>` : '';
    const authorMarkup = (post) => `<div class="forum-author"><span class="forum-avatar" ${post.profileUrl ? `data-forum-profile="${escape(post.profileUrl)}" data-photo-author="${escape(post.authorId)}" data-photo-name="${escape(post.authorName)}" aria-label="Foto de ${escape(post.authorName)}"` : ''}>${escape(post.authorName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join(''))}</span><span><b>${escape(post.authorName)}</b><small>${post.authorType === 'teacher' ? 'Docente' : `${escape(post.grade || '')} · Sección ${escape(post.section || '')}`}</small><time>${stamp(post.createdAt)}${post.updatedAt && post.updatedAt !== post.createdAt ? ' · Editado' : ''}</time></span></div>`;
    const reviewedMarkup = entry => entry.reviewedAt && !entry.hidden ? '<span class="forum-reviewed">✓ Visto y aprobado por el docente</span>' : '';
    const reactionsMarkup = (entry, kind) => entry.hidden || entry.moderationStatus === 'pending' ? '' : `<div class="forum-reactions" aria-label="Reacciones">${Object.entries({ like: '👍 Me gusta', heart: '❤️ Me encanta', idea: '💡 Buena idea' }).map(([key, label]) => `<button type="button" data-forum-reaction="${key}" data-reaction-kind="${kind}" data-reaction-id="${escape(entry.id)}" aria-pressed="${entry.reactions?.mine === key}">${label} <b>${entry.reactions?.counts?.[key] || 0}</b></button>`).join('')}</div>`;
    const postTone = post => /^[1-8]$/.test(post.unitNumber) ? Number(post.unitNumber) : 0;
    const unitOptions = (value = '') => `<option value="">General / sin unidad</option>${Array.from({ length: 8 }, (_, i) => `<option value="${i + 1}" ${String(value) === String(i + 1) ? 'selected' : ''}>Unidad ${i + 1} · Bimestre ${['I', 'II', 'III', 'IV'][Math.floor(i / 2)]}</option>`).join('')}`;
    const periodLabel = post => post.unitNumber ? `Unidad ${escape(post.unitNumber)} · Bimestre ${escape(post.bimester || '')}` : 'General / sin unidad';
    const selectedScopeClosed = () => (feed?.scopes || []).some(state => state.closed && (state.type === 'all' || state.type === 'bimester' && state.value === filters.bimester || state.type === 'unit' && state.value === filters.unit || state.type === 'bimester' && /^[1-8]$/.test(filters.unit) && state.value === ['I', 'II', 'III', 'IV'][Math.floor((Number(filters.unit) - 1) / 2)]));
    const periodMarkup = () => `<nav class="forum-periods" aria-label="Organizar publicaciones"><div class="forum-period-tabs" aria-label="Bimestres">${['', 'I', 'II', 'III', 'IV'].map(value => `<button type="button" data-forum-bimester="${value}" aria-pressed="${filters.bimester === value}">${value ? `Bimestre ${value}` : 'Todos los bimestres'}</button>`).join('')}</div><div class="forum-period-tabs" aria-label="Unidades"><button type="button" data-forum-unit="" aria-pressed="${!filters.unit}">Todas las unidades</button>${!filters.bimester ? `<button type="button" data-forum-unit="general" aria-pressed="${filters.unit === 'general'}">General / sin unidad</button>` : ''}${Array.from({ length: 8 }, (_, i) => i + 1).filter(unit => !filters.bimester || ['I', 'II', 'III', 'IV'][Math.floor((unit - 1) / 2)] === filters.bimester).map(unit => `<button type="button" class="forum-unit-tone" data-forum-tone="${unit}" data-forum-unit="${unit}" aria-pressed="${filters.unit === String(unit)}">Unidad ${unit}</button>`).join('')}</div>${selectedScopeClosed() ? '<p class="forum-locked">Este foro está cerrado por el docente. Puedes leer las publicaciones; no se admiten nuevas publicaciones ni comentarios.</p>' : '<p class="forum-period-hint">Cada unidad tiene un color propio. Selecciona una pestaña para consultar su foro.</p>'}</nav>`;
    const removalMarkup = post => post.own && post.moderationStatus !== 'pending' && post.attachments.length ? `<form class="forum-file-removal" data-forum-remove-files><h3>Eliminar archivos de esta publicación</h3><p>Te quedan ${post.attachmentRemovalRemaining ?? 3} de 3 operaciones por publicación. Puedes seleccionar varios archivos en una sola operación.</p>${post.attachments.map(file => `<label><input type="checkbox" name="attachmentId" value="${escape(file.id)}" ${post.attachmentRemovalRemaining === 0 ? 'disabled' : ''}><span>${escape(file.name)}</span></label>`).join('')}<button type="submit" class="ghost" ${post.attachmentRemovalRemaining === 0 ? 'disabled' : ''}>Eliminar archivos seleccionados</button>${post.attachmentRemovalRemaining === 0 ? '<small>Alcanzaste el límite. El docente puede ayudarte a retirar más archivos.</small>' : ''}</form>` : '';
    const postMarkup = (post, full = false) => `<article class="forum-post" data-forum-tone="${postTone(post)}"><div class="forum-post-top">${authorMarkup(post)}<span class="forum-category ${escape(post.category)}">${labels[post.category] || 'Aporte'}</span></div>${post.pinned || !post.canComment || post.moderationStatus === 'pending' ? `<div class="forum-flags">${post.pinned ? '<span>📌 Destacada</span>' : ''}${!post.canComment ? '<span>Comentarios cerrados</span>' : ''}${post.moderationStatus === 'pending' ? '<span>Pendiente de revisión docente</span>' : ''}</div>` : ''}<h3>${full ? escape(post.title) : `<button data-forum-post="${escape(post.id)}">${escape(post.title)}</button>`}</h3><p class="forum-body${full ? '' : ' preview'}">${escape(full ? post.body : post.body.slice(0, 350))}${!full && post.body.length > 350 ? '…' : ''}</p><p class="forum-period-label">${periodLabel(post)}</p>${attachmentMarkup(post.attachments)}${reviewedMarkup(post)}${reactionsMarkup(post, 'posts')}<div class="forum-post-footer">${!full ? `<button data-forum-post="${escape(post.id)}">${post.commentCount} comentario${post.commentCount === 1 ? '' : 's'} · Abrir conversación →</button>` : `<span>${post.commentCount} comentario${post.commentCount === 1 ? '' : 's'}</span>`}<div>${post.own && post.moderationStatus !== 'pending' ? `${full && !post.locked ? '<button data-forum-edit>Editar</button>' : ''}<button data-forum-delete-post="${escape(post.id)}">Eliminar</button>` : `<button data-forum-report="${escape(post.id)}">Reportar</button>`}</div></div></article>`;
    const shell = (content) => `<div class="forum-status" data-forum-status role="status" aria-live="polite"></div><div data-forum-notices>${noticeMarkup()}</div>${content}`;
    const hydrateThumbnails = () => {
      root.querySelectorAll('[data-forum-profile]').forEach((node) => { const captured = generation; void objectUrl({ id: node.dataset.forumProfile, url: node.dataset.forumProfile }).then((url) => { if (captured === generation && node.isConnected) node.innerHTML = `<img src="${escape(url)}" alt="Foto de perfil" draggable="false">`; }).catch(() => {}); });
      const files = detail ? detail.post.attachments : (feed?.posts || []).flatMap((post) => post.attachments);
      const load = async (node) => {
        imageObserver?.unobserve(node);
        const file = files.find((entry) => entry.id === node.dataset.forumThumbnail), captured = generation;
        if (!file) return;
        try { const url = await objectUrl(file); if (captured === generation && node.isConnected) node.innerHTML = file.kind === 'video' ? `<video src="${escape(url)}" muted playsinline preload="metadata" disablepictureinpicture draggable="false"></video><span class="forum-video-badge" aria-hidden="true">&#9654;</span>` : `<img src="${escape(url)}" alt="" loading="lazy" draggable="false">`; } catch { /* The attachment button still allows retrying the preview. */ }
      };
      const nodes = root.querySelectorAll('[data-forum-thumbnail]');
      if ('IntersectionObserver' in window) { imageObserver = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) void load(entry.target); }), { rootMargin: '100px' }); nodes.forEach((node) => imageObserver.observe(node)); }
      else nodes.forEach((node) => { void load(node); });
    };
    const resourceMarkup = () => `<label>Unidad<select name="unitNumber">${unitOptions(filters.unit === 'general' ? '' : filters.unit || (filters.bimester ? String(['I', 'II', 'III', 'IV'].indexOf(filters.bimester) * 2 + 1) : ''))}</select></label><label>Sesión vinculada<select name="sessionId"><option value="">Publicación general (cierre manual del docente)</option>${resources.sessions.map((session) => `<option value="${escape(session.id)}">Unidad ${escape(session.unit || '')} · ${escape(session.title)}</option>`).join('')}</select><small>Si vinculas una sesión, su plazo también cerrará los comentarios.</small></label><details class="forum-evidence-picker"><summary>Seleccionar evidencias ya entregadas</summary><p>Tus entregas del año activo, de una misma sesión. Se conserva su plazo de comentarios. Hasta tres adjuntos en total.</p>${resources.evidences.map((file) => `<label data-evidence-session="${escape(file.session_id)}"><input type="checkbox" name="evidenceId" value="${escape(file.id)}"><span><b>${escape(file.file_name)}</b><small>${escape(file.area_id || '')} · Unidad ${escape(file.unit_number || '')} · Sesión ${escape(file.session_number || '')} · ${size(file.file_size || 0)}</small></span></label>`).join('') || '<p>No tienes evidencias entregadas todavía.</p>'}</details>`;
    const formMarkup = (post = null) => `<form class="forum-compose" data-forum-compose ${post ? '' : 'hidden'}><h3>${post ? 'Editar publicación' : 'Nueva publicación'}</h3><label>Título<input name="title" required minlength="3" maxlength="140" placeholder="¿Qué quieres compartir con tu aula?" value="${escape(post?.title || '')}"></label><label>Categoría<select name="category">${categoryOptions(post?.category || 'aporte')}</select></label><label>Mensaje<textarea name="body" maxlength="6000" rows="4" placeholder="Explica tu idea o pregunta. Puedes acompañarla con archivos.">${escape(post?.body || '')}</textarea></label>${post ? `<label>Unidad<select name="unitNumber" ${post.sessionId ? 'disabled' : ''}>${unitOptions(post.unitNumber)}</select></label><p>Los archivos adjuntos se conservan.</p>` : resourceMarkup() + '<label class="forum-file-picker">Adjuntos (opcional)<input name="files" type="file" multiple><small>Hasta 3 archivos · 25 MB por archivo. Imágenes, video, audio, HTML, PDF y documentos.</small></label><div data-forum-selected-files class="forum-selected-files"></div>'}<div class="forum-compose-actions"><button type="button" class="ghost" data-forum-cancel>Cancelar</button><button type="submit" class="primary">${post ? 'Guardar cambios' : 'Publicar'}</button></div></form>`;
    const renderFeed = () => {
      dispose(); generation += 1; detail = null;
      root.innerHTML = shell(`<div class="forum-layout"><section class="forum-main"><div class="forum-toolbar"><div><b>Foro estudiantil</b><span>Todos los grados y secciones · ${escape(feed.classroom.year)}</span><button type="button" class="ghost" data-forum-profile-edit>Cambiar mi foto</button></div><button class="primary" data-forum-new ${selectedScopeClosed() ? 'disabled' : ''}>+ Nueva publicación</button></div>${periodMarkup()}<form class="forum-filters" data-forum-filters><label>Buscar<input name="search" maxlength="120" value="${escape(filters.search)}" placeholder="Título, contenido o compañero"></label><label>Categoría<select name="category"><option value="">Todas</option>${categoryOptions(filters.category)}</select></label><label class="forum-mine"><input name="mine" type="checkbox" ${filters.mine ? 'checked' : ''}> Mis publicaciones</label><button class="ghost" type="submit">Buscar</button></form>${formMarkup()}<div class="forum-result-count">${feed.total} publicación${feed.total === 1 ? '' : 'es'}</div><div class="forum-feed">${feed.posts.map((post) => postMarkup(post)).join('') || '<div class="forum-empty"><span>☷</span><h3>Aquí empiezan las conversaciones</h3><p>No hay publicaciones con estos filtros. Comparte una pregunta, una idea o tu proyecto.</p></div>'}</div><div class="forum-pagination"><button class="ghost" data-forum-prev ${offset === 0 ? 'disabled' : ''}>← Anterior</button><span>Página ${Math.floor(offset / 20) + 1}</span><button class="ghost" data-forum-next ${!feed.hasMore ? 'disabled' : ''}>Siguiente →</button></div></section><aside class="forum-guide"><span class="forum-guide-icon">☷</span><h3>Aprendemos conversando</h3><p>Comparte tus ideas con estudiantes de todos los grados y secciones. Cada publicación tiene su propia conversación.</p><ul><li>Elige un título claro y la categoría adecuada.</li><li>Comenta con respeto y explica tus ideas.</li><li>No publiques contraseñas ni datos personales.</li><li>Reporta el contenido que necesite revisión.</li></ul><p class="forum-guide-note">Las publicaciones y comentarios quedan registrados en ARMI Docente.</p></aside></div>`);
      bind(); hydrateThumbnails();
    };
    const commentMarkup = (comment) => `<article class="forum-comment">${authorMarkup(comment)}${comment.moderationStatus === 'pending' ? '<p class="forum-locked">Oculto para los demás. Pendiente de revisión docente.</p>' : ''}<p>${escape(comment.body)}</p>${reviewedMarkup(comment)}${reactionsMarkup(comment, 'comments')}${comment.moderationStatus === 'pending' ? '' : `<button ${comment.own ? `data-forum-delete-comment="${escape(comment.id)}"` : `data-forum-report-comment="${escape(comment.id)}"`}>${comment.own ? 'Eliminar' : 'Reportar'}</button>`}</article>`;
    const renderDetail = () => {
      dispose(); generation += 1;
      root.innerHTML = shell(`<div class="forum-detail"><button class="ghost forum-back" data-forum-back>← Volver a publicaciones</button>${postMarkup(detail.post, true)}${removalMarkup(detail.post)}<div data-forum-edit-host></div>${detail.post.closeAt ? `<p class="forum-deadline">Comentarios hasta ${stamp(detail.post.closeAt)} (plazo de la sesión).</p>` : ''}<section class="forum-comments"><h3>Conversación <span>${detail.total}</span></h3><div data-forum-comments>${detail.comments.map(commentMarkup).join('') || '<p class="forum-no-comments">Todavía no hay comentarios. Inicia la conversación.</p>'}</div>${detail.hasMore ? '<button class="ghost" data-forum-more-comments>Cargar más comentarios</button>' : ''}${!detail.post.canComment ? `<p class="forum-locked">${escape(detail.post.closeReason)}</p>` : '<form data-forum-comment class="forum-comment-form"><label for="forumCommentText">Tu comentario</label><textarea id="forumCommentText" name="body" required maxlength="2000" rows="3" placeholder="Escribe una respuesta respetuosa y relacionada con el tema."></textarea><button type="submit" class="primary">Comentar</button></form>'}</section></div>`);
      bind(); hydrateThumbnails();
    };
    const loadFeed = async () => {
      const captured = ++generation;
      notify('Cargando publicaciones…');
      try { const query = new URLSearchParams({ category: filters.category, search: filters.search, unit: filters.unit, bimester: filters.bimester, mine: filters.mine ? '1' : '0', offset }); const data = await api(`/api/student-portal/forum/posts?${query}`); if (active && captured === generation) { feed = data; renderFeed(); } }
      catch (error) { if (active && captured === generation) notify(error.message, true); }
    };
    const openPost = async (postId) => {
      const captured = ++generation;
      notify('Abriendo conversación…');
      try { const data = await api(`/api/student-portal/forum/posts/${encodeURIComponent(postId)}`); if (active && captured === generation) { detail = data; commentId = id(); renderDetail(); void api('/api/student-portal/forum/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId }) }).then(pollNotices).catch(() => {}); root.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }
      catch (error) { if (active && captured === generation) notify(error.message, true); }
    };
    const allFiles = () => detail ? detail.post.attachments : (feed?.posts || []).flatMap((post) => post.attachments);
    const preview = async (file) => {
      closePreview();
      dialog = document.createElement('dialog'); dialog.className = 'forum-preview';
      dialog.innerHTML = `<header><div><b>${escape(file.name)}</b><small>${size(file.size)}</small></div><button aria-label="Cerrar vista previa">×</button></header><div class="forum-preview-content"><p>Cargando archivo…</p></div><footer><span>Vista previa del foro · Descargas deshabilitadas</span></footer>`;
      document.body.appendChild(dialog); dialog.showModal();
      const current = dialog;
      current.querySelector('header button').onclick = closePreview;
      current.addEventListener('cancel', (event) => { event.preventDefault(); closePreview(); });
      current.addEventListener('contextmenu', event => event.preventDefault());
      current.addEventListener('dragstart', event => event.preventDefault());
      try {
        const blob = await fileBlob(file);
        if (dialog !== current) return;
        const host = current.querySelector('.forum-preview-content');
        let url = URL.createObjectURL(blob); const transient = [url];
        current.addEventListener('close', () => transient.forEach((value) => URL.revokeObjectURL(value)), { once: true });
        if (['image', 'svg'].includes(file.kind)) host.innerHTML = `<img src="${escape(url)}" alt="${escape(file.name)}" draggable="false">`;
        else if (file.kind === 'video') host.innerHTML = `<video controls controlslist="nodownload noremoteplayback" disablepictureinpicture playsinline preload="metadata" src="${escape(url)}"></video>`;
        else if (file.kind === 'audio') host.innerHTML = `<audio controls controlslist="nodownload noremoteplayback" preload="metadata" src="${escape(url)}"></audio>`;
        else if (file.kind === 'pdf') host.innerHTML = `<iframe title="${escape(file.name)}" src="${escape(url)}#toolbar=0&navpanes=0"></iframe>`;
        else if (file.kind === 'html') {
          const source = await blob.text();
          if (dialog !== current) return;
          const frame = document.createElement('iframe'); frame.title = file.name; frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('referrerpolicy', 'no-referrer');
          const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";
          const viewingGuard = '<script>document.addEventListener("contextmenu",e=>e.preventDefault(),true);document.addEventListener("dragstart",e=>e.preventDefault(),true);document.addEventListener("click",e=>{if(e.target.closest("a[download]"))e.preventDefault();},true);</script>';
          frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}">${viewingGuard}${source}`; host.replaceChildren(frame);
        } else if (file.kind === 'text') { const pre = document.createElement('pre'); pre.textContent = (await blob.text()).slice(0, 200000); host.replaceChildren(pre); }
        else host.innerHTML = '<div class="forum-empty"><h3>Sin vista previa disponible</h3><p>Este formato no puede visualizarse en el foro. Solicita al autor una imagen o un PDF.</p></div>';
      } catch (error) { if (dialog === current) current.querySelector('.forum-preview-content').textContent = error.message; }
    };
    const mutation = async (button, work) => {
      if (busy) return;
      busy = true; button.disabled = true; notify('Guardando…');
      try { await work(); } catch (error) { notify(error.message, true); } finally { busy = false; if (button.isConnected) button.disabled = false; }
    };
    const report = async (postId, comment = '') => {
      const reason = window.prompt('Explica brevemente por qué este contenido necesita revisión del docente (mínimo 5 caracteres):');
      if (reason === null) return;
      try { await api(`/api/student-portal/forum/posts/${postId}/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, commentId: comment }) }); notify('Reporte registrado para revisión docente.'); }
      catch (error) { notify(error.message, true); }
    };
    const bindReactions = () => {
      root.querySelectorAll('[data-forum-reaction]').forEach(button => { button.onclick = () => {
        const kind = button.dataset.reactionKind, targetId = button.dataset.reactionId;
        const entry = kind === 'posts' ? (detail?.post || feed.posts.find(post => post.id === targetId)) : detail?.comments.find(comment => comment.id === targetId);
        if (!entry) return;
        const captured = generation;
        void mutation(button, async () => {
          entry.reactions = await api(`/api/student-portal/forum/${kind}/${encodeURIComponent(targetId)}/reaction`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reaction: entry.reactions?.mine === button.dataset.forumReaction ? '' : button.dataset.forumReaction }) });
          if (!active || captured !== generation || !button.isConnected) return;
          const holder = button.closest('.forum-reactions');
          holder.outerHTML = reactionsMarkup(entry, kind);
          bindReactions(); notify('Reacción guardada.');
        });
      }; });
    };
    const bind = () => {
      bindNotices();
      bindReactions();
      root.querySelectorAll('[data-forum-bimester]').forEach(button => { button.onclick = () => { if (busy) return; filters.bimester = button.dataset.forumBimester; filters.unit = ''; offset = 0; void loadFeed(); }; });
      root.querySelectorAll('[data-forum-unit]').forEach(button => { button.onclick = () => { if (busy) return; filters.unit = button.dataset.forumUnit; offset = 0; void loadFeed(); }; });
      const removalForm = root.querySelector('[data-forum-remove-files]'), removalId = id();
      removalForm?.addEventListener('submit', event => {
        event.preventDefault();
        const attachmentIds = [...removalForm.querySelectorAll('input:checked')].map(input => input.value);
        if (!attachmentIds.length) { notify('Selecciona uno o más archivos.', true); return; }
        if (!window.confirm(`¿Eliminar ${attachmentIds.length} archivo(s)? Contará como una de tus tres operaciones de esta publicación.`)) return;
        const postId = detail.post.id;
        void mutation(removalForm.querySelector('[type=submit]'), async () => {
          await api(`/api/student-portal/forum/posts/${postId}/attachments/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attachmentIds, requestId: removalId }) });
          await openPost(postId); notify('Archivos eliminados.');
        });
      });
      root.querySelector('[data-forum-profile-edit]')?.addEventListener('click', onProfile);
      root.querySelector('[data-forum-filters]')?.addEventListener('submit', (event) => { event.preventDefault(); const data = new FormData(event.target); filters = { ...filters, category: String(data.get('category')), search: String(data.get('search')), mine: data.has('mine') }; offset = 0; void loadFeed(); });
      root.querySelector('[data-forum-new]')?.addEventListener('click', () => { const form = root.querySelector('[data-forum-compose]'); form.hidden = false; form.querySelector('input').focus(); });
      const form = root.querySelector('[data-forum-compose]');
      form?.querySelector('[data-forum-cancel]')?.addEventListener('click', () => { form.hidden = true; notify('Borrador conservado. Puedes continuar después.'); });
      if (form) {
        for (const field of ['title', 'body', 'category', 'sessionId', 'unitNumber']) if (form.elements[field] && typeof draft.post[field] === 'string') form.elements[field].value = draft.post[field];
        form.querySelectorAll('[name=evidenceId]').forEach((input) => { input.checked = (draft.post.evidenceIds || []).includes(input.value); });
        if (draft.post.uploadNames?.length) form.querySelector('[data-forum-selected-files]').textContent = `Vuelve a seleccionar estos archivos locales: ${draft.post.uploadNames.join(', ')}`;
        const capture = () => { const data = new FormData(form); draft.post = { title: data.get('title'), body: data.get('body'), category: data.get('category'), sessionId: data.get('sessionId'), unitNumber: data.get('unitNumber'), evidenceIds: data.getAll('evidenceId'), uploadNames: [...(form.elements.files?.files || [])].map((file) => file.name) }; changedDraft(); };
        form.addEventListener('input', capture); form.addEventListener('change', capture);
        const sessionSelect = form.querySelector('[name=sessionId]');
        const syncUnit = () => { const session = resources.sessions.find(item => String(item.id) === sessionSelect?.value); if (form.elements.unitNumber) { if (session) form.elements.unitNumber.value = String(session.unit || ''); form.elements.unitNumber.disabled = !!session; } };
        const filterEvidence = () => form.querySelectorAll('[data-evidence-session]').forEach((label) => { label.hidden = !!sessionSelect?.value && label.dataset.evidenceSession !== sessionSelect.value; if (label.hidden) label.querySelector('input').checked = false; });
        sessionSelect?.addEventListener('change', () => { syncUnit(); filterEvidence(); capture(); }); syncUnit(); filterEvidence();
        form.querySelectorAll('[name=evidenceId]').forEach((input) => input.addEventListener('change', () => { if (input.checked && sessionSelect && !sessionSelect.value) { sessionSelect.value = input.closest('[data-evidence-session]').dataset.evidenceSession; syncUnit(); filterEvidence(); } capture(); }));
      }
      form?.querySelector('input[type=file]')?.addEventListener('change', (event) => { form.querySelector('[data-forum-selected-files]').textContent = [...event.target.files].map((file) => `${file.name} (${size(file.size)})`).join(' · '); });
      form?.addEventListener('submit', (event) => {
        event.preventDefault(); const files = [...(form.querySelector('input[type=file]')?.files || [])];
        if (files.length + form.querySelectorAll('[name=evidenceId]:checked').length > 3 || files.some((file) => file.size > 25 * 1048576)) { notify('Selecciona hasta 3 archivos, de máximo 25 MB cada uno.', true); return; }
        void mutation(form.querySelector('[type=submit]'), async () => {
          const data = new FormData(form); data.append('requestId', composeId);
          data.delete('files'); files.forEach((file) => data.append('files', file, file.name));
          const evidenceIds = data.getAll('evidenceId'); data.delete('evidenceId'); data.append('evidenceIds', JSON.stringify(evidenceIds));
          const created = await api('/api/student-portal/forum/posts', { method: 'POST', body: data }); composeId = id(); draft.post = {}; changedDraft(); await saveDraft(); await openPost(created.id); if (created.moderationStatus === 'pending') notify('Publicación oculta y enviada a revisión docente.');
        });
      });
      root.querySelectorAll('[data-forum-post]').forEach((button) => { button.onclick = () => { void openPost(button.dataset.forumPost); }; });
      root.querySelectorAll('[data-forum-file]').forEach((button) => { button.onclick = () => { const file = allFiles().find((entry) => entry.id === button.dataset.forumFile); if (file) void preview(file); }; });
      root.querySelectorAll('[data-forum-report]').forEach((button) => { button.onclick = () => { void report(button.dataset.forumReport); }; });
      root.querySelectorAll('[data-forum-report-comment]').forEach((button) => { button.onclick = () => { void report(detail.post.id, button.dataset.forumReportComment); }; });
      root.querySelectorAll('[data-forum-delete-post]').forEach((button) => { button.onclick = () => { if (!confirm('¿Eliminar tu publicación? Dejará de aparecer en el foro junto con su conversación.')) return; void mutation(button, async () => { await api(`/api/student-portal/forum/posts/${button.dataset.forumDeletePost}`, { method: 'DELETE' }); await loadFeed(); }); }; });
      root.querySelectorAll('[data-forum-delete-comment]').forEach((button) => { button.onclick = () => { if (!confirm('¿Eliminar tu comentario?')) return; void mutation(button, async () => { await api(`/api/student-portal/forum/comments/${button.dataset.forumDeleteComment}`, { method: 'DELETE' }); await openPost(detail.post.id); }); }; });
      root.querySelector('[data-forum-back]')?.addEventListener('click', () => { void loadFeed(); });
      root.querySelector('[data-forum-prev]')?.addEventListener('click', () => { offset = Math.max(0, offset - 20); void loadFeed(); });
      root.querySelector('[data-forum-next]')?.addEventListener('click', () => { offset += 20; void loadFeed(); });
      const commentForm = root.querySelector('[data-forum-comment]');
      if (commentForm) { commentForm.elements.body.value = draft.comments[detail.post.id] || ''; commentForm.addEventListener('input', () => { draft.comments[detail.post.id] = commentForm.elements.body.value; changedDraft(); }); }
      commentForm?.addEventListener('submit', (event) => { event.preventDefault(); void mutation(commentForm.querySelector('[type=submit]'), async () => { const postId = detail.post.id; const result = await api(`/api/student-portal/forum/posts/${postId}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: new FormData(commentForm).get('body'), requestId: commentId }) }); delete draft.comments[postId]; changedDraft(); await saveDraft(); await openPost(postId); if (result.moderationStatus === 'pending') notify('Comentario oculto y enviado a revisión docente. Solo el docente puede aprobarlo o eliminarlo.'); }); });
      root.querySelector('[data-forum-more-comments]')?.addEventListener('click', (event) => { void mutation(event.target, async () => { const extra = await api(`/api/student-portal/forum/posts/${detail.post.id}?offset=${detail.comments.length}`); detail.comments.push(...extra.comments); detail.hasMore = extra.hasMore; detail.total = extra.total; renderDetail(); }); });
      root.querySelector('[data-forum-edit]')?.addEventListener('click', () => {
        if (!detail) { notify('Abre la conversación para editar tu publicación.'); return; }
        const host = root.querySelector('[data-forum-edit-host]'); host.innerHTML = formMarkup(detail.post);
        const editForm = host.querySelector('form'); editForm.querySelector('[data-forum-cancel]').onclick = () => host.replaceChildren();
        editForm.onsubmit = (event) => { event.preventDefault(); void mutation(editForm.querySelector('[type=submit]'), async () => { const data = new FormData(editForm); await api(`/api/student-portal/forum/posts/${detail.post.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(data)) }); await openPost(detail.post.id); }); };
        editForm.querySelector('input').focus();
      });
    };
    return {
      start,
      open: () => { active = true; root.innerHTML = shell('<div class="forum-empty">Cargando el foro estudiantil…</div>'); void start().then(() => { if (active) void loadFeed(); }); },
      leave: () => { void saveDraft(); active = false; generation += 1; dispose(); },
      reset: () => { loginGeneration += 1; initializing = null; clearTimeout(draftTimer); clearInterval(notificationTimer); initialized = false; busy = false; notices = {items:[],unread:0}; resources = {sessions:[],evidences:[]}; draft = { post: {}, comments: {} }; userKey = ''; onUnread(0); active = false; generation += 1; dispose(); feed = null; detail = null; filters = { category: '', search: '', mine: false, unit: '', bimester: '' }; offset = 0; composeId = id(); commentId = id(); root.replaceChildren(); }
    };
  };
  window.armiForumPortal = Object.freeze({ create });
})();
