import React,{useEffect,useRef} from 'react';
import {desktopLoginHtml} from 'armi-web-student-login';

// Keep the native form mounted while React updates request/error state.
const LoginMarkup=React.memo(React.forwardRef<HTMLDivElement>(function LoginMarkup(_props,ref){
 return <div ref={ref} dangerouslySetInnerHTML={{__html:desktopLoginHtml}}/>;
}));

export function DesktopStudentLogin({busy,message,onLogin}:{busy:boolean;message:string;onLogin:(dni:string)=>void}) {
 const host=useRef<HTMLDivElement>(null);
 const refresh=()=>{
  const input=host.current?.querySelector<HTMLInputElement>('#student-dni');
  const button=host.current?.querySelector<HTMLButtonElement>('#loginButton');
  if(input)input.disabled=busy;
  if(button){button.disabled=busy||!/^\d{8}$/.test(input?.value||'');button.textContent=busy?'Ingresando…':'Ingresar';}
 };
 useEffect(()=>{
  refresh();const status=host.current?.querySelector<HTMLElement>('#loginMessage');
  if(status){status.textContent=message;status.style.display=message?'block':'none';}
 },[busy,message]);
 return <div onInput={event=>{
  const input=event.target as HTMLInputElement;
  if(input.id==='student-dni'){input.value=input.value.replace(/\D/g,'').slice(0,8);refresh();}
 }} onSubmit={event=>{
  event.preventDefault();const input=host.current?.querySelector<HTMLInputElement>('#student-dni');
  if(!busy&&input&&/^\d{8}$/.test(input.value))onLogin(input.value);
 }}><LoginMarkup ref={host}/></div>;
}
