import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { appRoot, syncRuntimeRoot } from './paths.js';

const authUsersPath = path.join(syncRuntimeRoot, 'auth-users.json');
const authSettingsPath = path.join(syncRuntimeRoot, 'auth-settings.json');
const bundledAuthSettingsPath = path.join(appRoot, 'sync-runtime', 'auth-settings.json');

const writeJsonFileAtomic = (filePath, payload) => {
  const folder = path.dirname(filePath);
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
};

const readJsonFileSafe = (filePath, fallbackValue = {}) => {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallbackValue;
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
};

const authSettings = {
  ...readJsonFileSafe(bundledAuthSettingsPath, {}),
  ...readJsonFileSafe(authSettingsPath, {}),
};
const DEFAULT_PROVIDER = 'local_json';
const PROVIDER = String(
  process.env.ARMI_AUTH_PROVIDER
  || authSettings.provider
  || authSettings.authProvider
  || DEFAULT_PROVIDER
).trim().toLowerCase();
const APPS_SCRIPT_URL = String(
  process.env.ARMI_AUTH_APPS_SCRIPT_URL
  || authSettings.appsScriptUrl
  || authSettings.authLoginUrl
  || ''
).trim();
const APPS_SCRIPT_RESOLVER_URL = String(
  process.env.ARMI_AUTH_APPS_SCRIPT_RESOLVER_URL
  || authSettings.appsScriptResolverUrl
  || authSettings.authResolverUrl
  || ''
).trim();
const execFileAsync = promisify(execFile);
let cachedAppsScriptUrl = '';
let cachedAppsScriptUrlAt = 0;
const URL_CACHE_TTL_MS = 10 * 60 * 1000;

const persistResolvedAppsScriptUrl = (resolvedUrl) => {
  const normalizedUrl = normalizeText(resolvedUrl);
  if (!normalizedUrl) return;

  const currentRuntimeSettings = readJsonFileSafe(authSettingsPath, {});
  writeJsonFileAtomic(authSettingsPath, {
    ...currentRuntimeSettings,
    provider: currentRuntimeSettings.provider || authSettings.provider || 'apps_script',
    appsScriptUrl: normalizedUrl,
    authLoginUrl: normalizedUrl,
    appsScriptResolverUrl: normalizedUrl,
    authResolverUrl: normalizedUrl,
    updatedAt: new Date().toISOString(),
  });
};

const moduleAliases = {
  datos_generales: 'datos_generales',
  datos: 'datos_generales',
  calendario: 'calendario',
  areas_grados: 'areas_grados',
  areas: 'areas_grados',
  estudiantes: 'estudiantes',
  horario: 'horario',
  programacion_anual: 'programacion_anual',
  programacion: 'programacion_anual',
  unidades_didacticas: 'unidades_didacticas',
  unidades: 'unidades_didacticas',
  sesiones: 'sesiones',
  evaluacion: 'evaluacion',
};

const knownAuthFields = new Set([
  'id', 'userId', 'user_id',
  'username', 'usuario', 'user',
  'password', 'contrasena', 'contraseÃ±a',
  'displayName', 'display_name', 'name', 'nombre',
  'nameuser',
  'dni', 'email', 'gmail',
  'avatarUrl', 'avatar_url', 'profileImage', 'profile_image',
  'institutionName', 'institution_name', 'institucion',
  'supportWhatsApp', 'whatsapp', 'supportTelegram', 'telegram',
  'supportEmail', 'website', 'web', 'site',
  'active', 'activo',
  'subscriptionActive', 'subscription_active', 'suscripcion_activa',
  'subscriptionStatus', 'subscription_status', 'estado',
  'subscriptionPlan', 'subscription_plan', 'plan',
  'subscriptionEndsAt', 'subscription_ends_at', 'expiresAt', 'expires_at',
  'subscriptionReason', 'subscription_reason', 'motivo',
  'role', 'rol',
  'syncUserKey', 'sync_user_key', 'userKey', 'user_key',
  'syncUserLabel', 'sync_user_label',
  'driveFolderName', 'drive_folder_name', 'syncFolderName', 'sync_folder_name',
  'driveFolderUrl', 'drive_folder_url', 'syncFolderUrl', 'sync_folder_url',
  'modulePermissions', 'module_permissions', 'permissions', 'modules',
  'features', 'placa', 'placas', 'pc1', 'pc2', 'pc3', 'pc4', 'pc5',
  'maxDevices', 'max_devices', 'pendingPurchase', 'pending_purchase',
  'allowAutoRegisterPc', 'allow_auto_register_pc',
]);

