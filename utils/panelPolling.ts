// A panel owns its polling: one request at a time, no work in a hidden window,
// and an abort signal for work still pending when the panel is left.
export function startPanelPolling(work:(signal:AbortSignal)=>void|Promise<void>,intervalMs:number,environment:{
  visible:()=>boolean; subscribe:(wake:()=>void)=>()=>void;
  schedule:(work:()=>void,delay:number)=>any; cancel:(timer:any)=>void;
}){
  let active=true,running=false,again=false,timer:any,controller:AbortController|null=null;
  const pause=()=>{if(timer!==undefined)environment.cancel(timer);timer=undefined;controller?.abort();};
  const run=async()=>{
    if(!active||!environment.visible())return;
    if(running){again=true;return;}
    running=true;const request=new AbortController();controller=request;
    try{await work(request.signal);}catch(error){if(!request.signal.aborted)console.warn('No se pudo actualizar el panel',error);}
    finally{running=false;controller=null;if(active&&environment.visible()){const delay=again?0:intervalMs;again=false;timer=environment.schedule(()=>{timer=undefined;void run();},delay);}}
  };
  const unsubscribe=environment.subscribe(()=>{pause();if(environment.visible())void run();});
  void run();
  return()=>{active=false;pause();unsubscribe();};
}

export function startVisiblePanelPolling(work:(signal:AbortSignal)=>void|Promise<void>,intervalMs:number,events:string[]=[]){
  return startPanelPolling(work,intervalMs,{
    visible:()=>document.visibilityState!=='hidden',
    subscribe:wake=>{
      document.addEventListener('visibilitychange',wake);
      const visibleWake=()=>{if(document.visibilityState!=='hidden')wake();};
      window.addEventListener('focus',visibleWake);
      events.forEach(event=>window.addEventListener(event,visibleWake));
      return()=>{document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',visibleWake);events.forEach(event=>window.removeEventListener(event,visibleWake));};
    },
    schedule:(callback,delay)=>window.setTimeout(callback,delay),cancel:timer=>window.clearTimeout(timer),
  });
}
