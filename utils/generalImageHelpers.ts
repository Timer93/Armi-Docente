import type { GeneralData } from '../types';
import { INITIAL_GENERAL_DATA } from '../constants';
import { saveDatosGenerales } from '../services/apiService';

export const GENERAL_IMAGES_UPDATED_EVENT = 'armi-general-images-updated';
const GENERAL_IMAGES_STORAGE_KEY = 'armi_general_images_state';

export const mergeGeneralDataImage = (
  current: GeneralData,
  field: 'insignia' | 'logo',
  imageData: string
): GeneralData => ({
  ...INITIAL_GENERAL_DATA,
  ...current,
  [field]: imageData,
});

export const persistGeneralImageField = async (
  current: GeneralData,
  field: 'insignia' | 'logo',
  imageData: string
) => {
  const nextData = mergeGeneralDataImage(current, field, imageData);
  const result = await saveDatosGenerales(nextData);
  return {
    result,
    nextData,
  };
};

export const readStoredGeneralImages = () => {
  try {
    const raw = window.localStorage.getItem(GENERAL_IMAGES_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { insignia?: string; logo?: string; updatedAt?: string };
  } catch {
    return null;
  }
};

export const broadcastGeneralImagesUpdate = (payload: { insignia?: string; logo?: string }) => {
  const detail = {
    insignia: payload.insignia || '',
    logo: payload.logo || '',
    updatedAt: new Date().toISOString(),
  };

  window.localStorage.setItem(GENERAL_IMAGES_STORAGE_KEY, JSON.stringify(detail));
  window.dispatchEvent(new CustomEvent(GENERAL_IMAGES_UPDATED_EVENT, { detail }));
  return detail;
};