const defaultModulePermissions = () => ({
  datos_generales: true,
  calendario: true,
  areas_grados: true,
  estudiantes: true,
  horario: true,
  programacion_anual: true,
  unidades_didacticas: true,
  sesiones: true,
  evaluacion: true,
});

const fallbackUsers = [
  {
    id: 'demo-armi',
    username: 'arnold',
    password: '123456',
    displayName: 'Arnold Demo',
    dni: '00000000',
    email: 'demo@armi.local',
    active: true,
    subscriptionActive: true,
    subscriptionStatus: 'active',
    subscriptionPlan: 'demo-local',
    role: 'docente',
    syncUserKey: 'arnold-demo',
    syncUserLabel: 'Arnold Demo',
    modulePermissions: defaultModulePermissions(),
    supportWhatsApp: '+51999999999',
    supportEmail: 'soporte@armi.local',
    website: 'https://sites.google.com/view/terminos-armi-docente/armar',
  },
];

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'si', 'sÃ­', 'yes', 'activo', 'active', 'ok'].includes(normalized);
};

const normalizeText = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const normalizeDriveImageUrl = (value) => {
  const url = normalizeText(value);
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/i) || url.match(/[?&]id=([^&]+)/i);
  if (driveMatch?.[1]) return `https://drive.google.com/thumbnail?id=${driveMatch[1]}&sz=w1000`;
  return url;
};

const sanitizeUserKey = (value) => {
  const normalized = normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'default-user';
};

const normalizeStatus = (value, fallback = 'active') => {
  return normalizeText(value, fallback).toLowerCase();
};

const isAllowedStatus = (value) => {
  const normalized = normalizeStatus(value, 'active');
  return ['active', 'activo', 'habilitad@', 'habilitado', 'habilitada', 'enabled', 'ok'].includes(normalized);
};

const isPendingStatus = (value) => {
  const normalized = normalizeStatus(value, '');
  return ['pending', 'pendiente', 'por verificar', 'verificacion', 'verification'].includes(normalized);
};

const normalizePcSlots = (record) => ([
  normalizeText(record.pc1 || record.PC1),
  normalizeText(record.pc2 || record.PC2),
  normalizeText(record.pc3 || record.PC3),
  normalizeText(record.pc4 || record.PC4),
  normalizeText(record.pc5 || record.PC5),
]).filter(Boolean);

const normalizeMaxDevices = (record) => {
  const explicit = Number(record.maxDevices || record.max_devices || 0);
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(5, Math.max(1, explicit));
  const filled = normalizePcSlots(record).length;
  return Math.min(5, Math.max(1, filled || 1));
};

const formatLegacyPlate = (serialNumber) => {
  const normalized = normalizeText(serialNumber, 'UNKNOWN');
  return `1M39A${normalized}`;
};

const sanitizePlateValue = (value) => normalizeText(value).toUpperCase();

const parseJsonObject = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
};

const normalizeModulePermissions = (rawPermissions) => {
  const base = defaultModulePermissions();
  const source = parseJsonObject(rawPermissions) || rawPermissions || {};
  if (Array.isArray(source)) {
    source.forEach((key) => {
      const normalizedKey = moduleAliases[String(key || '').trim().toLowerCase()];
      if (normalizedKey) base[normalizedKey] = true;
    });
    return base;
  }

  Object.entries(source).forEach(([key, value]) => {
    const normalizedKey = moduleAliases[String(key || '').trim().toLowerCase()];
    if (!normalizedKey) return;
    base[normalizedKey] = normalizeBoolean(value, true);
  });
  return base;
};

