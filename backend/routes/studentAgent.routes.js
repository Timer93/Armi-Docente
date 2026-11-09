import { Router } from 'express';
export function createStudentAgentRouter(service, {now=Date.now,studentPort=3001}={}) {
  const router=Router(), attempts=new Map();
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  if(!service){router.use((_req,res)=>res.status(503).json({success:false,message:'El agente no está disponible.'}));return router;}
  const failure=(res,e)=>res.status(e.status||500).json({success:false,code:e.code,message:e.status?e.message:'No se pudo atender al agente.'});
  const token=req=>String(req.headers.authorization||'').replace(/^Bearer /i,'');
  router.get('/identity',(req,res)=>{try{res.json({success:true,data:service.identity.describe(req.query.nonce,studentPort)});}catch(e){failure(res,e);}});
  router.post('/auto-enroll',(req,res)=>{try{res.json({success:true,data:service.autoRequest(req.body)});}catch(e){failure(res,e);}});
  router.post('/session',(req,res)=>{try{res.json({success:true,data:service.session(token(req),req.body)});}catch(e){failure(res,e);}});
  router.post('/session/heartbeat',(req,res)=>{try{res.json({success:true,data:service.sessionHeartbeat(token(req))});}catch(e){failure(res,e);}});
  router.post('/pair',(req,res)=>{
    const ip=String(req.socket.remoteAddress||'').replace(/^::ffff:/,''),source=['127.0.0.1','::1'].includes(ip)?String(req.headers['cf-connecting-ip']||ip):ip;
    for(const [key,value]of attempts)if(value.until<=now())attempts.delete(key);
    const entry=attempts.get(source)||{count:0,until:now()+300000};
    if(entry.count>=20||(!attempts.has(source)&&attempts.size>=5000))return res.status(429).json({success:false,message:'Espera cinco minutos antes de volver a intentar.'});
    try{res.json({success:true,data:service.pair(req.body)});}catch(e){entry.count++;attempts.set(source,entry);failure(res,e);}
  });
  router.get('/policy',(req,res)=>{try{res.json({success:true,data:service.policy(token(req))});}catch(e){failure(res,e);}});
  router.post('/heartbeat',(req,res)=>{try{res.json({success:true,data:service.heartbeat(token(req),req.body)});}catch(e){failure(res,e);}});
  router.post('/uninstall',(req,res)=>{try{res.json({success:true,data:service.uninstall(token(req))});}catch(e){failure(res,e);}});
  router.get('/jobs',(req,res)=>{try{res.json({success:true,data:service.jobs(token(req))});}catch(e){failure(res,e);}});
  router.post('/jobs/:id/result',(req,res)=>{try{res.json({success:true,data:service.complete(token(req),req.params.id,req.body)});}catch(e){failure(res,e);}});
  router.get('/jobs/:id/file',(req,res)=>{try{const file=service.fileFor(token(req),req.params.id);res.download(file.path,file.name,e=>{if(e&&!res.headersSent)failure(res,e);});}catch(e){failure(res,e);}});
  return router;
}
