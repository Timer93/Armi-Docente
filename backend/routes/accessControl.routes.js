import { Router } from 'express';
import { createAccessControlStore } from '../accessControl.js';
import os from 'node:os';
import multer from 'multer';

export function createAccessControlRouter({ db, teacherPort, extensionService, studentPort, agentService }) {
  const router = Router();
  const store = createAccessControlStore(db);
  router.use((req, res, next) => {
    const address = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    let trustedOrigin = true;
    let trustedHost = false;
    try { trustedHost = ['localhost','127.0.0.1','[::1]'].includes(new URL(`http://${req.headers.host || ''}`).hostname); } catch {}
    if (req.headers.origin) {
      try { trustedOrigin = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(req.headers.origin).hostname); }
      catch { trustedOrigin = false; }
    }
    const trustedProxy = !req.headers['x-forwarded-for'] || String(req.headers['x-forwarded-for']).split(',')
      .every(value => ['127.0.0.1', '::1'].includes(value.trim().replace(/^::ffff:/, '')));
    if (!['127.0.0.1', '::1'].includes(address) || !trustedOrigin || !trustedHost || req.headers['cf-connecting-ip'] || !trustedProxy
      || (teacherPort && req.socket.localPort !== teacherPort)) {
      return res.status(403).json({ success: false, message: 'Abre Control de acceso desde ARMI en la PC del docente.' });
    }
    next();
  });
  router.get('/', (_req, res) => {
    try { res.json({ success: true, data: store.read() }); }
    catch { res.status(500).json({ success: false, message: 'No se pudo leer la configuración guardada. Se conservó sin cambios.' }); }
  });
  router.put('/', (req, res) => {
    try { res.json({ success: true, data: store.save(req.body?.config, req.body?.revision) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'No se pudo guardar el control de acceso.' }); }
  });
  if (extensionService) {
    router.get('/extension', (_req, res) => res.json({ success: true, data: {
      devices: extensionService.status(),
      serverUrls: [...new Set(Object.values(os.networkInterfaces()).flat().filter(row => row && !row.internal && (row.family === 'IPv4' || row.family === 4))
        .map(row => `http://${row.address}:${studentPort || teacherPort}`))],
      downloadUrl: '/extensions/ARMI-Estudiantes.zip',
    } }));
    router.post('/devices/:id/pairing', (req, res) => {
      try { res.json({ success: true, data: extensionService.generatePairing(req.params.id) }); }
      catch (error) { res.status(error.status || 500).json({ success: false, message: error.message }); }
    });
    router.post('/devices/:id/revoke', (req, res) => {
      extensionService.revoke(req.params.id); res.json({ success: true });
    });
  } else {
    router.get('/extension', (_req, res) => res.status(503).json({ success: false, message: 'No se pudo abrir el registro local de extensiones.' }));
  }
  const urls=()=>[...new Set(Object.values(os.networkInterfaces()).flat().filter(row=>row&&!row.internal&&(row.family==='IPv4'||row.family===4)).map(row=>`http://${row.address}:${studentPort||teacherPort}`))];
  const action=fn=>(req,res)=>{try{if(!agentService)return res.status(503).json({success:false,message:'El agente de Windows no está disponible.'});res.json({success:true,data:fn(req)});}catch(e){res.status(e.status||500).json({success:false,message:e.status?e.message:'No se pudo completar la acción del agente.'});}};
  router.get('/agent',action(()=>({devices:agentService.status(),snapshot:store.read(),jobs:agentService.history(),folders:agentService.folders(),requests:agentService.pendingRequests(),serverUrls:urls(),downloadUrl:'/agents/ARMI-Estudiante-Setup.exe'})));
  router.post('/agent/requests',action(req=>agentService.approve(req.body||{})));
  router.post('/agent/enrollment',action(req=>agentService.code({groupId:req.body?.groupId,maxUses:req.body?.maxUses??100})));
  router.post('/devices/:id/agent-pairing',action(req=>agentService.code({deviceId:req.params.id})));
  router.post('/devices/:id/agent-revoke',action(req=>{agentService.revoke(req.params.id);return {revoked:true};}));
  router.post('/agent/jobs',action(req=>agentService.createJobs(req.body||{})));
  router.post('/agent/jobs/:id/cancel',action(req=>{agentService.cancel(req.params.id);return {cancelled:true};}));
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:50*1024*1024,files:1,fields:5}}).single('file');
  router.post('/agent/files',(req,res,next)=>upload(req,res,e=>e?res.status(400).json({success:false,message:'Selecciona un archivo de hasta 50 MB.'}):next()),action(req=>{
    if(!req.file)throw Object.assign(new Error('Selecciona un archivo.'),{status:400});
    let scope;try{scope=JSON.parse(req.body.scope);}catch{throw Object.assign(new Error('Selecciona los equipos de destino.'),{status:400});}
    const file=agentService.upload(req.file.buffer,req.file.originalname);
    const relativePath=req.body.folderPath!==undefined?agentService.deliveryPath(req.body.folderPath,file.name):req.body.relativePath;
    return agentService.createJobs({scope,type:'receive-file',relativePath,fileId:file.id,destination:req.body.destination||'classroom',onlyOnline:req.body.onlyOnline==='true'});
  }));
  return router;
}