const normalizeUserRecord = (record) => {
  const userKey = sanitizeUserKey(
    record.syncUserKey || record.sync_user_key || record.userKey || record.user_key || record.username || record.dni
  );
  const permissions = normalizeModulePermissions(
    record.modulePermissions || record.module_permissions || record.permissions?.modules || record.modules
  );
  const support = {
    whatsapp: normalizeText(record.supportWhatsApp || record.whatsapp),
    telegram: normalizeText(record.supportTelegram || record.telegram),
    email: normalizeText(record.supportEmail || record.email || record.gmail),
    website: normalizeText(record.website || record.web || record.site),
  };
  const subscriptionActive = normalizeBoolean(
    record.subscriptionActive ?? record.subscription_active ?? record.suscripcion_activa ?? record.activo ?? record.active,
    true
  );

  const passthroughExtra = Object.fromEntries(
    Object.entries(record || {}).filter(([key]) => {
      if (knownAuthFields.has(key)) return false;
      if (/^custom[_-]?\d+$/i.test(key)) return true;
      if (/^extra[_-]?\d+$/i.test(key)) return true;
      if (/^meta[_-]?\d+$/i.test(key)) return true;
      return true;
    })
  );

  return {
    id: normalizeText(record.id || record.userId || record.user_id || userKey, userKey),
    username: normalizeText(record.username || record.usuario || record.user || record.dni, userKey),
    displayName: normalizeText(record.displayName || record.display_name || record.nameuser || record.name || record.nombre || userKey, userKey),
    dni: normalizeText(record.dni),
    email: normalizeText(record.email || record.gmail),
    avatarUrl: normalizeText(record.avatarUrl || record.avatar_url || record.profileImage || record.profile_image),
    institutionName: normalizeText(record.institutionName || record.institution_name || record.institucion),
    support,
    subscription: {
      active: subscriptionActive,
      status: normalizeText(record.subscriptionStatus || record.subscription_status || record.estado, subscriptionActive ? 'active' : 'inactive'),
      plan: normalizeText(record.subscriptionPlan || record.subscription_plan || record.plan),
      expiresAt: normalizeText(record.subscriptionEndsAt || record.subscription_ends_at || record.expiresAt || record.expires_at) || null,
      reason: normalizeText(record.subscriptionReason || record.subscription_reason || record.motivo),
    },
    permissions: {
      modules: permissions,
      role: normalizeText(record.role || record.rol, 'docente'),
      features: Array.isArray(record.features)
        ? record.features.map((item) => String(item)).filter(Boolean)
        : [],
    },
    sync: {
      userKey,
      userLabel: normalizeText(record.syncUserLabel || record.sync_user_label || record.displayName || record.display_name || record.nameuser || record.nombre, userKey),
      driveFolderName: normalizeText(record.driveFolderName || record.drive_folder_name || record.syncFolderName || record.sync_folder_name),
      driveFolderUrl: normalizeText(record.driveFolderUrl || record.drive_folder_url || record.syncFolderUrl || record.sync_folder_url),
    },
    extra: {
      status: normalizeText(record.estado),
      motivo: normalizeText(record.motivo),
      placas: normalizeText(record.placa || record.placas),
      pcSlots: normalizePcSlots(record),
      maxDevices: normalizeMaxDevices(record),
      pendingPurchase: normalizeBoolean(record.pendingPurchase ?? record.pending_purchase, false),
      allowAutoRegisterPc: normalizeBoolean(record.allowAutoRegisterPc ?? record.allow_auto_register_pc, true),
      reserved: passthroughExtra,
    },
  };
};

const withTimeout = async (promiseFactory, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
};

