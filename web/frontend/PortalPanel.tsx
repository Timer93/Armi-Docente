import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {academicApi,readAcademic} from './academic-client';

export function PortalPanel({inline=false}:{inline?:boolean}) {
 const [open,setOpen]=useState(false),[state,setState]=useState<any>(null),[students,setStudents]=useState<any[]>([]),[lessons,setLessons]=useState<any[]>([]),[student,setStudent]=useState(''),[lesson,setLesson]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[inbox,setInbox]=useState<any[]>([]);
 const load=async(details=true)=>{
  const value=await academicApi('/api/portal');setState(value);
  if(details&&value.ready){
   const [studentRows,lessonRows]=await Promise.all([readAcademic('students'),readAcademic('sessions')]);
   setStudents(studentRows.map(row=>({id:row.id,...row.value})));
   setLessons(lessonRows.map(row=>({id:row.id,...row.value})));
  }
  return value;
 };
 const action=async(operation:()=>Promise<unknown>)=>{setBusy(true);setMessage('');try{await operation();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
 useEffect(()=>{
  const changed=(event:Event)=>setState((event as CustomEvent).detail);
  window.addEventListener('armi-portal-state',changed);
  if(inline)void action(()=>load(false));
  return()=>window.removeEventListener('armi-portal-state',changed);
 },[inline]);
 const manage=()=>{setOpen(true);void action(()=>load());};
 const toggle=()=>void action(async()=>{
  await academicApi('/api/portal','PUT',{open:!state.open,revision:state.revision});
  const confirmed=await load(false);
  window.dispatchEvent(new CustomEvent('armi-portal-state',{detail:confirmed}));
 });
 const switchButton=(label='Acceso de estudiantes')=><button type="button" role="switch" aria-label={label} aria-checked={Boolean(state.open)} disabled={busy} className={`portal-switch ${state.open?'is-open':''}`} onClick={toggle}><span aria-hidden="true" className="portal-switch-track"><span /></span>{state.open?'Abierto':'Cerrado'}</button>;
 const selected=students.find(row=>String(row.id)===student),selectedDni=String(selected?.dni||'').trim();
 const dniMatches=students.filter(row=>String(row.dni||'').trim()===selectedDni&&['a','activo','active'].includes(String(row.estado||'A').trim().toLowerCase()));
 const validDni=/^\d{8}$/.test(selectedDni)&&dniMatches.length===1;
 return <>
  {inline?<section data-armi-web-editor="portal" className="portal-bank-access" aria-labelledby="portal-bank-heading">
   <div className="portal-bank-heading"><div><p className="portal-bank-kicker">Banco de Evidencias · Web</p><h2 id="portal-bank-heading">Acceso de estudiantes</h2></div>{state?.ready&&switchButton()}</div>
   <p>Abre o cierra el portal de tus estudiantes. La web funciona en Cloudflare y no necesita un túnel ni que tu computadora permanezca encendida.</p>
   {state?.ready?<>
    <p><strong>{state.open?'El portal está abierto.':'El portal está cerrado.'}</strong> Al cerrarlo se invalidan las sesiones abiertas de tus estudiantes.</p>
    {state.url&&<p><a href={state.url} target="_blank" rel="noreferrer">{state.url}</a></p>}
    <button type="button" disabled={busy} onClick={manage}>Gestionar enlace, estudiantes y sesiones</button>
    {state.registryMessage&&<p role="status">{state.registryMessage}</p>}
   </>:<p>{state?'El administrador debe activar el portal en la base de datos.':'Cargando estado del portal…'}</p>}
   <p className="portal-files-pending"><strong>Archivos pendientes de conectar.</strong> Por ahora este portal permite consultar sesiones publicadas y enviar respuestas de texto. Las evidencias de archivos y su sincronización con Drive todavía no están habilitadas.</p>
   {message&&<p role="alert">{message}</p>}
   {!state&&message&&<button type="button" disabled={busy} onClick={()=>void action(()=>load(false))}>Reintentar consulta</button>}
  </section>:<button type="button" onClick={manage}>Acceso de estudiantes</button>}
  {open&&createPortal(<div className="web-ai-overlay"><section className="web-ai-panel" role="dialog" aria-modal="true" aria-labelledby="portal-heading">
   <h2 id="portal-heading">Acceso de estudiantes</h2>
   <p>El estudiante entra con su DNI y contraseña. En el primer ingreso usa su DNI como contraseña y debe crear una personal. Este enlace identifica a su docente.</p>
   {state?.ready?<>
    {switchButton('Estado del portal')}
    {state.url&&<p><a href={state.url} target="_blank" rel="noreferrer">{state.url}</a><br/><button onClick={()=>void navigator.clipboard.writeText(state.url)}>Copiar enlace</button></p>}
    {state.registryMessage&&<p role="status">{state.registryMessage}</p>}
    {state.passwordReady===false&&<p role="alert">Falta activar 0011_student_passwords.sql en D1 para el acceso con contraseña.</p>}
    <p>Verifica que cada estudiante tenga un DNI de ocho dígitos, sin duplicados activos dentro de tu registro.</p>
    <label>Estudiante<select disabled={busy} value={student} onChange={e=>setStudent(e.target.value)}><option value="">Seleccionar…</option>{students.map(row=><option key={row.id} value={String(row.id)}>{row.name} · {String(row.dni||'').trim()||'Sin DNI'} · {row.grade} {row.section}</option>)}</select></label>
    {student&&!validDni&&<p role="status">{!/^\d{8}$/.test(selectedDni)?'Completa el DNI del estudiante en Estudiantes.':'Este DNI no corresponde a un único estudiante activo. Revisa tu registro de Estudiantes.'}</p>}
    <button disabled={busy||!student||!state.url||!validDni} onClick={()=>void action(async()=>{await academicApi('/api/portal/access','POST',{studentId:String(student),enabled:true});setMessage('Acceso por DNI habilitado.');})}>Habilitar acceso</button>
    <button disabled={busy||!student||!state.url} onClick={()=>void action(async()=>{await academicApi('/api/portal/access','DELETE',{studentId:String(student)});setMessage('Acceso individual bloqueado.');})}>Bloquear acceso</button>
    <label>Sesión para publicar<select value={lesson} disabled={busy} onChange={e=>setLesson(e.target.value)}><option value="">Seleccionar…</option>{lessons.map(row=><option key={row.id} value={row.id}>{state.published.includes(row.id)?'✓ ':''}{row.title||'Sin título'} · {row.grade} {row.section}</option>)}</select></label>
    <button disabled={busy||!lesson||!state.url} onClick={()=>void action(async()=>{await academicApi('/api/portal/publications','PUT',{sessionId:lesson,published:!state.published.includes(lesson)});await load(false);})}>{state.published.includes(lesson)?'Retirar publicación':'Publicar sesión'}</button>
    <p>Solo los estudiantes del grado y sección de la sesión podrán verla. Cerrar el portal revoca las sesiones abiertas; reabrir requiere iniciar sesión otra vez.</p>
    <button disabled={busy} onClick={()=>void action(async()=>setInbox((await academicApi('/api/portal/inbox')).submissions))}>Consultar entregas recientes</button>
    {inbox.map(item=><article key={item.id} className="portal-submission"><strong>{students.find(row=>String(row.id)===item.student_id)?.name||'Estudiante'}</strong><p>{item.text}</p><small>{new Date(item.created_at).toLocaleString()}</small></article>)}
   </>:<p>{state?'Falta que el administrador active el portal en la base de datos.':'Cargando portal…'}</p>}
   {message&&<p role="status">{message}</p>}
   <footer><button disabled={busy} onClick={()=>setOpen(false)}>Cerrar panel</button></footer>
  </section></div>,document.body)}
 </>;
}
