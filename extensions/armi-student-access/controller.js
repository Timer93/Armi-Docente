import { compilePolicy, normalizeServerUrl, sameRules, blockedTabUrl } from './policy.js';

export function createController(api, fetcher = fetch, now = Date.now) {
  let queue = Promise.resolve();
  const exclusive = task => { const result = queue.then(task, task); queue = result.catch(() => {}); return result; };
  const read = async () => (await api.storage.local.get('armiConnection')).armiConnection || {};
  const save = data => api.storage.local.set({ armiConnection: data });
  const request = async (origin, route, token, body) => {
    const response = await fetcher(`${origin}/api/access-extension/${route}`, {
      method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('ARMI no devolvió una respuesta válida. Comprueba su dirección.'); }
    if (!response.ok || result.success !== true) throw Object.assign(new Error(result.message || 'No se pudo conectar con ARMI.'), { code: result.code, status: response.status });
    return result.data;
  };
  const apply = async (connection, policy) => {
    const expected = compilePolicy(policy, connection.serverUrl);
    if (policy.deviceId !== connection.deviceId) throw new Error('La política pertenece a otro equipo.');
    const previous = await api.declarativeNetRequest.getDynamicRules();
    if (!sameRules(previous, expected)) {
      await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: previous.map(rule => rule.id), addRules: expected });
      // Inspect open URLs locally, never transmit them. Refresh only affected
      // pages so a newly forbidden site cannot remain usable in an existing tab.
      if (api.tabs) {
        const tabs = await api.tabs.query({});
        await Promise.all(tabs.filter(tab => Number.isInteger(tab.id) && blockedTabUrl(tab.pendingUrl || tab.url, policy.domains, connection.serverUrl))
          .map(tab => (tab.pendingUrl ? api.tabs.update(tab.id, { url: tab.pendingUrl }) : api.tabs.reload(tab.id)).catch(() => {})));
      }
    }
    const applied = { ...connection, deviceName: String(policy.deviceName || 'Equipo'), revision: policy.revision, blockedCount: policy.domains.length,
      state: 'applied', lastSyncAt: new Date(now()).toISOString(), error: '' };
    await save(applied);
    if(!connection.native)await request(applied.serverUrl, 'ack', applied.token, { revision: policy.revision, blockedCount: policy.domains.length, extensionVersion: api.runtime.getManifest().version });
    return applied;
  };
  const failed = async (connection, error) => {
    if (error.status === 401 && error.code === 'extension-unauthorized') {
      const rules = await api.declarativeNetRequest.getDynamicRules();
      await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: rules.map(rule => rule.id), addRules: [] });
      await save({ serverUrl: connection.serverUrl, state: 'revoked', blockedCount: 0, error: 'El docente retiró la vinculación. Solicita un código nuevo.' });
    } else {
      const current = await read();
      await save({ ...current, state: 'offline', error: `${error.message} El último bloqueo aplicado se conserva.` });
    }
  };
  const sync = () => exclusive(async () => {
    const connection = await read();
    if(api.runtime.sendNativeMessage){
      let native;
      try{native=await api.runtime.sendNativeMessage('org.armi.student',{type:'policy'});}catch(error){
        if(connection.native&&/native messaging host.*not found/i.test(error.message||'')){const rules=await api.declarativeNetRequest.getDynamicRules();await api.declarativeNetRequest.updateDynamicRules({removeRuleIds:rules.map(r=>r.id),addRules:[]});await save({native:true,state:'revoked',blockedCount:0,error:'Se retiró el componente de Windows. Vuelve a instalarlo para vincular.'});return;}
      }
      if(native?.success){const local=native.data;
        if(local.policy?.revoked){const rules=await api.declarativeNetRequest.getDynamicRules();await api.declarativeNetRequest.updateDynamicRules({removeRuleIds:rules.map(r=>r.id),addRules:[]});await save({native:true,state:'revoked',blockedCount:0});return;}
        if(local.paired&&local.policy?.deviceId){try{await apply({native:true,serverUrl:normalizeServerUrl(local.server),deviceId:local.policy.deviceId},local.policy);}catch(error){await failed(connection,error);}return;}
        await save({...connection,native:true,state:'pending',error:local.setup?.message||'El agente está buscando al docente o esperando aprobación.'});return;
      }
    }
    if(connection.native){await save({...connection,state:'offline',error:'El agente de Windows no está disponible. Se conservan las últimas reglas.'});return;}
    if (!connection.token) return;
    try { await apply(connection, await request(connection.serverUrl, 'policy', connection.token)); }
    catch (error) {
      await failed(connection, error);
      if (error.status !== 401) {
        try { await request(connection.serverUrl, 'ack', connection.token, { error: error.message, extensionVersion: api.runtime.getManifest().version }); } catch { /* Retry on the next alarm. */ }
      }
    }
  });
  const pair = (serverUrl, code) => exclusive(async () => {
    const origin = normalizeServerUrl(serverUrl);
    const paired = await request(origin, 'pair', null, { code });
    if (!/^[A-Za-z0-9_-]{43}$/.test(paired?.token || '')) throw new Error('ARMI devolvió una vinculación no válida.');
    compilePolicy(paired.policy, origin);
    const connection = { serverUrl: origin, token: paired.token, deviceId: paired.policy.deviceId, deviceName: paired.policy.deviceName, state: 'pending', blockedCount: 0 };
    await save(connection);
    try { await apply(connection, paired.policy); }
    catch (error) { await failed(connection, error); throw error; }
  });
  const status = async () => {
    const value = await read();
    const { token, ...safe } = value;
    return { ...safe, paired: !!token||value.native===true&&!!value.deviceId, state: value.state || 'unpaired' };
  };
  return { sync, pair, status };
}