const readLocalUsers = () => {
  try {
    if (!fs.existsSync(authUsersPath)) return fallbackUsers;
    const parsed = JSON.parse(fs.readFileSync(authUsersPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : fallbackUsers;
  } catch {
    return fallbackUsers;
  }
};

const writeLocalUsers = (users) => {
  fs.writeFileSync(authUsersPath, JSON.stringify(users, null, 2), 'utf8');
};

const getWindowsHardwareInfo = async () => {
  if (process.platform !== 'win32') {
    return { serialNumber: '', motherboardSerial: '', macAddress: '' };
  }

  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$board = Get-CimInstance Win32_BaseBoard | Select-Object -First 1 -ExpandProperty SerialNumber",
    "$mac = Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -eq $true -and $_.MACAddress } | Select-Object -First 1 -ExpandProperty MACAddress",
    "$payload = @{ serialNumber = [string]$board; motherboardSerial = [string]$board; macAddress = [string]$mac } | ConvertTo-Json -Compress",
    "Write-Output $payload",
  ].join('; ');

  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 8000 });
    const parsed = JSON.parse(String(stdout || '{}').trim() || '{}');
    return {
      serialNumber: normalizeText(parsed.serialNumber),
      motherboardSerial: normalizeText(parsed.motherboardSerial),
      macAddress: normalizeText(parsed.macAddress),
    };
  } catch {
    return { serialNumber: '', motherboardSerial: '', macAddress: '' };
  }
};

const buildDeviceContext = async (deviceContext = {}) => {
  const hardware = await getWindowsHardwareInfo();
  const placa = sanitizePlateValue(
    deviceContext.placa ||
    deviceContext.devicePlate ||
    formatLegacyPlate(hardware.serialNumber || os.hostname())
  );

  return {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    appUser: process.env.USERNAME || process.env.USER || '',
    motherboardSerial: hardware.motherboardSerial,
    macAddress: hardware.macAddress,
    placa,
    legacyPlate: placa,
    ...deviceContext,
  };
};

const resolveAccessBlockMessage = (normalizedUser) => {
  const reason = normalizeText(normalizedUser.subscription.reason || normalizedUser.extra?.motivo);
  if (reason) return reason;
  if (isPendingStatus(normalizedUser.extra?.status || normalizedUser.subscription.status)) {
    return 'Tu acceso estÃ¡ pendiente de verificaciÃ³n. Cuando se confirme la compra o validaciÃ³n, podrÃ¡s ingresar.';
  }
  return 'Tu acceso no estÃ¡ habilitado en este momento.';
};

const ensureDeviceAllowedForLocalUser = ({ rawUser, normalizedUser, placa, localUsers }) => {
  const currentPlate = sanitizePlateValue(placa);
  const slots = [
    sanitizePlateValue(rawUser.pc1 || rawUser.PC1),
    sanitizePlateValue(rawUser.pc2 || rawUser.PC2),
    sanitizePlateValue(rawUser.pc3 || rawUser.PC3),
    sanitizePlateValue(rawUser.pc4 || rawUser.PC4),
    sanitizePlateValue(rawUser.pc5 || rawUser.PC5),
  ];

  if (!currentPlate) {
    return { success: true, normalizedUser };
  }

  if (slots.includes(currentPlate)) {
    return { success: true, normalizedUser };
  }

  const maxDevices = normalizedUser.extra.maxDevices || 1;
  const allowedSlots = slots.slice(0, maxDevices);
  const emptyIndex = allowedSlots.findIndex((value) => !value);

  if (emptyIndex >= 0 && normalizedUser.extra.allowAutoRegisterPc !== false) {
    rawUser[`PC${emptyIndex + 1}`] = currentPlate;
    rawUser.placa = [normalizeText(rawUser.placa || rawUser.placas), currentPlate].filter(Boolean).join(', ');
    writeLocalUsers(localUsers);
    return {
      success: true,
      normalizedUser: normalizeUserRecord(rawUser),
    };
  }

  return {
    success: false,
    message: normalizeText(normalizedUser.extra.motivo) || 'Este usuario ya alcanzÃ³ el mÃ¡ximo de computadoras autorizadas.',
  };
};

