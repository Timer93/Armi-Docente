import {useEffect,useRef} from 'react';
import {startPanelPolling} from '../utils/panelPolling';

export function usePanelPolling(work:(signal:AbortSignal)=>void|Promise<void>,intervalMs:number){
  const latest=useRef(work);latest.current=work;
  useEffect(()=>startPanelPolling(signal=>latest.current(signal),intervalMs,{
    visible:()=>document.visibilityState!=='hidden',
    subscribe:wake=>{document.addEventListener('visibilitychange',wake);return()=>document.removeEventListener('visibilitychange',wake);},
    schedule:(callback,delay)=>window.setTimeout(callback,delay),cancel:timer=>window.clearTimeout(timer),
  }),[intervalMs]);
}
