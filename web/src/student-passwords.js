import {AuthError} from './apps-script-auth.js';
const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
const bytes=value=>Uint8Array.from(value.match(/../g)||[],x=>parseInt(x,16));
async function derive(password,salt){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:100000,salt},key,256));
}
export async function hashStudentPassword(password){
 const salt=crypto.getRandomValues(new Uint8Array(16));
 return `pbkdf2-sha256$100000$${hex(salt)}$${hex(await derive(password,salt))}`;
}
export async function verifyStudentPassword(password,stored){
 const match=/^pbkdf2-sha256\$100000\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(stored||'');
 if(!match)return false;
 const actual=await derive(password,bytes(match[1])),expected=bytes(match[2]);
 let difference=0;for(let i=0;i<actual.length;i++)difference|=actual[i]^expected[i];
 return difference===0;
}
export async function passwordsReady(db){
 return (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('student_passwords','student_password_sessions')").all()).results.length===2;
}
export function passwordSetupError(){throw new AuthError('Falta activar 0011_student_passwords.sql en D1 para el acceso con contraseña.',503);}
export async function checkStudentPassword(db,teacherId,studentId,dni,password){
 const credentials=await db.prepare('SELECT password_hash,revision FROM student_passwords WHERE teacher_id=? AND student_id=?').bind(teacherId,studentId).first();
 const accepted=credentials?await verifyStudentPassword(password,credentials.password_hash):password===dni;
 if(!accepted)throw new AuthError('Revisa tu DNI y contraseña, o consulta con tu docente si el acceso está habilitado.',401);
 return {revision:credentials?.revision||0,mustChange:!credentials};
}