const buildLegacyInfoUser = (deviceContext = {}) => {
  const serial = normalizeText(deviceContext.motherboardSerial || deviceContext.serialNumber, 'UNKNOWN');
  const appUser = normalizeText(deviceContext.appUser || process.env.USERNAME || process.env.USER, 'UNKNOWN');
  const computerName = normalizeText(deviceContext.hostname || os.hostname(), 'UNKNOWN');
  const macAddress = normalizeText(deviceContext.macAddress, 'UNKNOWN');
  const osVersion = normalizeText(
    [deviceContext.platform || process.platform, deviceContext.osRelease || os.release()].filter(Boolean).join(' '),
    'UNKNOWN'
  );
  const location = normalizeText(deviceContext.location || deviceContext.ipLocation, 'UNKNOWN');

  return `Serie: ${serial}-Usuario: ${appUser}-Nombre PC: ${computerName}-MAC: ${macAddress}-Versión SO: ${osVersion}-Ubicación: ${location}`;
};

const parseRemoteJsonResponse = async (response) => {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    const trimmed = text.trim();
    const jsonStart = Math.min(
      ...['{', '[']
        .map((token) => trimmed.indexOf(token))
        .filter((index) => index >= 0)
    );
    if (Number.isFinite(jsonStart) && jsonStart >= 0) {
      const candidate = trimmed.slice(jsonStart);
      try {
        return JSON.parse(candidate);
      } catch {}
    }
    return {
      success: false,
      message: trimmed.slice(0, 240),
      rawText: trimmed.slice(0, 240),
      nonJson: true,
    };
  }
};

const extractResolvedAppsScriptUrl = (payload) => {
  if (!payload) return '';
  if (typeof payload === 'string') return payload.trim();
  return normalizeText(
    payload.authLoginUrl ||
    payload.loginUrl ||
    payload.url ||
    payload.webAppUrl ||
    payload.data?.authLoginUrl ||
    payload.data?.loginUrl ||
    payload.data?.url ||
    payload.data?.webAppUrl
  );
};

const resolveAppsScriptUrl = async (forceRefresh = false) => {
  if (!forceRefresh && cachedAppsScriptUrl && Date.now() - cachedAppsScriptUrlAt < URL_CACHE_TTL_MS) {
    return cachedAppsScriptUrl;
  }

  if (APPS_SCRIPT_RESOLVER_URL) {
    try {
      const response = await withTimeout(async (signal) => fetch(APPS_SCRIPT_RESOLVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ResolveAuthUrl' }),
        signal,
      }));
      const parsed = await parseRemoteJsonResponse(response);
      const resolved = extractResolvedAppsScriptUrl(parsed);
      if (resolved) {
        cachedAppsScriptUrl = resolved;
        cachedAppsScriptUrlAt = Date.now();
        persistResolvedAppsScriptUrl(resolved);
        return resolved;
      }
    } catch {}

    try {
      const response = await withTimeout(async (signal) => fetch(APPS_SCRIPT_RESOLVER_URL, { signal }));
      const parsed = await parseRemoteJsonResponse(response);
      const resolved = extractResolvedAppsScriptUrl(parsed);
      if (resolved) {
        cachedAppsScriptUrl = resolved;
        cachedAppsScriptUrlAt = Date.now();
        persistResolvedAppsScriptUrl(resolved);
        return resolved;
      }
    } catch {}
  }

  if (APPS_SCRIPT_URL) {
    cachedAppsScriptUrl = APPS_SCRIPT_URL;
    cachedAppsScriptUrlAt = Date.now();
    persistResolvedAppsScriptUrl(APPS_SCRIPT_URL);
  }
  return APPS_SCRIPT_URL;
};

