// A fixed batching window, not a periodic poll and not a timer per keystroke.
export function createAutomaticWorkSync({owner,request,status,busy,error,setTimer=setTimeout,clearTimer=clearTimeout,delay=30000}:any){
 const teacher=owner();let active=true,reading=false,sending=false,paused=false,timer:any;
 const current=()=>active&&owner()===teacher;
 const schedule=()=>{if(current()&&!paused&&!timer&&!sending)timer=setTimer(()=>{timer=undefined;void flush();},delay);};
 const read=async()=>{const value=await request('/api/drive/sync/status');if(current())status(value);return value;};
 const flush=async()=>{
  if(!current()||sending||paused)return;sending=true;busy(true);
  try{
   const before=await read();if(!current()||!before.ready||!before.connected||!before.authorized||!before.pending)return;
   const result=await request('/api/drive/sync','POST',{});if(!current())return;
   const value={...before,...result};status(value);error('');sending=false;if(value.pending)schedule();
  }catch(failure){if(current()){paused=true;error((failure as Error).message);}}
  finally{sending=false;if(current())busy(false);}
 };
 const check=async()=>{if(!current()||reading||sending)return;reading=true;try{const value=await read();if(current()&&value.ready&&value.connected&&value.authorized&&value.pending)schedule();}catch(failure){if(current())error((failure as Error).message);}finally{reading=false;}};
 return {check,committed:(teacherId:string)=>{if(teacherId===teacher&&current()){status((previous:any)=>previous?{...previous,pending:Math.max(1,previous.pending)}:previous);schedule();}},retry:()=>{paused=false;error('');void flush();},stop:()=>{active=false;clearTimer(timer);}};
}
