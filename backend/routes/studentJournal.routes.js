import express from 'express';
import crypto from 'node:crypto';

export function createStudentJournalRoutes({ db, requireStudentAuth, sessionForStudent, mapEvidence }) {
  db.exec(`CREATE TABLE IF NOT EXISTS student_learning_journal (
    id TEXT PRIMARY KEY, student_id TEXT NOT NULL, session_id TEXT NOT NULL,
    entry_date TEXT NOT NULL, content_json TEXT NOT NULL DEFAULT '{}', evidence_ids TEXT NOT NULL DEFAULT '[]',
    revision TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(student_id,session_id)
  ); CREATE INDEX IF NOT EXISTS learning_journal_student ON student_learning_journal(student_id,entry_date);`);
  const router = express.Router();
  const fields = ['activities', 'progress', 'difficulties', 'strategies', 'reflection'];
  const evidenceRows = (row) => {
    const ids = JSON.parse(row.evidence_ids || '[]');
    return ids.map(id => db.prepare('SELECT * FROM evaluacion_evidencias WHERE id=? AND student_id=? AND session_id=?').get(id,row.student_id,row.session_id)).filter(Boolean).map(mapEvidence);
  };
  const map = row => {
    const session = db.prepare('SELECT * FROM sesiones WHERE id_sesion=?').get(row.session_id);
    let data = {}; try { data = JSON.parse(session?.session_data || '{}'); } catch {}
    const evidences=evidenceRows(row);
    return { id:row.id, sessionId:row.session_id, date:row.entry_date, ...JSON.parse(row.content_json), evidenceIds:evidences.map(evidence=>String(evidence.id)), evidences, revision:row.revision, updatedAt:row.updated_at,
      sessionTitle:data.title || 'Sesión de aprendizaje', unitNumber:session?.unit_number || '', sessionNumber:session?.session_number || '', areaId:session?.area_id || '', year:session?.year || '' };
  };
  router.get('/student-portal/journal', requireStudentAuth, (req,res) => {
    try { return res.json({success:true,data:db.prepare('SELECT * FROM student_learning_journal WHERE student_id=? ORDER BY entry_date DESC,updated_at DESC').all(String(req.studentPortal.studentId)).map(map)}); }
    catch { return res.status(500).json({success:false,message:'No se pudo cargar la bitácora.'}); }
  });
  router.put('/student-portal/journal/:sessionId', requireStudentAuth, (req,res) => {
    try {
      const studentId=String(req.studentPortal.studentId);
      const student=db.prepare("SELECT * FROM db_estudiantes WHERE id=? AND estado='A'").get(studentId);
      const session=student && sessionForStudent(req.params.sessionId,student);
      if(!session) return res.status(403).json({success:false,message:'Esta sesión no pertenece a tu grado y sección.'});
      const body=req.body || {}, content={};
      for(const field of fields){if(typeof body[field] !== 'string' || body[field].length>6000)return res.status(400).json({success:false,message:'Revisa los textos: máximo 6000 caracteres por apartado.'});content[field]=body[field].trim();}
      if(!fields.some(field=>content[field]))return res.status(400).json({success:false,message:'Escribe al menos un apartado de tu bitácora.'});
      const date=String(body.date || '');
      const parsedDate=new Date(`${date}T12:00:00Z`);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10)!==date)return res.status(400).json({success:false,message:'Selecciona una fecha válida.'});
      if(!Array.isArray(body.evidenceIds) || body.evidenceIds.length>10 || body.evidenceIds.some(id=>!['number','string'].includes(typeof id)))return res.status(400).json({success:false,message:'Selecciona hasta diez evidencias de esta sesión.'});
      const ids=[...new Set(body.evidenceIds.map(String))];
      for(const id of ids) if(!db.prepare('SELECT id FROM evaluacion_evidencias WHERE id=? AND student_id=? AND session_id=?').get(id,studentId,session.id_sesion))return res.status(403).json({success:false,message:'Solo puedes vincular tus evidencias de esta sesión.'});
      const id=`${studentId}::${session.id_sesion}`, now=new Date().toISOString();
      const result=db.transaction(() => {
        const previous=db.prepare('SELECT * FROM student_learning_journal WHERE id=?').get(id);
        if(String(body.revision || '')!==String(previous?.revision || ''))return null;
        db.prepare(`INSERT INTO student_learning_journal(id,student_id,session_id,entry_date,content_json,evidence_ids,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET entry_date=excluded.entry_date,content_json=excluded.content_json,evidence_ids=excluded.evidence_ids,revision=excluded.revision,updated_at=excluded.updated_at`)
          .run(id,studentId,session.id_sesion,date,JSON.stringify(content),JSON.stringify(ids),crypto.randomUUID(),previous?.created_at || now,now);
        return db.prepare('SELECT * FROM student_learning_journal WHERE id=?').get(id);
      })();
      if(!result)return res.status(409).json({success:false,message:'Esta bitácora cambió en otra pestaña o equipo. Tu borrador se conserva; vuelve a cargar la versión guardada antes de editar.'});
      return res.json({success:true,data:map(result)});
    } catch { return res.status(500).json({success:false,message:'No se pudo guardar la bitácora.'}); }
  });
  return router;
}
