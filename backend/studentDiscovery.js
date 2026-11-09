import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DISCOVERY_PORT=50321;
export function createStudentIdentity(runtimeFolder) {
  fs.mkdirSync(runtimeFolder,{recursive:true});
  const file=path.join(runtimeFolder,'student-teacher-identity.json');
  let identity;
  if(fs.existsSync(file))identity=JSON.parse(fs.readFileSync(file,'utf8'));
  else {const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
    const jwk=keys.publicKey.export({format:'jwk'});
    identity={serverId:crypto.randomUUID(),privateKey:keys.privateKey.export({format:'pem',type:'pkcs8'}),modulus:Buffer.from(jwk.n,'base64url').toString('base64'),exponent:Buffer.from(jwk.e,'base64url').toString('base64')};
    fs.writeFileSync(file,JSON.stringify(identity),{flag:'wx',mode:0o600});}
  const sign=body=>{const payload=JSON.stringify(body);return {payload,signature:crypto.sign('RSA-SHA256',Buffer.from(payload),identity.privateKey).toString('base64'),modulus:identity.modulus,exponent:identity.exponent};};
  return {approve(body){return sign({...body,purpose:'armi-enrollment-approval',serverId:identity.serverId});},describe(nonce,port){if(!/^[a-f0-9]{32,64}$/.test(nonce||''))throw Object.assign(new Error('Consulta de descubrimiento inválida.'),{status:400});
    const payload=JSON.stringify({protocol:2,nonce,serverId:identity.serverId,teacherName:os.hostname(),port});
    return {payload,signature:crypto.sign('RSA-SHA256',Buffer.from(payload),identity.privateKey).toString('base64'),modulus:identity.modulus,exponent:identity.exponent};}};
}
export function startStudentDiscovery({identity,studentPort,port=DISCOVERY_PORT,host='0.0.0.0'}) {
  const socket=dgram.createSocket('udp4'),limits=new Map();let error=null;
  const ready=new Promise(resolve=>{socket.once('listening',()=>resolve(socket.address().port));socket.once('error',()=>resolve(null));});
  socket.on('error',e=>{error=e.message;console.error('[agent-discovery]',e.message);});
  socket.on('message',(bytes,remote)=>{
    if(bytes.length>256)return;
    const now=Date.now();for(const [ip,row]of limits)if(row.until<now)limits.delete(ip);
    const row=limits.get(remote.address)||{count:0,until:now+1000};if(row.count>=3||limits.size>2000)return;row.count++;limits.set(remote.address,row);
    try {const query=JSON.parse(bytes.toString());if(query.type!=='armi-student-discover')return;
      const result=identity.describe(query.nonce,studentPort);socket.send(Buffer.from(JSON.stringify(result)),remote.port,remote.address);
    }catch{}
  });
  socket.bind(port,host);socket.unref();
  return {ready,close:()=>{try{socket.close();}catch{}},status:()=>({port,error})};
}
