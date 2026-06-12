import type { AuthSession } from '../types';

const PROFILE_IMAGE_KEY = 'armi_profile_image';
const PROFILE_IMAGE_PREFIX = 'armi_profile_image::';
const PROFILE_IMAGE_ASSET_KEY = 'armi_profile_image_asset';
const PROFILE_IMAGE_ASSET_PREFIX = 'armi_profile_image_asset::';
const MAX_LOCAL_PROFILE_IMAGE_LENGTH = 4_000_000;
export const PROFILE_IMAGE_UPDATED_EVENT = 'armi-profile-image-updated';

export const readImageFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });

export const resolveProfileImageStorageKey = (session?: AuthSession | null) => {
  const userKey =
    session?.user?.sync?.userKey ||
    session?.user?.id ||
    session?.user?.username ||
    '';

  if (!userKey) {
    return PROFILE_IMAGE_KEY;
  }

  return `${PROFILE_IMAGE_PREFIX}${userKey}`;
};

const resolveProfileImageAssetStorageKey = (session?: AuthSession | null) => {
  const userKey =
    session?.user?.sync?.userKey ||
    session?.user?.id ||
    session?.user?.username ||
    '';

  if (!userKey) {
    return PROFILE_IMAGE_ASSET_KEY;
  }

  return `${PROFILE_IMAGE_ASSET_PREFIX}${userKey}`;
};

const safeSlug = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'general';

const normalizeFileUrl = (value: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:image/')) return trimmed;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

export const readStoredProfileImageAsset = (session?: AuthSession | null) => {
  const scopedKey = resolveProfileImageAssetStorageKey(session);
  const scopedValue = normalizeFileUrl(window.localStorage.getItem(scopedKey) || '');
  if (scopedValue) return scopedValue;

  const legacyValue = normalizeFileUrl(window.localStorage.getItem(PROFILE_IMAGE_ASSET_KEY) || '');
  if (!legacyValue) return null;

  if (scopedKey !== PROFILE_IMAGE_ASSET_KEY) {
    try {
      window.localStorage.setItem(scopedKey, legacyValue);
    } catch {}
  }

  return legacyValue;
};

export const readStoredProfileImage = (session?: AuthSession | null) => {
  const scopedKey = resolveProfileImageStorageKey(session);
  const scopedValue = window.localStorage.getItem(scopedKey);
  if (scopedValue) {
    if (scopedValue.length > MAX_LOCAL_PROFILE_IMAGE_LENGTH) {
      window.localStorage.removeItem(scopedKey);
    } else {
      return scopedValue;
    }
  }

  const legacyValue = window.localStorage.getItem(PROFILE_IMAGE_KEY);
  if (!legacyValue) return null;
  if (legacyValue.length > MAX_LOCAL_PROFILE_IMAGE_LENGTH) {
    window.localStorage.removeItem(PROFILE_IMAGE_KEY);
    return null;
  }

  if (scopedKey !== PROFILE_IMAGE_KEY) {
    try {
      if (legacyValue.length <= MAX_LOCAL_PROFILE_IMAGE_LENGTH) {
        window.localStorage.setItem(scopedKey, legacyValue);
      }
    } catch {
      window.localStorage.removeItem(scopedKey);
    }
  }

  return legacyValue;
};

export const resolveProfileImageSource = (
  session?: AuthSession | null,
  fallbackUrl?: string | null,
) => {
  return (
    readStoredProfileImage(session) ||
    (session ? readStoredProfileImage(null) : null) ||
    readStoredProfileImageAsset(session) ||
    (session ? readStoredProfileImageAsset(null) : null) ||
    fallbackUrl ||
    null
  );
};

export const buildProfileImageAssetCandidates = (
  session?: AuthSession | null,
  fallbackUrl?: string | null,
) => {
  const candidates = new Set<string>();
  const storedImage = readStoredProfileImage(session) || (session ? readStoredProfileImage(null) : null);
  const storedAsset = readStoredProfileImageAsset(session) || (session ? readStoredProfileImageAsset(null) : null);
  const userKey =
    session?.user?.sync?.userKey ||
    session?.user?.id ||
    session?.user?.username ||
    '';

  [storedImage, storedAsset, normalizeFileUrl(String(fallbackUrl || ''))].forEach((value) => {
    if (value) candidates.add(value);
  });

  if (userKey) {
    const safeUser = safeSlug(userKey);
    ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].forEach((extension) => {
      candidates.add(`/uploads/user-assets/profiles/${safeUser}/profile.${extension}`);
    });
  }

  return Array.from(candidates);
};

