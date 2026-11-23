import {createApiClient} from '../public/api-client.js';
import {getWebIdentity} from './runtime.js';
import {displayValue} from './academic-client';
const client=createApiClient({timeoutMs:120_000,onUnauthorized:()=>window.location.reload()});
export const aiApi=(path:string,method='GET',body?:unknown)=>client.request(path,method,body);
let profile:Promise<any>|undefined,owner='';
export function getAiProfile(refresh=false) {
 const id=getWebIdentity()?.user.id||'';
 if(refresh||id!==owner){profile=undefined;owner=id;}
 if(!profile){profile=aiApi('/api/ai/profile');void profile.catch(()=>{profile=undefined;});}
 return profile;
}
export const aiHandle=(provider:string)=>`armi-web-managed-${provider}`;
function safeJson(text:string) {try{return JSON.stringify(displayValue(JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))));}catch{throw new Error('La IA no devolvió un JSON válido. Revisa el modelo y vuelve a intentar.');}}
export async function aiGeneralFields() {
 const data=await getAiProfile().catch(()=>({providers:{},preferences:{}}));const p=data.preferences||{};
 return {gemini_api_key:data.providers?.gemini?.configured?aiHandle('gemini'):'',openai_api_key:data.providers?.openai?.configured?aiHandle('openai'):'',ai_provider:p.provider||'gemini',gemini_model:p.geminiModel||data.providers?.gemini?.model||'',openai_model:p.openaiModel||data.providers?.openai?.model||'',...(p.aiPedagogicalRoute!==undefined?{ai_pedagogical_route:p.aiPedagogicalRoute}:{}),...(p.institutionalProblems!==undefined?{ai_institutional_problems:p.institutionalProblems}:{}),...(p.unitPedagogicalFocus!==undefined?{ai_unit_pedagogical_focus:p.unitPedagogicalFocus}:{})};
}
export function createGeminiClient(handle:string) {return {provider:handle.includes('openai')?'openai':'gemini'};}
export async function generateGeminiContent(ai:any,request:any,model:string,options:any={}) {
 const prompt=typeof request.contents==='string'?request.contents:(request.contents||[]).flatMap((content:any)=>content.parts||[]).map((part:any)=>part.text||'').join('\n');
 const data=await aiApi('/api/ai/generate','POST',{provider:ai.provider,model,prompt,config:request.config||{}});
 options.onModelSelected?.(model,false);
 return {text:safeJson(data.text),usageMetadata:{totalTokenCount:data.usage.totalTokens}};
}
export async function* generateGeminiContentStream(ai:any,request:any,model:string,options:any={}) {yield await generateGeminiContent(ai,request,model,options);}
export const getGeminiPreferredModel=()=> 'gemini-2.5-flash';
export async function webOpenAIResponse(_url:string,options:any) {
 const body=JSON.parse(options.body);const data=await aiApi('/api/ai/generate','POST',{provider:'openai',model:body.model,prompt:body.input});
 return Response.json({output_text:safeJson(data.text),usage:{total_tokens:data.usage.totalTokens}});
}
