import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { uploadsRoot, tempRoot, ensureDir } from '../paths.js';
import { EVIDENCE_EXTENSION_SET, evidenceExtension, evidencePreviewKind } from '../evidenceFormats.js';
import { detectForumLanguage, migrateForumSchema } from '../forumModeration.js';

export const FORUM_CATEGORIES = ['pregunta', 'aporte', 'proyecto', 'debate'];
export const FORUM_MAX_FILE_BYTES = 25 * 1024 * 1024;
const mimeByExtension = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', pdf: 'application/pdf', html: 'text/html', htm: 'text/html', txt: 'text/plain', md: 'text/plain', csv: 'text/plain', json: 'text/plain', xml: 'text/plain' };
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (value, maximum, minimum = 0) => {
  const result = String(value || '').trim();
  if (result.length < minimum || result.length > maximum) fail(400, `El texto debe tener entre ${minimum} y ${maximum} caracteres.`);
  return result;
};
const offsetFor = (value) => Math.min(100000, Math.max(0, Number.parseInt(value, 10) || 0));

export function createStudentForumRoutes({ db, requireStudentAuth, requireTeacher, recoverFile = async () => {}, deliveryWindow, resolveEvidence, sessionsForStudent, uploads = uploadsRoot, temporary = tempRoot }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_forum_posts (
      id TEXT PRIMARY KEY, year TEXT NOT NULL, grade TEXT NOT NULL, section TEXT NOT NULL,
      author_id TEXT NOT NULL, author_name TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      category TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS forum_posts_class ON student_forum_posts(year,grade,section,deleted,hidden,created_at);
    CREATE TABLE IF NOT EXISTS student_forum_attachments (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, stored_name TEXT NOT NULL, file_name TEXT NOT NULL,
      file_type TEXT NOT NULL, file_size INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS forum_attachments_post ON student_forum_attachments(post_id);
    CREATE TABLE IF NOT EXISTS student_forum_comments (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL,
      body TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS forum_comments_post ON student_forum_comments(post_id,created_at);
    CREATE TABLE IF NOT EXISTS student_forum_reports (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, comment_id TEXT NOT NULL DEFAULT '',
      reporter_id TEXT NOT NULL, reason TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  migrateForumSchema(db);
  // Preserve the unit of existing session-linked publications. General posts stay general.
  db.exec("UPDATE student_forum_posts SET unit_number=COALESCE((SELECT unit_number FROM sesiones WHERE id_sesion=session_id),'') WHERE unit_number='' AND session_id<>''");
  const unitFor = value => {
    const unit = String(value ?? '').trim();
    if (unit && !/^[1-8]$/.test(unit)) fail(400, 'Selecciona una unidad del 1 al 8.');
    return unit;
  };
  const bimesterFor = unit => unit ? ['I', 'II', 'III', 'IV'][Math.ceil(Number(unit) / 2) - 1] || '' : '';
  const scopeStates = year => db.prepare('SELECT scope_type AS type,scope_value AS value,closed FROM student_forum_scopes WHERE year=?').all(String(year));
  const closedScope = (year, unit) => scopeStates(year).find(state => state.closed && (state.type === 'all' || state.type === 'unit' && state.value === (unit || 'general') || state.type === 'bimester' && state.value === bimesterFor(unit)));
  const ensureScopeOpen = (year, unit) => { if (closedScope(year, unit)) fail(403, 'El docente cerró el foro de este período. Puedes consultar las publicaciones existentes.'); };
  const postUnit = (sessionId, supplied, fallback = '') => {
    const linked = sessionId ? db.prepare('SELECT unit_number FROM sesiones WHERE id_sesion=?').get(sessionId)?.unit_number : '';
    const unit = unitFor(supplied ?? linked ?? fallback);
    if (linked && supplied !== undefined && unit !== String(linked)) fail(400, 'La unidad debe coincidir con la sesión vinculada.');
    return linked ? unitFor(linked) : supplied === undefined ? unitFor(fallback) : unit;
  };
  const router = express.Router();
  const folder = path.join(uploads, 'user-assets', 'forum');
  const tempFolder = path.join(temporary, 'forum-uploads');
  ensureDir(folder); ensureDir(tempFolder);
  const uploader = multer({ storage: multer.diskStorage({ destination: tempFolder, filename: (_req, _file, done) => done(null, `${crypto.randomUUID()}.upload`) }), limits: { files: 3, fileSize: FORUM_MAX_FILE_BYTES, fields: 8, fieldSize: 32000 }, fileFilter: (_req, file, done) => {
    if (!EVIDENCE_EXTENSION_SET.has(evidenceExtension(file.originalname))) return done(Object.assign(new Error('Formato no admitido en el foro.'), { status: 400 }));
    done(null, true);
  } });
  const upload = (req, res, next) => uploader.array('files', 3)(req, res, (error) => {
    const cleanup = () => (req.files || []).forEach((file) => { try { fs.rmSync(file.path, { force: true }); } catch {} });
    res.once('finish', cleanup); res.once('close', cleanup);
    if (error) { cleanup(); return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message: error.code === 'LIMIT_FILE_SIZE' ? 'Máximo 25 MB por archivo.' : error.message }); }
    next();
  });
  const route = (fn) => async (req, res) => {
    try { const data = await fn(req, res); if (!res.headersSent) res.json({ success: true, data }); }
    catch (error) { if (!res.headersSent) res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'No se pudo completar la operación del foro.' }); }
  };
  const context = (req) => {
    const student = db.prepare("SELECT * FROM db_estudiantes WHERE id=? AND estado='A'").get(req.studentPortal.studentId);
    if (!student) fail(403, 'Tu matrícula no está activa.');
    const year = String(db.prepare('SELECT year FROM datos_generales ORDER BY id DESC LIMIT 1').get()?.year || new Date().getFullYear());
    return { student, year, grade: String(student.grado), section: String(student.secc) };
  };
  const postFor = (req, id, teacher = false) => {
    const post = db.prepare(`SELECT * FROM student_forum_posts WHERE id=?${teacher ? '' : ' AND deleted=0'}`).get(String(id));
    if (!post) fail(404, 'Publicación no disponible.');
    if (!teacher) {
      const ctx = context(req);
      if (post.deleted || post.year !== ctx.year || (post.hidden && !(post.moderation_status === 'pending' && post.author_id === String(ctx.student.id)))) fail(404, 'Publicación no disponible.');
    }
    return post;
  };
  const own = (row, req) => { if (row.author_id !== String(req.studentPortal.studentId)) fail(403, 'Solo puedes modificar tu propio contenido.'); };
  const rate = (table, authorId, maximum) => {
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    if (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE author_id=? AND created_at>?`).get(authorId, since).count >= maximum) fail(429, 'Has publicado muchas veces. Espera unos minutos.');
  };
  const requestId = (req) => {
    const id = String(req.body?.requestId || crypto.randomUUID());
    if (!/^[a-z0-9-]{16,80}$/i.test(id)) fail(400, 'Identificador de publicación inválido.');
    return id;
  };
  const commenting = (post) => {
    if (post.deleted || post.hidden || post.moderation_status !== 'approved') return { canComment: false, closeAt: null, closeReason: 'La publicación no está disponible para comentarios.' };
    if (post.locked) return { canComment: false, closeAt: null, closeReason: 'El docente cerró los comentarios.' };
    if (closedScope(post.year, post.unit_number)) return { canComment: false, closeAt: null, closeReason: 'El docente cerró el foro de este período.' };
    if (post.comments_reopened) return { canComment: true, closeAt: null, closeReason: '' };
    if (!post.session_id) return { canComment: true, closeAt: null, closeReason: '' };
    const row = db.prepare('SELECT * FROM sesiones WHERE id_sesion=?').get(post.session_id);
    if (!row || !deliveryWindow) return { canComment: false, closeAt: null, closeReason: 'La sesión vinculada ya no está disponible.' };
    let data = {}; try { data = JSON.parse(row.session_data || '{}'); } catch {}
    const window = deliveryWindow(row, data, new Date(), post.section);
    return { canComment: !!window.available, closeAt: window.closeAt, closeReason: window.available ? '' : window.isClosed ? 'Finalizó el plazo de la sesión vinculada.' : 'La sesión vinculada todavía no permite comentarios.' };
  };
  const validateSession = (ctx, sessionId) => {
    if (!sessionId) return '';
    const allowed = sessionsForStudent ? sessionsForStudent(ctx.student, ctx.year) : [];
    if (!allowed.some((row) => String(row.id_sesion) === sessionId)) fail(403, 'Selecciona una sesión de tu grado y sección.');
    return sessionId;
  };
  const notifyStudent = (recipient, postId, commentId, kind, message) => {
    if (!recipient || recipient === 'teacher') return;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO student_forum_notifications(id,recipient_id,post_id,comment_id,kind,message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), String(recipient), postId, commentId || '', kind, message, now, now);
  };
  const notifyReply = (post, comment) => {
    const recipients = new Set([post.author_id, ...db.prepare("SELECT DISTINCT author_id FROM student_forum_comments WHERE post_id=? AND author_type='student' AND deleted=0").all(post.id).map((row) => row.author_id)]);
    recipients.delete(comment.author_id);
    recipients.forEach((recipient) => notifyStudent(recipient, post.id, comment.id, 'reply', `${comment.author_name} respondió en «${post.title}».`));
  };
  const autoReport = (postId, commentId, matches) => {
    if (!matches.length) return;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO student_forum_reports(id,post_id,comment_id,reporter_id,reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(), postId, commentId || '', 'system', `Filtro de lenguaje: ${matches.join(', ')}`, now, now);
  };
  const reactionsFor = (kind, targetId, req, teacher) => {
    const rows = db.prepare("SELECT actor_type,actor_id,reaction FROM student_forum_reactions WHERE target_type=? AND target_id=? AND reaction<>''").all(kind, targetId);
    const actorId = teacher ? 'teacher' : String(req.studentPortal.studentId);
    const actorType = teacher ? 'teacher' : 'student';
    return { counts: Object.fromEntries(['like', 'heart', 'idea'].map(key => [key, rows.filter(row => row.reaction === key).length])), mine: rows.find(row => row.actor_id === actorId && row.actor_type === actorType)?.reaction || '' };
  };
  const react = (req, teacher) => {
    const kind = req.params.kind;
    if (!['posts', 'comments'].includes(kind)) fail(404, 'Contenido no disponible.');
    const row = kind === 'posts' ? postFor(req, req.params.id, teacher) : db.prepare('SELECT * FROM student_forum_comments WHERE id=? AND deleted=0 AND hidden=0').get(req.params.id);
    if (!row) fail(404, 'Contenido no disponible.');
    const post = kind === 'posts' ? row : postFor(req, row.post_id, teacher);
    if (row.deleted || row.hidden || post.deleted || post.hidden) fail(403, 'Este contenido no admite reacciones.');
    const reaction = String(req.body.reaction ?? '');
    if (!['', 'like', 'heart', 'idea'].includes(reaction)) fail(400, 'Reacción inválida.');
    const actorType = teacher ? 'teacher' : 'student', actorId = teacher ? 'teacher' : String(context(req).student.id);
    const now = new Date().toISOString(), key = JSON.stringify([kind, row.id, actorType, actorId]);
    db.prepare('INSERT INTO student_forum_reactions(id,target_type,target_id,actor_type,actor_id,reaction,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET reaction=excluded.reaction,updated_at=excluded.updated_at').run(key, kind, row.id, actorType, actorId, reaction, now, now);
    return reactionsFor(kind, row.id, req, teacher);
  };
  const mapComment = (comment, req, teacher) => ({
    reviewedAt: comment.reviewed_at, reactions: reactionsFor('comments', comment.id, req, teacher),
    id: comment.id, body: comment.body, authorId: comment.author_id, authorName: comment.author_name, authorType: comment.author_type,
    grade: comment.author_grade, section: comment.author_section, profileUrl: comment.author_type === 'student' ? `/api/${teacher ? 'student-forum/teacher' : 'student-portal/forum'}/profiles/${encodeURIComponent(comment.author_id)}` : '',
    createdAt: comment.created_at, hidden: !!comment.hidden, moderationStatus: comment.moderation_status,
    ...(teacher ? { deleted: !!comment.deleted, moderationMatches: JSON.parse(comment.moderation_matches || '[]') } : {}),
    own: !teacher && comment.author_type === 'student' && comment.author_id === String(req.studentPortal.studentId)
  });
  const attachments = (postId, teacher = false) => db.prepare('SELECT * FROM student_forum_attachments WHERE post_id=? AND deleted=0 ORDER BY created_at,id').all(postId).map((file) => ({
    id: file.id, name: file.file_name, type: file.file_type, size: file.file_size,
    kind: evidencePreviewKind(file.file_name, file.file_type), url: `/api/${teacher ? 'student-forum/teacher' : 'student-portal/forum'}/attachments/${file.id}`
  }));
  const mapPost = (post, req, teacher = false) => ({
    unitNumber: post.unit_number, bimester: bimesterFor(post.unit_number),
    attachmentRemovalRemaining: Math.max(0, 3 - db.prepare("SELECT COUNT(*) AS n FROM student_forum_attachment_removals WHERE post_id=? AND actor_type='student'").get(post.id).n),
    reviewedAt: post.reviewed_at, reactions: reactionsFor('posts', post.id, req, teacher),
    id: post.id, title: post.title, body: post.body, category: post.category, authorName: post.author_name,
    authorId: post.author_id, year: post.year, grade: post.grade, section: post.section,
    profileUrl: `/api/${teacher ? 'student-forum/teacher' : 'student-portal/forum'}/profiles/${encodeURIComponent(post.author_id)}`,
    sessionId: post.session_id, moderationStatus: post.moderation_status, ...commenting(post),
    pinned: !!post.pinned, locked: !!post.locked, hidden: !!post.hidden, createdAt: post.created_at, updatedAt: post.updated_at,
    own: !teacher && post.author_id === String(req.studentPortal.studentId), attachments: attachments(post.id, teacher),
    commentCount: db.prepare('SELECT COUNT(*) AS count FROM student_forum_comments WHERE post_id=? AND hidden=0 AND deleted=0').get(post.id).count,
    ...(teacher ? { deleted: !!post.deleted, reportCount: db.prepare('SELECT COUNT(*) AS count FROM student_forum_reports WHERE post_id=? AND resolved=0').get(post.id).count } : {})
  });
  const list = (req, teacher = false) => {
    const ctx = teacher ? req.query : context(req);
    const clauses = ['deleted=0']; const args = [];
    for (const key of ['year', 'grade', 'section']) { const value = key === 'year' || teacher ? ctx[key] : req.query[key]; if (value) { clauses.push(`${key}=?`); args.push(String(value)); } }
    if (!teacher) { clauses.push("(hidden=0 OR (author_id=? AND moderation_status='pending'))"); args.push(String(ctx.student.id)); }
    if (FORUM_CATEGORIES.includes(req.query.category)) { clauses.push('category=?'); args.push(req.query.category); }
    if (!teacher && req.query.mine === '1') { clauses.push('author_id=?'); args.push(String(req.studentPortal.studentId)); }
    if (req.query.unit) { clauses.push('unit_number=?'); args.push(req.query.unit === 'general' ? '' : unitFor(req.query.unit)); }
    if (req.query.bimester) {
      const index = ['I', 'II', 'III', 'IV'].indexOf(String(req.query.bimester));
      if (index < 0) fail(400, 'Bimestre inválido.');
      clauses.push('unit_number IN (?,?)'); args.push(String(index * 2 + 1), String(index * 2 + 2));
    }
    if (req.query.search) { clauses.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR author_name LIKE ? ESCAPE '\\')"); const term = `%${String(req.query.search).slice(0, 120).replace(/[\\%_]/g, '\\$&')}%`; args.push(term, term, term); }
    const where = clauses.join(' AND ');
    const offset = offsetFor(req.query.offset), limit = 20;
    const rows = db.prepare(`SELECT * FROM student_forum_posts WHERE ${where} ORDER BY pinned DESC,created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) AS count FROM student_forum_posts WHERE ${where}`).get(...args).count;
    const scopeYear = String(ctx.year || db.prepare('SELECT year FROM datos_generales ORDER BY id DESC LIMIT 1').get()?.year || new Date().getFullYear());
    return { posts: rows.map((post) => mapPost(post, req, teacher)), total, offset, hasMore: offset + rows.length < total, scopeYear, scopes: scopeStates(scopeYear), classroom: teacher ? null : { year: ctx.year, grade: ctx.grade, section: ctx.section }, categories: FORUM_CATEGORIES, maxFiles: 3, maxFileBytes: FORUM_MAX_FILE_BYTES };
  };
  const detail = (req, teacher = false) => {
    const post = postFor(req, req.params.id, teacher), offset = offsetFor(req.query.offset);
    const where = `post_id=?${teacher ? '' : " AND deleted=0 AND (hidden=0 OR (moderation_status='pending' AND author_id=?))"}`;
    const args = teacher ? [post.id] : [post.id, String(req.studentPortal.studentId)];
    const comments = db.prepare(`SELECT * FROM student_forum_comments WHERE ${where} ORDER BY created_at,id LIMIT 30 OFFSET ?`).all(...args, offset);
    const total = db.prepare(`SELECT COUNT(*) AS count FROM student_forum_comments WHERE ${where}`).get(...args).count;
    return { post: mapPost(post, req, teacher), comments: comments.map((comment) => mapComment(comment, req, teacher)), offset, total, hasMore: offset + comments.length < total };
  };
  router.put('/student-portal/forum/:kind/:id/reaction', requireStudentAuth, route(req => react(req, false)));
  router.put('/student-forum/teacher/:kind/:id/reaction', requireTeacher, route(req => react(req, true)));
  router.patch('/student-forum/teacher/scopes', requireTeacher, route(req => {
    const year = text(req.body.year, 4, 4), type = String(req.body.type), value = String(req.body.value || '');
    if (!/^\d{4}$/.test(year) || typeof req.body.closed !== 'boolean' || !['all', 'unit', 'bimester'].includes(type)) fail(400, 'Período inválido.');
    if (type === 'unit' && value !== 'general') unitFor(value || 'invalid');
    if (type === 'bimester' && !['I', 'II', 'III', 'IV'].includes(value)) fail(400, 'Bimestre inválido.');
    if (type === 'all' && value) fail(400, 'Período inválido.');
    const key = JSON.stringify([year, type, value]), now = new Date().toISOString();
    db.prepare('INSERT INTO student_forum_scopes(id,year,scope_type,scope_value,closed,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET closed=excluded.closed,updated_at=excluded.updated_at').run(key, year, type, value, Number(req.body.closed), now);
    return { scopes: scopeStates(year) };
  }));
  router.get('/student-portal/forum/posts', requireStudentAuth, route((req) => list(req)));
  router.get('/student-portal/forum/resources', requireStudentAuth, route((req) => {
    const ctx = context(req);
    const sessions = (sessionsForStudent?.(ctx.student, ctx.year) || []).map((row) => { let data = {}; try { data = JSON.parse(row.session_data || '{}'); } catch {} return { id: String(row.id_sesion), title: data.titulo || data.title || `Sesión ${row.session_number || row.id_sesion}`, unit: row.unit_number, area: row.area_id }; });
    const evidences = db.prepare('SELECT id,session_id,file_name,file_type,file_size,unit_number,session_number,area_id,submitted_at FROM evaluacion_evidencias WHERE student_id=? AND year=? AND is_latest=1 ORDER BY area_id,unit_number,session_number,submitted_at DESC').all(String(ctx.student.id), ctx.year);
    return { sessions, evidences, year: ctx.year };
  }));
  const draftKey = (req) => { const ctx = context(req); return { ctx, id: `student:${ctx.year}:${ctx.student.id}` }; };
  router.get('/student-portal/forum/draft', requireStudentAuth, route((req) => { const { id } = draftKey(req); const row = db.prepare('SELECT data_json,updated_at FROM student_forum_drafts WHERE id=?').get(id); return row ? { data: JSON.parse(row.data_json), updatedAt: row.updated_at } : { data: {}, updatedAt: '' }; }));
  router.put('/student-portal/forum/draft', requireStudentAuth, route((req) => {
    const { ctx, id } = draftKey(req), source = req.body || {}, data = { post: {}, comments: {} };
    for (const field of ['title', 'body', 'category', 'sessionId', 'unitNumber']) data.post[field] = text(source.post?.[field], field === 'body' ? 6000 : 200);
    data.post.evidenceIds = Array.isArray(source.post?.evidenceIds) ? source.post.evidenceIds.slice(0, 3).map(String) : [];
    data.post.uploadNames = Array.isArray(source.post?.uploadNames) ? source.post.uploadNames.slice(0, 3).map((name) => String(name).slice(0, 180)) : [];
    for (const [key, value] of Object.entries(source.comments || {}).slice(-50)) { if (/^[a-z0-9-]{16,80}$/i.test(key)) data.comments[key] = text(value, 2000); }
    const now = new Date().toISOString();
    db.prepare('INSERT INTO student_forum_drafts(id,author_id,year,data_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at').run(id, String(ctx.student.id), ctx.year, JSON.stringify(data), now);
    return { updatedAt: now };
  }));
  router.get('/student-portal/forum/notifications', requireStudentAuth, route((req) => {
    const ctx = context(req), where = "n.recipient_id=? AND p.year=? AND p.deleted=0 AND p.hidden=0";
    return { items: db.prepare(`SELECT n.id,n.post_id AS postId,n.message,n.created_at AS createdAt,n.read_at AS readAt FROM student_forum_notifications n JOIN student_forum_posts p ON p.id=n.post_id WHERE ${where} ORDER BY n.created_at DESC LIMIT 40`).all(String(ctx.student.id), ctx.year), unread: db.prepare(`SELECT COUNT(*) AS n FROM student_forum_notifications n JOIN student_forum_posts p ON p.id=n.post_id WHERE ${where} AND n.read_at=''`).get(String(ctx.student.id), ctx.year).n };
  }));
  router.patch('/student-portal/forum/notifications', requireStudentAuth, route((req) => {
    const ctx = context(req), now = new Date().toISOString();
    const postId = String(req.body.postId || '');
    db.prepare(`UPDATE student_forum_notifications SET read_at=?,updated_at=? WHERE recipient_id=? AND read_at=''${postId ? ' AND post_id=?' : ''}`).run(now, now, String(ctx.student.id), ...(postId ? [postId] : [])); return { read: true };
  }));
  const profile = async (req, res, teacher) => {
    if (!teacher) context(req);
    const row = db.prepare("SELECT image_data FROM asistencia_rostros WHERE student_id=? ORDER BY CASE WHEN source='student_profile_front' THEN 0 ELSE 1 END,updated_at DESC LIMIT 1").get(String(req.params.id));
    const match = /^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(row?.image_data || '');
    if (!match) { res.status(204).end(); return; }
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); if (teacher) { res.type(`image/${match[1]}`).send(Buffer.from(match[2], 'base64')); return; }
    let thumbnail;
    try { thumbnail = await sharp(Buffer.from(match[2], 'base64'), {limitInputPixels:40000000}).rotate().resize({width:80,height:80,fit:'cover',withoutEnlargement:true}).webp({quality:70}).toBuffer(); }
    catch { res.status(204).end(); return; }
    res.type('image/webp').send(thumbnail);
  };
  router.get('/student-portal/forum/profiles/:id', requireStudentAuth, route((req, res) => profile(req, res, false)));
  router.get('/student-forum/teacher/profiles/:id', requireTeacher, route((req, res) => profile(req, res, true)));
  const photoUpload = multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1,fields:0}}).single('file');
  router.put('/student-forum/teacher/profiles/:id', requireTeacher, (req,res,next) => photoUpload(req,res,error => error ? res.status(400).json({success:false,message:'Selecciona una foto de hasta 8 MB.'}) : next()), route(async req => {
    const student = db.prepare('SELECT * FROM db_estudiantes WHERE id=?').get(req.params.id);
    if(!student) fail(404,'Estudiante no encontrado.');
    if(!req.file || !/^image\/(jpeg|png|webp)$/.test(req.file.mimetype)) fail(400,'Selecciona JPG, PNG o WebP.');
    let optimized;
    try {
      const image = sharp(req.file.buffer, {limitInputPixels:40000000});
      const metadata = await image.metadata();
      if(!['jpeg','png','webp'].includes(metadata.format)) fail(400,'Formato de foto no admitido.');
      optimized = await image.rotate().resize({width:640,height:640,fit:'cover',position:'attention',withoutEnlargement:true}).webp({quality:80}).toBuffer();
    } catch { fail(400,'No se pudo procesar la foto seleccionada.'); }
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare("DELETE FROM asistencia_rostros WHERE student_id=? AND source='student_profile_front'").run(String(student.id));
      db.prepare("INSERT INTO asistencia_rostros(student_id,student_name,grade,section,image_data,descriptor,source,updated_at) VALUES(?,?,?,?,?,'','student_profile_front',?)").run(String(student.id),student.estudiantes,student.grado,student.secc,`data:image/webp;base64,${optimized.toString('base64')}`,now);
    })();
    return {saved:true};
  }));
  router.get('/student-portal/forum/posts/:id', requireStudentAuth, route((req) => detail(req)));
  router.post('/student-portal/forum/posts', requireStudentAuth, upload, route(async (req) => {
    const ctx = context(req), id = requestId(req), authorId = String(ctx.student.id);
    const previous = db.prepare('SELECT * FROM student_forum_posts WHERE id=?').get(id);
    if (previous) { own(previous, req); postFor(req, id); return { id }; }
    const title = text(req.body.title, 140, 3), body = text(req.body.body, 6000);
    let evidenceIds; try { evidenceIds = JSON.parse(req.body.evidenceIds || '[]'); } catch { fail(400, 'Selección de evidencias inválida.'); }
    if (!Array.isArray(evidenceIds) || evidenceIds.length + (req.files?.length || 0) > 3) fail(400, 'Selecciona hasta tres archivos en total.');
    evidenceIds = [...new Set(evidenceIds.map(String))];
    const previousFiles = [];
    for (const evidenceId of evidenceIds) {
      const row = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id=? AND student_id=? AND year=? AND is_latest=1').get(evidenceId, authorId, ctx.year);
      if (!row) fail(403, 'Solo puedes compartir tus propias evidencias actuales.');
      let absolute = resolveEvidence?.(row);
      if (!absolute && row.relative_path) { await recoverFile(row.relative_path); absolute = resolveEvidence?.(row); }
      if (!absolute || !fs.existsSync(absolute)) fail(404, 'La evidencia todavía no está disponible en este equipo.');
      const size = fs.statSync(absolute).size;
      if (size > FORUM_MAX_FILE_BYTES) fail(413, 'Máximo 25 MB por archivo.');
      if (!EVIDENCE_EXTENSION_SET.has(evidenceExtension(row.file_name || absolute))) fail(400, 'Formato no admitido.');
      previousFiles.push({ path: absolute, originalname: row.file_name || path.basename(absolute), size, sessionId: row.session_id });
    }
    const inferred = previousFiles.length && previousFiles.every((file) => file.sessionId === previousFiles[0].sessionId) ? String(previousFiles[0].sessionId) : '';
    const sessionId = validateSession(ctx, String(req.body.sessionId || inferred || ''));
    const unitNumber = postUnit(sessionId, req.body.unitNumber);
    ensureScopeOpen(ctx.year, unitNumber);
    if (previousFiles.some((file) => String(file.sessionId || '') !== sessionId)) fail(400, 'Selecciona evidencias de una misma sesión para conservar su plazo de comentarios.');
    if (!body && !req.files?.length && !previousFiles.length) fail(400, 'Escribe un mensaje o adjunta un archivo.');
    const category = String(req.body.category || 'aporte');
    if (!FORUM_CATEGORIES.includes(category)) fail(400, 'Selecciona una categoría válida.');
    rate('student_forum_posts', authorId, 10);
    const now = new Date().toISOString(), copied = [];
    try {
      const files = [...(req.files || []), ...previousFiles].map((file) => {
        const fileId = crypto.randomUUID(), ext = evidenceExtension(file.originalname), storedName = `${fileId}.${ext}`;
        const target = path.join(folder, storedName); fs.copyFileSync(file.path, target, fs.constants.COPYFILE_EXCL); copied.push(target);
        return { id: fileId, storedName, name: path.basename(file.originalname).replace(/[\r\n\u0000-\u001f]/g, '').slice(0, 180), type: mimeByExtension[ext] || 'application/octet-stream', size: file.size };
      });
      db.transaction(() => {
        db.prepare('INSERT INTO student_forum_posts(id,year,grade,section,author_id,author_name,title,body,category,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, ctx.year, ctx.grade, ctx.section, authorId, String(ctx.student.estudiantes), title, body, category, now, now);
        const matches = detectForumLanguage(`${title} ${body}`);
        db.prepare('UPDATE student_forum_posts SET unit_number=?,session_id=?,hidden=?,moderation_status=?,moderation_matches=? WHERE id=?').run(unitNumber, sessionId, Number(!!matches.length), matches.length ? 'pending' : 'approved', JSON.stringify(matches), id);
        autoReport(id, '', matches);
        const insert = db.prepare('INSERT INTO student_forum_attachments(id,post_id,stored_name,file_name,file_type,file_size,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
        files.forEach((file) => insert.run(file.id, id, file.storedName, file.name, file.type, file.size, now, now));
      })();
    } catch (error) { copied.forEach((file) => fs.rmSync(file, { force: true })); throw error; }
    return { id, moderationStatus: db.prepare('SELECT moderation_status FROM student_forum_posts WHERE id=?').get(id).moderation_status };
  }));
  router.patch('/student-portal/forum/posts/:id', requireStudentAuth, route((req) => {
    const post = postFor(req, req.params.id); own(post, req);
    if (post.moderation_status === 'pending') fail(403, 'El docente debe revisar esta publicación antes de modificarla.');
    if (post.locked) fail(403, 'El docente cerró esta conversación.');
    ensureScopeOpen(post.year, post.unit_number);
    const unitNumber = postUnit(post.session_id, req.body.unitNumber, post.unit_number);
    ensureScopeOpen(post.year, unitNumber);
    const title = text(req.body.title, 140, 3), body = text(req.body.body, 6000), category = String(req.body.category);
    if (!FORUM_CATEGORIES.includes(category) || (!body && !attachments(post.id).length)) fail(400, 'Revisa la categoría y el contenido.');
    db.prepare("UPDATE student_forum_posts SET reviewed_at='',unit_number=?,title=?,body=?,category=?,updated_at=? WHERE id=?").run(unitNumber, title, body, category, new Date().toISOString(), post.id);
    const matches = detectForumLanguage(`${title} ${body}`);
    if (matches.length) { db.prepare("UPDATE student_forum_posts SET hidden=1,moderation_status='pending',moderation_matches=? WHERE id=?").run(JSON.stringify(matches), post.id); autoReport(post.id, '', matches); }
    return { id: post.id };
  }));
  router.delete('/student-portal/forum/posts/:id', requireStudentAuth, route((req) => {
    const post = postFor(req, req.params.id); own(post, req);
    if (post.moderation_status === 'pending') fail(403, 'Solo el docente puede eliminar contenido pendiente de revisión.');
    db.prepare('UPDATE student_forum_posts SET deleted=1,updated_at=? WHERE id=?').run(new Date().toISOString(), post.id);
    return { deleted: true };
  }));
  router.post('/student-portal/forum/posts/:id/comments', requireStudentAuth, route((req) => {
    const post = postFor(req, req.params.id), ctx = context(req), id = requestId(req);
    const previous = db.prepare('SELECT * FROM student_forum_comments WHERE id=?').get(id);
    if (previous) { own(previous, req); if (previous.post_id !== post.id || previous.deleted) fail(409, 'El comentario ya no está disponible.'); return { id }; }
    const window = commenting(post); if (!window.canComment) fail(403, window.closeReason);
    const body = text(req.body.body, 2000, 1), now = new Date().toISOString();
    rate('student_forum_comments', String(ctx.student.id), 40);
    db.prepare('INSERT INTO student_forum_comments(id,post_id,author_id,author_name,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, post.id, String(ctx.student.id), String(ctx.student.estudiantes), body, now, now);
    const matches = detectForumLanguage(body);
    db.prepare('UPDATE student_forum_comments SET author_grade=?,author_section=?,hidden=?,moderation_status=?,moderation_matches=? WHERE id=?').run(ctx.grade, ctx.section, Number(!!matches.length), matches.length ? 'pending' : 'approved', JSON.stringify(matches), id);
    if (matches.length) autoReport(post.id, id, matches);
    else notifyReply(post, db.prepare('SELECT * FROM student_forum_comments WHERE id=?').get(id));
    return { id, moderationStatus: matches.length ? 'pending' : 'approved' };
  }));
  router.delete('/student-portal/forum/comments/:id', requireStudentAuth, route((req) => {
    const comment = db.prepare('SELECT * FROM student_forum_comments WHERE id=? AND hidden=0 AND deleted=0').get(req.params.id);
    if (!comment) fail(404, 'Comentario no disponible.');
    postFor(req, comment.post_id); own(comment, req);
    db.prepare('UPDATE student_forum_comments SET deleted=1,updated_at=? WHERE id=?').run(new Date().toISOString(), comment.id);
    return { deleted: true };
  }));
  router.post('/student-portal/forum/posts/:id/reports', requireStudentAuth, route((req) => {
    const post = postFor(req, req.params.id), ctx = context(req), commentId = String(req.body.commentId || '');
    if (commentId && !db.prepare('SELECT 1 FROM student_forum_comments WHERE id=? AND post_id=? AND hidden=0 AND deleted=0').get(commentId, post.id)) fail(404, 'Comentario no disponible.');
    const reason = text(req.body.reason, 500, 5);
    const existing = db.prepare('SELECT id FROM student_forum_reports WHERE post_id=? AND comment_id=? AND reporter_id=? AND resolved=0').get(post.id, commentId, String(ctx.student.id));
    if (existing) return { id: existing.id };
    if (db.prepare('SELECT COUNT(*) AS count FROM student_forum_reports WHERE reporter_id=? AND created_at>?').get(String(ctx.student.id), new Date(Date.now() - 5 * 60 * 1000).toISOString()).count >= 20) fail(429, 'Espera unos minutos antes de enviar más reportes.');
    const now = new Date().toISOString(), id = crypto.randomUUID();
    db.prepare('INSERT INTO student_forum_reports(id,post_id,comment_id,reporter_id,reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, post.id, commentId, String(ctx.student.id), reason, now, now);
    return { id };
  }));
  const serveFile = async (req, res, teacher = false) => {
    const file = db.prepare('SELECT * FROM student_forum_attachments WHERE id=? AND deleted=0').get(req.params.id);
    if (!file) fail(404, 'Archivo no disponible.');
    postFor(req, file.post_id, teacher);
    if (!/^[a-f0-9-]+\.[a-z0-9]+$/.test(file.stored_name)) fail(404, 'Archivo no disponible.');
    const absolute = path.join(folder, file.stored_name);
    if (!fs.existsSync(absolute)) await recoverFile(`uploads/user-assets/forum/${file.stored_name}`);
    if (!fs.existsSync(absolute)) fail(404, 'El archivo todavía no está disponible en este equipo.');
    res.setHeader('Content-Type', file.file_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:");
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    await new Promise((resolve, reject) => res.sendFile(absolute, (error) => error ? reject(error) : resolve()));
  };
  router.get('/student-portal/forum/attachments/:id', requireStudentAuth, route((req, res) => serveFile(req, res)));
  router.get('/student-forum/teacher/posts', requireTeacher, route((req) => list(req, true)));
  router.get('/student-forum/teacher/posts/:id', requireTeacher, route((req) => detail(req, true)));
  router.get('/student-forum/teacher/attachments/:id', requireTeacher, route((req, res) => serveFile(req, res, true)));
  const removeAttachments = (req, teacher) => db.transaction(() => {
    const post = postFor(req, req.params.id, teacher);
    if (post.deleted) fail(409, 'La publicación fue eliminada.');
    if (!teacher) own(post, req);
    const operationId = requestId(req), actorId = teacher ? 'teacher' : String(req.studentPortal.studentId);
    const previous = db.prepare('SELECT * FROM student_forum_attachment_removals WHERE id=?').get(operationId);
    if (previous) {
      if (previous.post_id !== post.id || previous.actor_id !== actorId || previous.actor_type !== (teacher ? 'teacher' : 'student')) fail(409, 'Identificador ya utilizado.');
      return { removed: JSON.parse(previous.attachment_ids), remaining: mapPost(post, req, teacher).attachmentRemovalRemaining };
    }
    if (!teacher && post.moderation_status === 'pending') fail(403, 'El docente debe revisar el contenido antes de modificar sus adjuntos.');
    const source = req.body.attachmentIds;
    if (!Array.isArray(source) || !source.length || source.length > 100 || source.some(value => typeof value !== 'string')) fail(400, 'Selecciona los archivos que deseas eliminar.');
    const ids = [...new Set(source)];
    const files = attachments(post.id, teacher);
    if (ids.some(id => !files.some(file => file.id === id))) fail(404, 'Algún adjunto no pertenece a esta publicación o ya fue eliminado.');
    const used = db.prepare("SELECT COUNT(*) AS n FROM student_forum_attachment_removals WHERE post_id=? AND actor_type='student'").get(post.id).n;
    if (!teacher && used >= 3) fail(403, 'Ya utilizaste las tres operaciones para eliminar archivos de esta publicación. Solicita ayuda al docente.');
    if (!teacher && !post.body.trim() && ids.length === files.length) fail(400, 'Escribe un mensaje antes de eliminar el último adjunto, o elimina la publicación completa.');
    const now = new Date().toISOString();
    const update = db.prepare('UPDATE student_forum_attachments SET deleted=1,updated_at=? WHERE id=? AND post_id=?');
    ids.forEach(id => update.run(now, id, post.id));
    db.prepare('INSERT INTO student_forum_attachment_removals(id,post_id,actor_type,actor_id,attachment_ids,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(operationId, post.id, teacher ? 'teacher' : 'student', actorId, JSON.stringify(ids), now, now);
    db.prepare("UPDATE student_forum_posts SET reviewed_at='',updated_at=? WHERE id=?").run(now, post.id);
    return { removed: ids, remaining: teacher ? null : 2 - used };
  })();
  router.post('/student-portal/forum/posts/:id/attachments/remove', requireStudentAuth, route(req => removeAttachments(req, false)));
  router.post('/student-forum/teacher/posts/:id/attachments/remove', requireTeacher, route(req => removeAttachments(req, true)));
  router.patch('/student-forum/teacher/posts/:id', requireTeacher, route((req) => {
    const post = postFor(req, req.params.id, true), changes = [];
    if (post.deleted) fail(409, 'La publicación fue eliminada.');
    if (req.body.unitNumber !== undefined) {
      const unitNumber = postUnit(post.session_id, req.body.unitNumber, post.unit_number);
      db.prepare('UPDATE student_forum_posts SET unit_number=?,updated_at=? WHERE id=?').run(unitNumber, new Date().toISOString(), post.id);
      return { id: post.id };
    }
    if (req.body.action === 'reopen') {
      db.prepare('UPDATE student_forum_posts SET locked=0,comments_reopened=1,updated_at=? WHERE id=?').run(new Date().toISOString(), post.id);
      return { id: post.id };
    }
    if (req.body.action === 'approve') {
      db.prepare("UPDATE student_forum_posts SET hidden=0,moderation_status='approved',reviewed_at=?,updated_at=? WHERE id=?").run(new Date().toISOString(), new Date().toISOString(), post.id);
      db.prepare("UPDATE student_forum_reports SET resolved=1,updated_at=? WHERE post_id=? AND comment_id='' AND reporter_id='system'").run(new Date().toISOString(), post.id);
      notifyStudent(post.author_id, post.id, '', 'moderation', 'El docente aprobó tu publicación.'); return { id: post.id };
    }
    if (post.moderation_status === 'pending' && req.body.hidden === false) fail(400, 'Usa Aprobar para publicar el contenido pendiente.');
    for (const field of ['pinned', 'locked', 'hidden']) if (typeof req.body[field] === 'boolean') changes.push(field);
    if (!changes.length) fail(400, 'No hay cambios válidos.');
    db.prepare(`UPDATE student_forum_posts SET ${changes.map((key) => `${key}=?`).join(',')},updated_at=? WHERE id=?`).run(...changes.map((key) => Number(req.body[key])), new Date().toISOString(), post.id);
    if (typeof req.body.locked === 'boolean') db.prepare('UPDATE student_forum_posts SET comments_reopened=0 WHERE id=?').run(post.id);
    return { id: post.id };
  }));
  router.patch('/student-forum/teacher/comments/:id', requireTeacher, route((req) => {
    const comment = db.prepare('SELECT * FROM student_forum_comments WHERE id=? AND deleted=0').get(req.params.id);
    if (!comment) fail(404, 'Comentario no disponible.');
    const post = postFor(req, comment.post_id, true);
    if (post.deleted) fail(409, 'La publicaci\u00f3n fue eliminada.');
    if (req.body.action === 'approve') {
      db.prepare("UPDATE student_forum_comments SET hidden=0,moderation_status='approved',reviewed_at=?,updated_at=? WHERE id=?").run(new Date().toISOString(), new Date().toISOString(), comment.id);
      db.prepare("UPDATE student_forum_reports SET resolved=1,updated_at=? WHERE comment_id=? AND reporter_id='system'").run(new Date().toISOString(), comment.id);
      if (comment.moderation_status === 'pending') { notifyReply(post, comment); notifyStudent(comment.author_id, post.id, comment.id, 'moderation', 'El docente aprobó tu comentario.'); }
      return { id: comment.id };
    }
    if (typeof req.body.hidden !== 'boolean') fail(400, 'Indica si deseas ocultar el comentario.');
    if (comment.moderation_status === 'pending' && req.body.hidden === false) fail(400, 'Usa Aprobar para publicar el comentario pendiente.');
    db.prepare('UPDATE student_forum_comments SET hidden=?,updated_at=? WHERE id=?').run(Number(req.body.hidden), new Date().toISOString(), comment.id);
    return { id: comment.id };
  }));
  for (const [kind, table] of [['comments', 'student_forum_comments'], ['posts', 'student_forum_posts']]) router.delete(`/student-forum/teacher/${kind}/:id`, requireTeacher, route((req) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id); if (!row) fail(404, 'Contenido no disponible.');
    const now = new Date().toISOString();
    db.prepare(`UPDATE ${table} SET deleted=1,hidden=1,moderation_status='rejected',updated_at=? WHERE id=?`).run(now, row.id);
    db.prepare(`UPDATE student_forum_reports SET resolved=1,updated_at=? WHERE ${kind === 'comments' ? 'comment_id' : 'post_id'}=?`).run(now, row.id);
    notifyStudent(row.author_id, kind === 'comments' ? row.post_id : row.id, kind === 'comments' ? row.id : '', 'moderation', 'El docente eliminó el contenido tras su revisión.'); return { deleted: true };
  }));
  router.post('/student-forum/teacher/posts/:id/comments', requireTeacher, route((req) => {
    const post = postFor(req, req.params.id, true), window = commenting(post); if (!window.canComment) fail(403, window.closeReason);
    const id = requestId(req), previous = db.prepare('SELECT * FROM student_forum_comments WHERE id=?').get(id);
    if (previous) { if (previous.author_type !== 'teacher' || previous.post_id !== post.id) fail(409, 'Identificador ya utilizado.'); return { id }; }
    const body = text(req.body.body, 2000, 1), now = new Date().toISOString(), name = db.prepare('SELECT teacher FROM datos_generales ORDER BY id DESC LIMIT 1').get()?.teacher || 'Docente';
    db.prepare("INSERT INTO student_forum_comments(id,post_id,author_id,author_name,author_type,body,created_at,updated_at) VALUES(?,?,'teacher',?,'teacher',?,?,?)").run(id, post.id, name, body, now, now);
    notifyReply(post, db.prepare('SELECT * FROM student_forum_comments WHERE id=?').get(id)); return { id };
  }));
  router.get('/student-forum/teacher/alerts', requireTeacher, route(() => ({
    pendingComments: db.prepare("SELECT COUNT(*) AS n FROM student_forum_comments c JOIN student_forum_posts p ON p.id=c.post_id WHERE c.moderation_status='pending' AND c.deleted=0 AND p.deleted=0").get().n,
    pendingPosts: db.prepare("SELECT COUNT(*) AS n FROM student_forum_posts WHERE moderation_status='pending' AND deleted=0").get().n,
    reports: db.prepare('SELECT COUNT(*) AS n FROM student_forum_reports WHERE resolved=0').get().n,
    latestReply: db.prepare('SELECT MAX(updated_at) AS at FROM student_forum_comments WHERE deleted=0').get().at || ''
  })));
  router.get('/student-forum/teacher/moderation', requireTeacher, route((req) => ({
    posts: db.prepare("SELECT * FROM student_forum_posts WHERE moderation_status='pending' AND deleted=0 ORDER BY created_at LIMIT 100").all().map((post) => mapPost(post, req, true)),
    comments: db.prepare("SELECT c.*,p.title,p.id AS postId FROM student_forum_comments c JOIN student_forum_posts p ON p.id=c.post_id WHERE c.moderation_status='pending' AND c.deleted=0 AND p.deleted=0 ORDER BY c.created_at LIMIT 100").all().map((comment) => ({ ...mapComment(comment, req, true), postId: comment.postId, title: comment.title }))
  })));
  router.get('/student-forum/teacher/reports', requireTeacher, route(() => db.prepare('SELECT r.*,p.title,p.grade,p.section,p.year,s.estudiantes AS reporter_name FROM student_forum_reports r JOIN student_forum_posts p ON p.id=r.post_id LEFT JOIN db_estudiantes s ON CAST(s.id AS TEXT)=r.reporter_id WHERE r.resolved=0 ORDER BY r.created_at LIMIT 200').all()));
  router.patch('/student-forum/teacher/reports/:id', requireTeacher, route((req) => {
    const result = db.prepare('UPDATE student_forum_reports SET resolved=1,updated_at=? WHERE id=?').run(new Date().toISOString(), req.params.id);
    if (!result.changes) fail(404, 'Reporte no disponible.');
    return { resolved: true };
  }));
  return router;
}
