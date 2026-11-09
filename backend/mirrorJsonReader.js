import fs from 'node:fs';

const pendingReads = new Map();
// Keep absence distinct from a timeout: callers must not publish an empty catalog
// merely because Drive has not delivered the existing one yet.
export const readMirrorJsonResult = async (target) => {
  let task = pendingReads.get(target);
  if (task && !task.settled) return { status: 'pending' };
  if (!task) {
    if ([...pendingReads.values()].filter(item => !item.settled).length >= 2) return { status: 'pending' };
    task = { settled: false };
    task.promise = fs.promises.readFile(target, 'utf8').then(data => {
      try { return { status: 'ready', value: JSON.parse(data) }; }
      catch { return { status: 'invalid' }; }
    }, error => ({ status: error.code === 'ENOENT' ? 'missing' : 'unavailable' }))
      .finally(() => { task.settled = true; });
    pendingReads.set(target, task);
  }
  let timer;
  const result = await Promise.race([task.promise, new Promise(resolve => {
    timer = setTimeout(() => resolve({ status: 'pending' }), 750);
  })]);
  clearTimeout(timer);
  if (result.status !== 'pending') pendingReads.delete(target);
  return result;
};

export const readMirrorJson = async (target, fallback = null) => {
  const result = await readMirrorJsonResult(target);
  return result.status === 'ready' ? result.value : fallback;
};
