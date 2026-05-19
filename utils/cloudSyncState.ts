export const CLOUD_SYNC_EVENT = 'armi-cloud-sync-updated';

const EXCLUDED_SYNC_KEYS = new Set([
  'armi_auth_session_v1',
  'armi_auth_session_runtime_v1',
  'armi_purchase_request_v1',
  'armi_purchase_config_v1',
  'armi_cloud_sync_show_version_history',
]);

export const collectArmiLocalState = (): Record<string, string> => {
  const snapshot: Record<string, string> = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !key.startsWith('armi_')) continue;
    if (key === 'armi_profile_image' || key.startsWith('armi_profile_image::')) continue;
    if (EXCLUDED_SYNC_KEYS.has(key)) continue;
    const value = window.localStorage.getItem(key);
    if (value !== null) snapshot[key] = value;
  }
  return snapshot;
};

export const applyArmiLocalState = (payload: Record<string, string>) => {
  const keysToRemove: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith('armi_') && !EXCLUDED_SYNC_KEYS.has(key)) keysToRemove.push(key);
  }
  keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (key === 'armi_profile_image' || key.startsWith('armi_profile_image::')) return;
    if (EXCLUDED_SYNC_KEYS.has(key)) return;
    window.localStorage.setItem(key, value);
  });
};

export const emitCloudSyncUpdated = () => {
  window.dispatchEvent(new CustomEvent(CLOUD_SYNC_EVENT));
};
