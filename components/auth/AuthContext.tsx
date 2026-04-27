import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AuthSession } from '../../types';
import { loginUser, saveImageAssetFile } from '../../services/apiService';
import { persistProfileImage, readStoredProfileImage } from '../../utils/imageStorage';
import { INITIAL_MODULE_STATUS } from '../../constants';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  login: (payload: { username: string; password: string; remember: boolean }) => Promise<{ success: boolean; message?: string }>;
  loginAsDeveloper: () => void;
  logout: () => void;
}

const AUTH_STORAGE_KEY = 'armi_auth_session_v1';
const AUTH_SESSION_STORAGE_KEY = 'armi_auth_session_runtime_v1';

const AuthContext = createContext<AuthContextValue | null>(null);

const normalizeAuthSession = (value: unknown): AuthSession | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AuthSession>;
  const user = candidate.user as AuthSession['user'] | undefined;
  if (!user || typeof user !== 'object') return null;

  return {
    authenticatedAt: candidate.authenticatedAt || new Date().toISOString(),
    remember: candidate.remember === true,
    provider: candidate.provider || 'local',
    user: {
      ...user,
      id: user.id || user.username || 'default-user',
      username: user.username || user.id || 'default-user',
      displayName: user.displayName || user.username || 'Usuario',
      support: user.support || {},
      subscription: {
        active: user.subscription?.active !== false,
        status: user.subscription?.status || 'active',
        plan: user.subscription?.plan || '',
        expiresAt: user.subscription?.expiresAt || null,
        reason: user.subscription?.reason || '',
      },
      permissions: {
        modules: { ...INITIAL_MODULE_STATUS, ...(user.permissions?.modules || {}) },
        role: user.permissions?.role || 'docente',
        features: Array.isArray(user.permissions?.features) ? user.permissions.features : [],
      },
      sync: {
        userKey: user.sync?.userKey || user.id || user.username || 'default-user',
        userLabel: user.sync?.userLabel || user.displayName || user.username || 'Usuario',
        driveFolderName: user.sync?.driveFolderName || '',
        driveFolderUrl: user.sync?.driveFolderUrl || '',
      },
      extra: user.extra || {},
    },
  };
};

const readPersistedSession = (): AuthSession | null => {
  const persistent = window.localStorage.getItem(AUTH_STORAGE_KEY);
  const runtime = window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY);
  const source = persistent || runtime;
  if (!source) return null;
  try {
    const session = normalizeAuthSession(JSON.parse(source));
    if (!session) {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    }
    return session;
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    return null;
  }
};

const buildDeviceContext = () => ({
  userAgent: navigator.userAgent,
  language: navigator.language,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});

const buildDeveloperSession = (): AuthSession => ({
  authenticatedAt: new Date().toISOString(),
  remember: true,
  provider: 'local_development',
  user: {
    id: 'developer-full-access',
    username: 'desarrollador',
    displayName: 'Desarrollador ARMI',
    email: '',
    institutionName: 'ARMI Docente',
    support: {},
    subscription: {
      active: true,
      status: 'active',
      plan: 'acceso-completo-local',
      expiresAt: null,
      reason: '',
    },
    permissions: {
      modules: { ...INITIAL_MODULE_STATUS },
      role: 'desarrollador',
      features: ['full_access', 'local_development'],
    },
    sync: {
      userKey: 'desarrollador-local',
      userLabel: 'Desarrollador ARMI',
      driveFolderName: 'desarrollador-local',
    },
    extra: {
      fullAccess: true,
      localDevelopment: true,
    },
  },
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSession(readPersistedSession());
    setLoading(false);
  }, []);

  const login = async ({ username, password, remember }: { username: string; password: string; remember: boolean }) => {
    const response = await loginUser({
      username,
      password,
      remember,
      deviceContext: buildDeviceContext(),
    });

    if (!response.success || !response.data) {
      return { success: false, message: response.message || 'No pude iniciar sesión.' };
    }

    const normalizedSession = normalizeAuthSession(response.data);
    if (!normalizedSession) {
      return { success: false, message: 'El servidor devolvio una sesion incompleta.' };
    }

    const serialized = JSON.stringify(normalizedSession);
    if (remember) {
      window.localStorage.setItem(AUTH_STORAGE_KEY, serialized);
      window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, serialized);
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    }

    const pendingProfileImage = readStoredProfileImage(null);
    if (pendingProfileImage) {
      persistProfileImage(pendingProfileImage, normalizedSession);
      void saveImageAssetFile({
        imageData: pendingProfileImage,
        kind: 'profile',
        userKey: normalizedSession.user.sync.userKey || normalizedSession.user.id || normalizedSession.user.username,
      });
    }

    setSession(normalizedSession);
    return { success: true };
  };

  const loginAsDeveloper = () => {
    const developerSession = buildDeveloperSession();
    const serialized = JSON.stringify(developerSession);
    window.localStorage.setItem(AUTH_STORAGE_KEY, serialized);
    window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    setSession(developerSession);
  };

  const logout = () => {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    setSession(null);
  };

  const value = useMemo<AuthContextValue>(() => ({
    session,
    loading,
    login,
    loginAsDeveloper,
    logout,
  }), [session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
};
