export const legacyPortal=value=>/^[a-f0-9]{32}$/.test(value||'');
export const validPortal=value=>typeof value==='string'&&value.length<=130&&(legacyPortal(value)||/^d[1-9]\d{0,8}-profe-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value));
export function registryNumber(value) {
 const raw=typeof value==='number'?String(value):typeof value==='string'?value:'';
 return /^[1-9]\d{0,8}$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):null;
}
export function portalSlug(number,username) {
 const name=String(username).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90).replace(/-+$/,'')||'usuario';
 return `d${number}-profe-${name}`;
}
export async function registryReady(db) {return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teacher_portal_registry'").first());}
export async function registerTeacherPortal(db,teacherId,number,username,now) {
 if(!registryNumber(number)||!await registryReady(db))return;
 // An existing link is immutable: sorting Sheets or changing a display name
 // cannot redirect another account's portal or silently replace shared links.
 if(await db.prepare('SELECT teacher_id FROM teacher_portal_registry WHERE teacher_id=?').bind(teacherId).first())return;
 await db.prepare('INSERT INTO teacher_portal_registry(teacher_id,registry_number,public_slug,assigned_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(teacherId,number,portalSlug(number,username),now).run();
}
export async function portalRegistryInfo(db,teacher) {
 const ready=await registryReady(db);
 const row=ready?await db.prepare('SELECT registry_number,public_slug FROM teacher_portal_registry WHERE teacher_id=?').bind(teacher.id).first():null;
 const number=registryNumber(JSON.parse(teacher.membership_json||'{}').teacherRegistryNumber);
 let message='';
 if(!ready)message='Falta activar los enlaces personalizados: aplica 0010_teacher_portal_registry.sql.';
 else if(!row&&!number)message='El enlace personalizado necesita el número del registro de Google Sheets. Actualiza Apps Script y vuelve a iniciar sesión.';
 else if(!row)message='El número del docente está pendiente de asignar o pertenece a otra cuenta. Revisa ARMI_DOCENTE_ID en Google Sheets y vuelve a iniciar sesión.';
 return {ready,number:row?.registry_number||null,slug:row?.public_slug||'',message};
}
export async function resolvePortal(db,identifier) {
 if(!validPortal(identifier))return null;
 if(legacyPortal(identifier))return db.prepare('SELECT * FROM student_portals WHERE public_id=?').bind(identifier).first();
 if(!await registryReady(db))return null;
 return db.prepare('SELECT p.* FROM teacher_portal_registry r JOIN student_portals p ON p.teacher_id=r.teacher_id WHERE r.public_slug=?').bind(identifier).first();
}
export async function matchesPortal(db,teacherId,publicId,identifier) {
 if(legacyPortal(identifier))return identifier===publicId;
 if(!validPortal(identifier)||!await registryReady(db))return false;
 return Boolean(await db.prepare('SELECT 1 FROM teacher_portal_registry WHERE teacher_id=? AND public_slug=?').bind(teacherId,identifier).first());
}
