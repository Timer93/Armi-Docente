import React, { createContext, useContext, useEffect, useState } from 'react';
import type { AuthSession } from '../../types';
import { INITIAL_MODULE_STATUS } from '../../constants';
import { createApiClient } from '../public/api-client.js';
import { setWebIdentity } from './runtime.js';

type ContextValue = { session: AuthSession | null; loading: boolean; login: (payload: { username: string; password: string; remember: boolean }) => Promise<{ success: boolean; message?: string }>; logout: () => void; loginAsDeveloper: () => void };
const Context = createContext<ContextValue | null>(null);

function desktopSession(data: any): AuthSession {
  // Los módulos se habilitan para inspeccionar la interfaz; esto no concede
  // permisos de escritura. El servidor conserva la autoridad de autenticación.
  const modules = Object.fromEntries(Object.keys(INITIAL_MODULE_STATUS).map(key => [key, true]));
  return {
    authenticatedAt: new Date().toISOString(), remember: false, provider: 'apps_script',
    user: {
      id: data.user.id, username: data.user.username, displayName: data.user.displayName,
      support: {}, subscription: { active: true, status: data.membership.status, plan: data.membership.plan || '', expiresAt: data.membership.expiresAt, reason: '' },
      permissions: { modules, role: 'docente', features: [] },
      sync: { userKey: data.user.id, userLabel: data.user.displayName, driveFolderName: '', driveFolderUrl: '' }, extra: {},
    },
  } as AuthSession;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [expiry, setExpiry] = useState(0);
  const [client] = useState(() => createApiClient({ onUnauthorized: () => { setWebIdentity(null); setSession(null); } }));
  useEffect(() => {
    let active = true;
    client.request('/api/auth/session').then(data => {
      if (!active) return;
      setWebIdentity(data); setSession(desktopSession(data)); setExpiry(Date.parse(data.sessionExpiresAt));
    }).catch(() => { if (active) { setWebIdentity(null); setSession(null); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client]);
  useEffect(() => {
    if (!session || !expiry) return;
    const timer = setTimeout(() => { setWebIdentity(null); window.location.reload(); }, Math.max(0, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [session, expiry]);
  const login: ContextValue['login'] = async ({ username, password }) => {
    try {
      await client.request('/api/auth/login', 'POST', { username, password });
      // Un contexto nuevo evita reutilizar caches académicas de otra cuenta.
      window.location.reload();
      return { success: true };
    } catch (error) { return { success: false, message: (error as Error).message }; }
  };
  const logout = () => {
    void client.request('/api/auth/logout', 'POST', {}).then(() => { setWebIdentity(null); window.location.reload(); }).catch(() => window.alert('No se pudo cerrar la sesión. Intenta nuevamente.'));
  };
  return <Context.Provider value={{ session, loading, login, logout, loginAsDeveloper: () => { window.alert('El acceso requiere una cuenta de ARMI habilitada.'); } }}>{children}</Context.Provider>;
}

export function useAuth() {
  const context = useContext(Context);
  if (!context) throw new Error('Falta el proveedor de acceso web.');
  return context;
}
