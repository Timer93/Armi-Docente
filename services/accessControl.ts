export interface AccessGroup { id: string; name: string }
export interface AccessPermissions {navigation: boolean; folders: boolean; files: boolean}
export interface AccessDevice { id: string; name: string; groupId: string | null; permissions?: AccessPermissions }
export interface AccessRule {
  id: string; name: string; enabled: boolean; domains: string[];
  scope: 'all' | 'group' | 'devices'; groupId: string | null; deviceIds: string[];
}
export interface AccessConfig { version: 1; groups: AccessGroup[]; devices: AccessDevice[]; rules: AccessRule[] }
export interface AccessSnapshot { config: AccessConfig; revision: string; updatedAt: string | null }
export interface AccessDeviceStatus {
  deviceId: string; paired: boolean; online: boolean; state: 'unpaired' | 'pending' | 'applied' | 'error';
  lastSeenAt?: string | null; blockedCount?: number; expectedCount?: number; extensionVersion?: string | null; error?: string | null;
}
export interface AccessExtensionStatus { devices: AccessDeviceStatus[]; serverUrls: string[]; downloadUrl: string }
export interface StudentAgentDevice {
  deviceId:string; machineName?:string; paired:boolean; online:boolean; canSendCommands?:boolean; retired?:boolean; changedAt?:string; state:string; navigationState?:string; blockedCount:number;
  lastSeenAt?:string; rootPath?:string; version?:string; error?:string; activeUser?:string; capabilities:Partial<AccessPermissions>;
}
export interface StudentAgentJob {id:string; batchId?:string; deviceId:string; type:string; relativePath:string; destination?:string; newRelativePath?:string; state:string; message?:string; createdAt:number}
export interface StudentAgentRequest {id:string;machineName:string;verificationCode?:string;state:string;lastSeenAt:number;online?:boolean;pairingProtocol?:number}
export interface StudentAgentFolder {deviceId:string;sid:string;username:string;destination:string;relativePath:string;updatedAt:number}
export interface StudentAgentStatus {devices:StudentAgentDevice[]; jobs:StudentAgentJob[]; folders?:StudentAgentFolder[]; snapshot?:AccessSnapshot; requests?:StudentAgentRequest[]; serverUrls:string[]; downloadUrl:string}
export async function requestAgent<T>(route:string,body?:object|FormData,signal?:AbortSignal):Promise<T> {
  const multipart=body instanceof FormData;
  const timeout=AbortSignal.timeout(multipart?120000:15000);
  const response=await fetch(`/api/admin/access-control/${route}`,{method:body?'POST':'GET',headers:body&&!multipart?{'Content-Type':'application/json'}:undefined,body:body?(multipart?body:JSON.stringify(body)):undefined,signal:signal?AbortSignal.any([signal,timeout]):timeout});
  const result=await response.json();if(!response.ok||!result.success)throw new Error(result.message||'No se pudo comunicar con el agente.');return result.data;
}
export async function requestExtensionAction<T>(route: string, method = 'GET',signal?:AbortSignal): Promise<T> {
  const timeout=AbortSignal.timeout(12000);
  const response = await fetch(`/api/admin/access-control/${route}`, { method, signal:signal?AbortSignal.any([signal,timeout]):timeout });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.message || 'No se pudo consultar la extensión.');
  return result.data;
}
export async function requestAccessControl(snapshot?: AccessSnapshot,signal?:AbortSignal): Promise<AccessSnapshot> {
  const response = await fetch('/api/admin/access-control', {
    method: snapshot ? 'PUT' : 'GET', headers: snapshot ? { 'Content-Type': 'application/json' } : undefined,
    body: snapshot ? JSON.stringify({ config: snapshot.config, revision: snapshot.revision }) : undefined,
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw Object.assign(new Error(result.message || 'No se pudo acceder a la configuración.'),{status:response.status});
  return result.data;
}
