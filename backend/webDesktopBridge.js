import {receiveWebWork} from './webWorkReceiver.js';
import {publishWebTemplates} from './webTemplateCatalog.js';
const passes=new Map();
export async function runWebBridge(options){
 if(!options.mirrorPath||!options.syncUserKey)return {applied:0,conflicts:0};
 const key=options.mirrorPath+'\0'+options.syncUserKey,previous=passes.get(key);
 if(previous?.running||previous&&Date.now()-previous.at<30000)return {applied:0,conflicts:0};
 const state={at:Date.now(),running:true};passes.set(key,state);
 let received={applied:0,conflicts:0};
 try{
  received=await receiveWebWork(options);
  await publishWebTemplates(options);
 }catch(error){console.warn('[web-sync] No se completó el intercambio; se conserva el trabajo:',error.message);}
 finally{state.running=false;}
 return received;
}
