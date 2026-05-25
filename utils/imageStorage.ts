import type { AuthSession } from '../types';

const PROFILE_IMAGE_KEY = 'armi_profile_image';
const PROFILE_IMAGE_PREFIX = 'armi_profile_image::';
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
    fallbackUrl ||
    null
  );
};

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
  window.localStorage.removeItem(scopedKey);
  if (scopedKey === PROFILE_IMAGE_KEY) {
    window.localStorage.removeItem(PROFILE_IMAGE_KEY);
  }
  window.dispatchEvent(new CustomEvent(PROFILE_IMAGE_UPDATED_EVENT, { detail: null }));
};
