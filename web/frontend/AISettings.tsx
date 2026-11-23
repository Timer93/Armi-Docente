import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {aiApi,getAiProfile,aiHandle} from './ai-client';
import {clearAiModels} from './ai-models';
export function WebAISettings(props:any) {
 const [data,setData]=useState<any>(null),[provider,setProvider]=useState('gemini'),[key,setKey]=useState(''),[model,setModel]=useState(''),[models,setModels]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{void getAiProfile(true).then(value=>{setData(value);setProvider(value.preferences?.provider||'gemini');setModel(value.preferences?.[(value.preferences?.provider||'gemini')+'Model']||'');}).catch(e=>setError(e.message));},[]);
 const loadModels=async()=>{const result=await aiApi('/api/ai/models?provider='+provider);setModels(result.models);return result.models;};
 const save=async()=>{
  setBusy(true);setError('');
  try {
   if(key.trim()){await aiApi('/api/ai/credentials','PUT',{provider,key:key.trim()});setKey('');clearAiModels();}
   const choices=await loadModels();const selected=choices.some((row:any)=>row.id===model)?model:choices.find((row:any)=>/flash|mini/i.test(row.id))?.id||choices[0]?.id;
   if(!selected)throw new Error('No hay modelos de texto disponibles para esta clave.');
   const prefs={...('initialAiPedagogicalRoute' in props?{aiPedagogicalRoute:props.initialAiPedagogicalRoute||'',institutionalProblems:props.initialInstitutionalProblems||'',unitPedagogicalFocus:props.initialUnitPedagogicalFocus||''}:{}),...data.preferences,provider,[provider+'Model']:selected};
   const result=await aiApi('/api/ai/preferences','PUT',prefs);setData(result);setModel(selected);await getAiProfile(true);
   const config={provider,geminiKey:result.providers?.gemini?.configured?aiHandle('gemini'):'',openaiKey:result.providers?.openai?.configured?aiHandle('openai'):'',geminiModel:prefs.geminiModel||'',openaiModel:prefs.openaiModel||'',aiPedagogicalRoute:prefs.aiPedagogicalRoute||'',institutionalProblems:prefs.institutionalProblems||'',unitPedagogicalFocus:prefs.unitPedagogicalFocus||''};
   if('initialKey' in props)await props.onSave(aiHandle(provider),selected);else await props.onSave(config);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 return createPortal(<div className="web-ai-overlay"><section className="web-ai-panel" role="dialog" aria-modal="true" aria-labelledby="web-ai-heading"><h2 id="web-ai-heading">Configurar mi IA</h2><p>Usa tu propia cuenta. Las generaciones consumen la cuota o saldo de tu proveedor. La clave se guarda cifrada y no se publica.</p><p>ARMI Web permite hasta 100 solicitudes por día y una generación a la vez por cuenta. La cuota de tu proveedor también se aplica.</p>{data&&!data.ready&&<p role="alert">El administrador todavía debe activar el servicio seguro de IA.</p>}<label>Proveedor<select value={provider} disabled={busy} onChange={e=>{setProvider(e.target.value);setModel(data?.preferences?.[e.target.value+'Model']||'');setModels([]);setKey('');}}><option value="gemini">Gemini</option><option value="openai">OpenAI</option></select></label><label>{data?.providers?.[provider]?.configured?'Cambiar clave guardada (opcional)':'Mi clave de API'}<input type="password" autoComplete="off" value={key} disabled={busy||!data?.ready} onChange={e=>setKey(e.target.value)} placeholder="Pega aquí tu clave" /></label><label>Modelo<select value={model} disabled={busy} onChange={e=>setModel(e.target.value)}><option value={model}>{model||'Se elegirá un modelo disponible al guardar'}</option>{models.filter(row=>row.id!==model).map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select></label>{data?.providers?.[provider]?.configured&&<button disabled={busy} onClick={()=>{setBusy(true);void loadModels().catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Consultar mis modelos</button>}{error&&<p role="alert">{error}</p>}<footer><button disabled={busy} onClick={props.onClose}>Cancelar</button><button disabled={busy||!data?.ready||(!key.trim()&&!data?.providers?.[provider]?.configured)} onClick={()=>void save()}>{busy?'Conectando…':'Guardar configuración'}</button></footer></section></div>,document.body);
}
