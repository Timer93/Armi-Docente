import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DesktopStudentLogin} from './DesktopStudentLogin';
import 'armi-web-student-desktop.css';
import './student.css';
function StudentPortal(){
 const [data,setData]=useState<any>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[lesson,setLesson]=useState(''),[text,setText]=useState('');
 const [passwordChange,setPasswordChange]=useState(false);
 const portal=window.location.pathname.split('/')[2]||'';
 const api=async(path:string,body?:unknown)=>{
  const response=await fetch(path+(path.includes('?')?'&':'?')+'portal='+encodeURIComponent(portal),{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok||!result.success){if(response.status===401){setData(null);setPasswordChange(false);setLesson('');setText('');}throw new Error(result.message||'No se pudo conectar.');}
  return result.data;
 };
 const load=async()=>setData(await api('/api/student/data'));
 useEffect(()=>{void api('/api/student/session').then(session=>{if(session.requiresPasswordChange)setPasswordChange(true);else return load();}).catch(()=>{});},[]);
 const perform=async(operation:()=>Promise<unknown>)=>{setBusy(true);setMessage('');try{await operation();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
 return <main className={data&&!passwordChange?'student-workspace':'shell student-login-screen'}>
  {!data||passwordChange?<DesktopStudentLogin busy={busy} message={message} changePassword={passwordChange} onLogin={(dni,password)=>void perform(async()=>{const session=await api('/api/student/login',{portal,dni,password});setLesson('');setText('');if(session.requiresPasswordChange)setPasswordChange(true);else await load();})} onChangePassword={(password,confirmation)=>void perform(async()=>{await api('/api/student/change-password',{password,confirmation});setPasswordChange(false);await load();})}/>:<>
   <header><span className="brand">ARMI</span><h1>Portal de estudiantes</h1></header>
   <section><h2>Hola, {data.student.name}</h2><p>{data.student.grade} · Sección {data.student.section}</p><button disabled={busy} onClick={()=>void perform(load)}>Actualizar</button><button disabled={busy} onClick={()=>{setMessage('');setPasswordChange(true);}}>Cambiar contraseña</button><button disabled={busy} onClick={()=>void perform(async()=>{await api('/api/student/logout',{});setData(null);setLesson('');setText('');})}>Cerrar sesión</button></section>
   {data.lessons.length?data.lessons.map((item:any)=><article key={item.id}><h2>{item.title}</h2><p>{item.date}</p><h3>Propósito</h3><p>{item.purpose}</p><h3>Situación</h3><p>{item.situation}</p><h3>Actividad</h3><p>{item.instructions}</p><button disabled={busy} onClick={()=>setLesson(item.id)}>Responder</button></article>):<section>Tu docente todavía no publicó sesiones para tu grupo.</section>}
   {data.nextCursor&&<button disabled={busy} onClick={()=>void perform(async()=>{const next=await api('/api/student/data?cursor='+encodeURIComponent(data.nextCursor));setData({...next,lessons:[...data.lessons,...next.lessons]});})}>Ver más sesiones</button>}
   {lesson&&<form onSubmit={e=>{e.preventDefault();void perform(async()=>{await api('/api/student/submit',{sessionId:lesson,text});setText('');setLesson('');await load();setMessage('Tu respuesta se guardó correctamente.');});}}><h2>Mi respuesta</h2><textarea value={text} maxLength={8000} required onChange={e=>setText(e.target.value)} rows={8}/><p>Solo texto, hasta 8000 caracteres. Las entregas de archivos aún no están habilitadas.</p><button disabled={busy}>{busy?'Enviando…':'Enviar respuesta'}</button></form>}
   {data.submissions.length>0&&<section><h2>Mis entregas recientes</h2>{data.submissions.map((item:any,index:number)=><article key={index}><p>{item.text}</p><small>{new Date(item.created_at).toLocaleString()}</small></article>)}</section>}
  </>}
  {data&&!passwordChange&&message&&<p role="status" className="message">{message}</p>}
 </main>;
}
createRoot(document.getElementById('student-root')!).render(<StudentPortal/>);
