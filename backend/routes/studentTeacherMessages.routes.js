import express from 'express';

export const createStudentTeacherMessageRoutes = ({ db, requireStudentAuth, requireTeacher, presence }) => {
  const router = express.Router();
  db.exec(`CREATE TABLE IF NOT EXISTS student_teacher_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL, body TEXT NOT NULL, teacher_name TEXT NOT NULL,
    audience TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS student_teacher_message_recipients (
    message_id INTEGER NOT NULL, student_id TEXT NOT NULL, read_at TEXT, notified_at TEXT,
    PRIMARY KEY(message_id,student_id)
  );
  CREATE INDEX IF NOT EXISTS student_teacher_inbox ON student_teacher_message_recipients(student_id,message_id);`);
  const onlineIds = () => new Set((presence().students || []).filter(item => item.online).map(item => String(item.userId)));
  const students = () => db.prepare("SELECT id,estudiantes AS name,grado AS grade,secc AS section FROM db_estudiantes WHERE estado='A' ORDER BY grado,secc,estudiantes").all();
  const shape = row => ({ id: row.id, title: row.title, body: row.body, teacherName: row.teacher_name, createdAt: row.created_at, readAt: row.read_at || null, notifiedAt: row.notified_at || null });
  router.get('/student-messages/teacher/recipients', requireTeacher, (_req,res) => {
    const online = onlineIds();
    res.setHeader('Cache-Control','no-store');
    res.json({success:true,data:students().map(item => ({...item,id:String(item.id),online:online.has(String(item.id))}))});
  });
  router.get('/student-messages/teacher/messages', requireTeacher, (_req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.json({success:true,data:db.prepare(`SELECT m.id,m.title,m.body,m.teacher_name AS teacherName,m.audience,m.created_at AS createdAt,
      COUNT(r.student_id) AS recipients, SUM(CASE WHEN r.read_at IS NOT NULL THEN 1 ELSE 0 END) AS readCount
      FROM student_teacher_messages m JOIN student_teacher_message_recipients r ON r.message_id=m.id GROUP BY m.id ORDER BY m.id DESC LIMIT 50`).all()});
  });
  router.post('/student-messages/teacher/messages', requireTeacher, (req,res) => {
    const {audience,studentId,grade,section} = req.body || {};
    const title=String(req.body?.title || '').trim(), body=String(req.body?.body || '').trim(), requestId=String(req.body?.requestId || '');
    if (!title || title.length>120 || !body || body.length>5000 || !/^[\w-]{8,100}$/.test(requestId)) return res.status(400).json({success:false,message:'Escribe un asunto (hasta 120 caracteres) y un mensaje (hasta 5000 caracteres).'});
    if (!['online','all','class','personal'].includes(audience) || audience==='class'&&!grade || audience==='personal'&&!studentId) return res.status(400).json({success:false,message:'Selecciona los destinatarios del mensaje.'});
    const existing=db.prepare('SELECT id FROM student_teacher_messages WHERE request_id=?').get(requestId);
    if (existing) return res.json({success:true,data:{id:existing.id,recipients:db.prepare('SELECT COUNT(*) AS total FROM student_teacher_message_recipients WHERE message_id=?').get(existing.id).total}});
    const online=onlineIds();
    const recipients=students().filter(item => audience==='all' || audience==='online'&&online.has(String(item.id)) || audience==='personal'&&String(item.id)===String(studentId) || audience==='class'&&item.grade===grade&&(!section||item.section===section));
    if (!recipients.length) return res.status(400).json({success:false,message:'No hay estudiantes en la selección. Actualiza la lista de destinatarios.'});
    const teacher=String(db.prepare('SELECT teacher FROM datos_generales ORDER BY id DESC LIMIT 1').get()?.teacher || 'Docente');
    const id=db.transaction(() => {
      const id=db.prepare('INSERT INTO student_teacher_messages(request_id,title,body,teacher_name,audience) VALUES(?,?,?,?,?)').run(requestId,title,body,teacher,audience).lastInsertRowid;
      const add=db.prepare('INSERT INTO student_teacher_message_recipients(message_id,student_id) VALUES(?,?)');
      recipients.forEach(item=>add.run(id,String(item.id)));
      return Number(id);
    })();
    return res.json({success:true,data:{id,recipients:recipients.length}});
  });
  router.get('/student-portal/teacher-messages', requireStudentAuth, (req,res) => {
    const id=String(req.studentPortal.studentId);
    const rows=db.prepare(`SELECT m.*,r.read_at,r.notified_at FROM student_teacher_messages m JOIN student_teacher_message_recipients r ON r.message_id=m.id WHERE r.student_id=? ORDER BY m.id DESC LIMIT 100`).all(id);
    const unread=db.prepare('SELECT COUNT(*) AS total FROM student_teacher_message_recipients WHERE student_id=? AND read_at IS NULL').get(id).total;
    res.setHeader('Cache-Control','no-store');
    res.json({success:true,data:{items:rows.map(shape),unread}});
  });
  for (const action of ['read','notified']) router.post(`/student-portal/teacher-messages/:id/${action}`, requireStudentAuth, (req,res) => {
    const field=action==='read'?'read_at':'notified_at';
    const result=db.prepare(`UPDATE student_teacher_message_recipients SET ${field}=COALESCE(${field},CURRENT_TIMESTAMP) WHERE message_id=? AND student_id=?`).run(req.params.id,String(req.studentPortal.studentId));
    if (!result.changes) return res.status(404).json({success:false,message:'Mensaje no encontrado.'});
    res.json({success:true});
  });
  return router;
};
