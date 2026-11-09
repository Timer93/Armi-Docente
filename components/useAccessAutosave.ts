import {useEffect,useRef,useState} from 'react';
import {requestAccessControl,type AccessConfig,type AccessSnapshot} from '../services/accessControl';
import {mergeAccessConfig} from '../services/accessAutosave';

export function useAccessAutosave(){
  const [snapshot,setSnapshot]=useState<AccessSnapshot|null>(null),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
  const latest=useRef<AccessSnapshot|null>(null),base=useRef<AccessSnapshot|null>(null),sequence=useRef(0),persisted=useRef(0),inflight=useRef<Promise<void>|null>(null),changedAt=useRef(0);
  const accept=(value:AccessSnapshot,startedAt=Date.now())=>{if(inflight.current||sequence.current!==persisted.current||startedAt<changedAt.current)return;latest.current=base.current=value;setSnapshot(value);};
  const flush=():Promise<void>=>{
    if(inflight.current)return inflight.current;
    if(!latest.current||sequence.current===persisted.current)return Promise.resolve();
    setSaving(true);setSaveError('');
    const work=(async()=>{
      while(latest.current&&sequence.current!==persisted.current){
        const sent=latest.current,revision=sequence.current;let saved:AccessSnapshot;
        try{saved=await requestAccessControl(sent);}catch(error){
          if((error as {status?:number}).status!==409||!base.current)throw error;
          const remote=await requestAccessControl();saved=await requestAccessControl({...remote,config:mergeAccessConfig(base.current.config,sent.config,remote.config)});
        }
        const current=latest.current;
        latest.current=sequence.current===revision?saved:{...saved,config:mergeAccessConfig(sent.config,current.config,saved.config)};
        base.current=saved;persisted.current=revision;changedAt.current=Date.now();setSnapshot(latest.current);setDirty(sequence.current!==persisted.current);
      }
    })().catch(error=>{setSaveError((error as Error).message);throw error;}).finally(()=>{inflight.current=null;setSaving(false);});
    inflight.current=work;return work;
  };
  const flushRef=useRef(flush);flushRef.current=flush;
  const change=(config:AccessConfig)=>{if(!latest.current)return;sequence.current++;changedAt.current=Date.now();latest.current={...latest.current,config};setSnapshot(latest.current);setDirty(true);setSaveError('');};
  useEffect(()=>{let active=true;const controller=new AbortController(),startedAt=Date.now();requestAccessControl(undefined,controller.signal).then(value=>{if(active)accept(value,startedAt);}).catch(e=>{if(active&&!controller.signal.aborted)setSaveError(e.message);});return()=>{active=false;controller.abort();void flushRef.current().catch(()=>{});};},[]);
  useEffect(()=>{if(!dirty||saving||saveError)return;const timer=window.setTimeout(()=>void flushRef.current().catch(()=>{}),600);return()=>clearTimeout(timer);},[snapshot,dirty,saving,saveError]);
  const reload=async()=>{if(sequence.current!==persisted.current&&!window.confirm('¿Descartar los cambios sin guardar y recargar?'))return;const value=await requestAccessControl();sequence.current++;persisted.current=sequence.current;changedAt.current=Date.now();latest.current=base.current=value;setSnapshot(value);setDirty(false);setSaveError('');};
  return {snapshot,dirty,saving,saveError,change,accept,flush,reload};
}
