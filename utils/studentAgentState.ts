import type {StudentAgentDevice} from '../services/accessControl';
export function agentOnline(device:StudentAgentDevice|undefined,now=Date.now()):boolean {
  if(!device?.paired||!device.online)return false;
  return !device.lastSeenAt||now-Date.parse(device.lastSeenAt)<45000;
}
export function agentReady(device:StudentAgentDevice|undefined,now=Date.now()):boolean {
  return agentOnline(device,now)&&!device?.retired&&device?.canSendCommands!==false;
}
export function agentRetired(device:StudentAgentDevice|undefined):boolean {
  return device?.retired===true||device?.state==='uninstalled'||device?.state==='revoked';
}
