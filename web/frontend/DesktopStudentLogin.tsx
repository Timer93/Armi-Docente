import React,{useEffect,useRef} from 'react';
import {desktopLoginHtml} from 'armi-web-student-login';

// Keep the native form mounted while React updates request/error state.
const LoginMarkup=React.memo(React.forwardRef<HTMLDivElement>(function LoginMarkup(_props,ref){
 return <div ref={ref} dangerouslySetInnerHTML={{__html:desktopLoginHtml}}/>;
}));

export function DesktopStudentLogin({busy,message,changePassword,onLogin,onChangePassword}:{busy:boolean;message:string;changePassword:boolean;onLogin:(dni:string,password:string)=>void;onChangePassword:(password:string,confirmation:string)=>void}) {
 const host=useRef<HTMLDivElement>(null);
 const refresh=()=>{
  const input=host.current?.querySelector<HTMLInputElement>('#student-dni');
  const button=host.current?.querySelector<HTMLButtonElement>('#loginButton');
  const password=host.current?.querySelector<HTMLInputElement>('#studentPassword');
  host.current?.querySelectorAll<HTMLInputElement>('input').forEach(field=>{field.disabled=busy;});
  host.current?.querySelectorAll<HTMLButtonElement>('#passwordChangeForm button').forEach(button=>{button.disabled=busy;});
  if(button){button.disabled=busy||!/^\d{8}$/.test(input?.value||'')||!password?.value;button.textContent=busy?'Ingresando…':'Ingresar';}
 };
 useEffect(()=>{
  refresh();const status=host.current?.querySelector<HTMLElement>('#loginMessage');
  if(status){status.textContent=message;status.style.display=message?'block':'none';}
  host.current?.querySelector('#loginForm')?.classList.toggle('hidden',changePassword);
  host.current?.querySelector('#passwordChangeForm')?.classList.toggle('hidden',!changePassword);
  if(changePassword){const old=host.current?.querySelector<HTMLInputElement>('#studentPassword');if(old)old.value='';}
 },[busy,message,changePassword]);
 return <div onInput={event=>{
  const input=event.target as HTMLInputElement;
  if(input.id==='student-dni')input.value=input.value.replace(/\D/g,'').slice(0,8);
  refresh();
 }} onSubmit={event=>{
  event.preventDefault();const input=host.current?.querySelector<HTMLInputElement>('#student-dni');
  if(busy)return;
  if((event.target as HTMLFormElement).id==='passwordChangeForm'){
   const password=host.current?.querySelector<HTMLInputElement>('#newStudentPassword')?.value||'';
   const confirmation=host.current?.querySelector<HTMLInputElement>('#confirmStudentPassword')?.value||'';
   onChangePassword(password,confirmation);
  }else{
   const password=host.current?.querySelector<HTMLInputElement>('#studentPassword')?.value||'';
   if(input&&/^\d{8}$/.test(input.value)&&password)onLogin(input.value,password);
  }
 }}><LoginMarkup ref={host}/></div>;
}
