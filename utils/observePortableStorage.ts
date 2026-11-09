// Observe changes in this window too: the browser's 'storage' event only fires
// in other windows. Keep one pending batch and retry failures without losing keys.
export const observePortableStorage = (save: (keys: string[]) => Promise<boolean>, initialKeys: string[] = []) => {
  const originalSet = Storage.prototype.setItem;
  const originalRemove = Storage.prototype.removeItem;
  const originalClear = Storage.prototype.clear;
  const pending = new Set<string>(initialKeys.filter(key => key.startsWith('armi_')));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  let active = true;
  const flush = async () => {
    timer = undefined;
    if (!active || busy || !pending.size) return;
    busy = true;
    const keys = [...pending]; pending.clear();
    try { if (!await save(keys)) keys.forEach((key) => pending.add(key)); }
    catch { keys.forEach((key) => pending.add(key)); }
    finally { busy = false; if (active && pending.size) timer = setTimeout(flush, 1000); }
  };
  const changed = (key: string) => {
    if (!key.startsWith('armi_')) return;
    pending.add(key);
    if (!timer && !busy) timer = setTimeout(flush, 500);
  };
  Storage.prototype.setItem = function (key, value) {
    const before = this.getItem(key); originalSet.call(this, key, value);
    if (this === window.localStorage && before !== String(value)) changed(String(key));
  };
  Storage.prototype.removeItem = function (key) {
    const before = this.getItem(key); originalRemove.call(this, key);
    if (this === window.localStorage && before !== null) changed(String(key));
  };
  Storage.prototype.clear = function () {
    const keys = this === window.localStorage ? Object.keys(this) : [];
    originalClear.call(this); keys.forEach(changed);
  };
  const external = (event: StorageEvent) => { if (event.storageArea === window.localStorage && event.key) changed(event.key); };
  window.addEventListener('storage', external);
  if (pending.size) timer = setTimeout(flush, 500);
  return () => {
    active = false; clearTimeout(timer);
    Storage.prototype.setItem = originalSet; Storage.prototype.removeItem = originalRemove; Storage.prototype.clear = originalClear;
    window.removeEventListener('storage', external);
  };
};