const loginWithLocalProvider = async ({ username, password, remember, deviceContext }) => {
  const normalizedUsername = normalizeText(username).toLowerCase();
  const normalizedPassword = normalizeText(password);
  const localUsers = readLocalUsers();
  const user = localUsers.find((item) => {
    const candidateUsername = normalizeText(item.username || item.usuario || item.user || item.dni).toLowerCase();
    return candidateUsername === normalizedUsername;
  });

  if (!user) {
    return { success: false, message: 'No encontramos ese usuario en la base de acceso.' };
  }

  if (normalizeText(user.password || user.contrasena || user['contrase\u00f1a']) !== normalizedPassword) {
    return { success: false, message: 'La contraseÃ±a no coincide.' };
  }

  let normalizedUser = normalizeUserRecord(user);
  const effectiveDeviceContext = await buildDeviceContext(deviceContext);
  const explicitStatus = normalizedUser.extra?.status || normalizedUser.subscription.status;
  if (isPendingStatus(explicitStatus)) {
    return {
      success: false,
      message: resolveAccessBlockMessage(normalizedUser),
    };
  }

  if (!normalizedUser.subscription.active || !isAllowedStatus(explicitStatus)) {
    return {
      success: false,
      message: resolveAccessBlockMessage(normalizedUser),
    };
  }

  const deviceCheck = ensureDeviceAllowedForLocalUser({
    rawUser: user,
    normalizedUser,
    placa: effectiveDeviceContext.placa,
    localUsers,
  });
  if (!deviceCheck.success) {
    return { success: false, message: deviceCheck.message };
  }
  normalizedUser = deviceCheck.normalizedUser;

  return {
    success: true,
    data: {
      authenticatedAt: new Date().toISOString(),
      remember: remember === true,
      provider: 'local_json',
      user: {
        ...normalizedUser,
        extra: {
          ...normalizedUser.extra,
          deviceContext: effectiveDeviceContext,
        },
      },
    },
  };
};

const loginWithAppsScriptProvider = async ({ username, password, remember, deviceContext }) => {
  const effectiveAppsScriptUrl = await resolveAppsScriptUrl(true);
  if (!effectiveAppsScriptUrl) {
    return { success: false, message: 'El proveedor remoto de autenticaciÃ³n no estÃ¡ configurado todavÃ­a.' };
  }

  try {
    const effectiveDeviceContext = await buildDeviceContext(deviceContext);
    const response = await withTimeout(async (signal) => fetch(effectiveAppsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'Login',
        Usuario: username,
        'ContraseÃ±a': password,
        'Contraseña': password,
        Placa: effectiveDeviceContext.placa,
        InfoUsuario: buildLegacyInfoUser(effectiveDeviceContext),
        username,
        password,
        placa: effectiveDeviceContext.placa,
        devicePlate: effectiveDeviceContext.placa,
        deviceContext: effectiveDeviceContext,
      }),
      signal,
    }));

    const raw = await parseRemoteJsonResponse(response);
    if (!response.ok || !raw) {
      return { success: false, message: 'El servicio remoto no devolviÃ³ una respuesta vÃ¡lida.' };
    }
    if (raw.nonJson) {
      return {
        success: false,
        message: `El Apps Script no devolviÃ³ JSON vÃ¡lido. Respuesta: ${normalizeText(raw.rawText || raw.message).slice(0, 180)}`,
      };
    }
    if (!raw.success) {
      return { success: false, message: raw.message || 'No se pudo iniciar sesiÃ³n con el proveedor remoto.' };
    }

    const normalizedUser = normalizeUserRecord(raw.data || {});
    const explicitStatus = normalizedUser.extra?.status || normalizedUser.subscription.status;
    if (isPendingStatus(explicitStatus)) {
      return {
        success: false,
        message: resolveAccessBlockMessage(normalizedUser),
      };
    }

    if (!normalizedUser.subscription.active || !isAllowedStatus(explicitStatus)) {
      return {
        success: false,
        message: resolveAccessBlockMessage(normalizedUser),
      };
    }

    return {
      success: true,
      data: {
        authenticatedAt: new Date().toISOString(),
        remember: remember === true,
        provider: 'google_apps_script',
        user: {
          ...normalizedUser,
          extra: {
            ...normalizedUser.extra,
            deviceContext: effectiveDeviceContext,
          },
        },
      },
    };
  } catch (error) {
    const errorName = normalizeText(error?.name);
    const errorCode = normalizeText(error?.code || error?.cause?.code);
    const errorMessage = normalizeText(error?.message || error?.cause?.message);
    const detail = [errorName, errorCode, errorMessage].filter(Boolean).join(' | ');
    return {
      success: false,
      message: error?.name === 'AbortError'
        ? `El proveedor remoto tardÃ³ demasiado en responder.${detail ? ` Detalle: ${detail}` : ''}`
        : `No fue posible conectar con el proveedor remoto de autenticaciÃ³n.${detail ? ` Detalle: ${detail}` : ''}`,
    };
  }
};

