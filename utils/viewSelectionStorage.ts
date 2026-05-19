export type StoredViewSelection = Record<string, string>;

export const readStoredViewSelection = (storageKey: string): StoredViewSelection => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const writeStoredViewSelection = (storageKey: string, value: StoredViewSelection) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value || {}));
  } catch {}
};
