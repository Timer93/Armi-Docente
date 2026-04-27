export const CLOUD_SYNC_EVENT = 'armi-cloud-sync-updated';

export const collectArmiLocalState = (): Record<string, string> => {
  const snapshot: Record<string, string> = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !key.startsWith('armi_')) continue;
    if (key === 'armi_profile_image' || key.startsWith('armi_profile_image::')) continue;
    const value = window.localStorage.getItem(key);
    if (value !== null) snapshot[key] = value;
  }
  return snapshot;
};

export const applyArmiLocalState = (payload: Record<string, string>) => {
  const keysToRemove: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith('armi_')) keysToRemove.push(key);
  }
  keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (key === 'armi_profile_image' || key.startsWith('armi_profile_image::')) return;
    window.localStorage.setItem(key, value);
  });
};

export const emitCloudSyncUpdated = () => {
  window.dispatchEvent(new CustomEvent(CLOUD_SYNC_EVENT));
};