export const submitPurchase = async (payload = {}) => {
  const effectiveAppsScriptUrl = await resolveAppsScriptUrl();
  if (!effectiveAppsScriptUrl) {
    return { success: false, message: 'El formulario de compra todavia no tiene configurada la URL de Apps Script.' };
  }

  try {
    const effectiveDeviceContext = await buildDeviceContext(payload.deviceContext || {});
    const plate = sanitizePlateValue(payload.Placa || payload.placa || payload.devicePlate || effectiveDeviceContext.placa);
    const body = {
      action: 'Compras',
      varNombres: normalizeText(payload.varNombres || payload.displayName),
      varDNI: normalizeText(payload.varDNI || payload.dni),
      varLugar: normalizeText(payload.varLugar || payload.location),
      varIE: normalizeText(payload.varIE || payload.institutionName),
      varEspecialidad: normalizeText(payload.varEspecialidad || payload.speciality),
      varUsuario: normalizeText(payload.varUsuario || payload.username),
      varContrasena: normalizeText(payload.varContrasena || payload.password),
      'varContraseña': normalizeText(payload.varContrasena || payload.password),
      varGmail: normalizeText(payload.varGmail || payload.gmail),
      varOutlook: normalizeText(payload.varOutlook || payload.outlook),
      varTelegram: normalizeText(payload.varTelegram || payload.telegram),
      varWhatsApp: normalizeText(payload.varWhatsApp || payload.whatsapp),
      varPlaca: plate,
      Placa: plate,
      placa: plate,
      devicePlate: plate,
      imageBase64: normalizeText(payload.imageBase64),
      varTerminos: payload.varTerminos === true,
      'varTérminos': payload.varTerminos === true,
    };

    const required = [
      ['varNombres', 'Ingresa tus apellidos y nombres.'],
      ['varDNI', 'Ingresa tu DNI.'],
      ['varIE', 'Ingresa tu institucion educativa.'],
      ['varUsuario', 'Ingresa el usuario que usaras para acceder.'],
      ['varContrasena', 'Ingresa la contrasena que usaras para acceder.'],
      ['varGmail', 'Ingresa tu Gmail para comunicar la verificacion de la compra.'],
      ['imageBase64', 'Adjunta la captura del comprobante de pago.'],
    ];
    const missing = required.find(([key]) => !body[key]);
    if (missing) return { success: false, message: missing[1] };
    if (!body.varTerminos) return { success: false, message: 'Debes aceptar los terminos y condiciones.' };

    const response = await withTimeout(async (signal) => fetch(effectiveAppsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }), 120000);

    const raw = await parseRemoteJsonResponse(response);
    if (!response.ok || !raw) {
      return { success: false, message: 'El servicio remoto no devolvio una respuesta valida.' };
    }
    if (raw.nonJson) {
      return {
        success: false,
        message: `El Apps Script no devolvio JSON valido. Respuesta: ${normalizeText(raw.rawText || raw.message).slice(0, 180)}`,
      };
    }
    if (!raw.success) {
      return { success: false, message: raw.message || 'No se pudo registrar la compra.' };
    }

    return {
      success: true,
      message: raw.message || 'Compra registrada correctamente. Revisaremos tu comprobante y activaremos tu acceso.',
      data: raw.data || null,
    };
  } catch (error) {
    const detail = normalizeText(error?.message || error?.cause?.message);
    return {
      success: false,
      message: error?.name === 'AbortError'
        ? 'El registro de compra tardo demasiado en responder. Intentalo nuevamente en un minuto.'
        : `No fue posible registrar la compra.${detail ? ` Detalle: ${detail}` : ''}`,
    };
  }
};