export const persistProfileImageAsset = (fileUrl: string, session?: AuthSession | null) => {
  const normalized = normalizeFileUrl(fileUrl);
  if (!normalized) return;

  const scopedKey = resolveProfileImageAssetStorageKey(session);
  try {
    window.localStorage.setItem(scopedKey, normalized);
    if (scopedKey !== PROFILE_IMAGE_ASSET_KEY) {
      window.localStorage.setItem(PROFILE_IMAGE_ASSET_KEY, normalized);
    }
  } catch {}
};

export const resolveBestProfileImageSource = (
  session?: AuthSession | null,
  fallbackUrl?: string | null,
) =>
  new Promise<string | null>((resolve) => {
    const candidates = buildProfileImageAssetCandidates(session, fallbackUrl);
    const immediate = candidates.find((value) => value.startsWith('data:image/'));
    if (immediate) {
      resolve(immediate);
      return;
    }

    const tryNext = (index: number) => {
      if (index >= candidates.length) {
        resolve(normalizeFileUrl(String(fallbackUrl || '')) || null);
        return;
      }

      const candidate = candidates[index];
      if (!candidate) {
        tryNext(index + 1);
        return;
      }

      const image = new Image();
      image.onload = () => resolve(candidate);
      image.onerror = () => tryNext(index + 1);
      image.src = candidate;
    };

    tryNext(0);
  });

const safeStoreProfileImage = (key: string, imageData: string) => {
  try {
    if (imageData.length > MAX_LOCAL_PROFILE_IMAGE_LENGTH) {
      window.localStorage.removeItem(key);
      return false;
    }
    window.localStorage.setItem(key, imageData);
    return true;
  } catch {
    window.localStorage.removeItem(key);
    return false;
  }
};

export const persistProfileImage = (imageData: string, session?: AuthSession | null) => {
  const scopedKey = resolveProfileImageStorageKey(session);
  const storedScoped = safeStoreProfileImage(scopedKey, imageData);
  const storedLegacy = scopedKey === PROFILE_IMAGE_KEY ? storedScoped : safeStoreProfileImage(PROFILE_IMAGE_KEY, imageData);
  if (!storedScoped || !storedLegacy) {
    console.warn('La imagen de perfil es demasiado pesada para guardarse en localStorage. Se usara solo durante esta sesion o desde archivo.');
  }
  window.dispatchEvent(new CustomEvent(PROFILE_IMAGE_UPDATED_EVENT, { detail: imageData }));
};

export const clearStoredProfileImage = (session?: AuthSession | null) => {
  const scopedKey = resolveProfileImageStorageKey(session);
  const assetScopedKey = resolveProfileImageAssetStorageKey(session);
  window.localStorage.removeItem(scopedKey);
  window.localStorage.removeItem(assetScopedKey);
  if (scopedKey === PROFILE_IMAGE_KEY) {
    window.localStorage.removeItem(PROFILE_IMAGE_KEY);
  }
  if (assetScopedKey === PROFILE_IMAGE_ASSET_KEY) {
    window.localStorage.removeItem(PROFILE_IMAGE_ASSET_KEY);
  }
  window.dispatchEvent(new CustomEvent(PROFILE_IMAGE_UPDATED_EVENT, { detail: null }));
};