export const getPurchaseConfig = async () => {
  const fallbackConfig = {
    yapeQrUrl: '',
    paymentAmount: '100',
    paymentReceiver: 'Kevin Arnold Horna Quispe',
  };
  const effectiveAppsScriptUrl = await resolveAppsScriptUrl();
  if (!effectiveAppsScriptUrl) {
    return {
      success: true,
      data: fallbackConfig,
    };
  }

  try {
    const response = await withTimeout(async (signal) => fetch(effectiveAppsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'purchase_config' }),
      signal,
    }), 30000);

    const raw = await parseRemoteJsonResponse(response);
    if (!response.ok || !raw || raw.nonJson || raw.success === false) {
      return {
        success: true,
        data: fallbackConfig,
      };
    }

    const nextConfig = {
      yapeQrUrl: normalizeDriveImageUrl(raw.data?.yapeQrUrl || raw.yapeQrUrl || raw.data?.purchaseQrUrl || raw.purchaseQrUrl),
      paymentAmount: normalizeText(raw.data?.paymentAmount || raw.paymentAmount, '100'),
      paymentReceiver: normalizeText(raw.data?.paymentReceiver || raw.paymentReceiver, 'Kevin Arnold Horna Quispe'),
    };

    return {
      success: true,
      data: nextConfig,
    };
  } catch {
    return {
      success: true,
      data: fallbackConfig,
    };
  }
};

export const checkPurchaseStatus = async (payload = {}) => {
  const effectiveAppsScriptUrl = await resolveAppsScriptUrl();
  if (!effectiveAppsScriptUrl) {
    return { success: false, message: 'El formulario de compra todavia no tiene configurada la URL de Apps Script.' };
  }

  try {
    const body = {
      action: 'purchase_status',
      varDNI: normalizeText(payload.varDNI || payload.dni),
      varUsuario: normalizeText(payload.varUsuario || payload.username),
    };
    if (!body.varDNI && !body.varUsuario) {
      return { success: false, message: 'Ingresa tu DNI o usuario para consultar el estado.' };
    }

    const response = await withTimeout(async (signal) => fetch(effectiveAppsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }), 45000);

    const raw = await parseRemoteJsonResponse(response);
    if (!response.ok || !raw) {
      return { success: false, message: 'El servicio remoto no devolvio una respuesta valida.' };
    }
    if (raw.nonJson) {
      return { success: false, message: `El Apps Script no devolvio JSON valido. Respuesta: ${normalizeText(raw.rawText || raw.message).slice(0, 180)}` };
    }
    return {
      success: raw.success === true,
      message: raw.message || (raw.success ? 'Estado consultado correctamente.' : 'No se encontro la compra.'),
      data: raw.data || null,
    };
  } catch (error) {
    return {
      success: false,
      message: error?.name === 'AbortError'
        ? 'La consulta de estado tardo demasiado. Intentalo nuevamente.'
        : `No fue posible consultar el estado.${normalizeText(error?.message) ? ` Detalle: ${normalizeText(error.message)}` : ''}`,
    };
  }
};

export const loginUser = async (payload = {}) => {
  if (PROVIDER === 'apps_script') {
    return await loginWithAppsScriptProvider(payload);
  }
  return await loginWithLocalProvider(payload);
};

export const getAuthProviderInfo = () => ({
  success: true,
  data: {
    provider: PROVIDER,
    mode: PROVIDER === 'apps_script' ? 'remote' : 'local',
    appsScriptConfigured: !!APPS_SCRIPT_URL,
  },
});

