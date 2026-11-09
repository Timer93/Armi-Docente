// Keep completed receipts after the short-lived per-file UI entries disappear.
// Concurrent transfers share one cycle; its denominator includes completed
// files until every requested file has been validated.
export const createTransferProgress = () => {
  const tasks = new Map();
  const begin = (id, totalBytes, state = 'transferring') => {
    if ([...tasks.values()].every(task => ['complete', 'error'].includes(task.state))) tasks.clear();
    tasks.set(id, { state, totalBytes: Math.max(0, Number(totalBytes || 0)), completedBytes: 0, message: '' });
  };
  const update = (id, completedBytes, totalBytes) => {
    const task = tasks.get(id);
    if (!task) return;
    task.state = 'transferring';
    if (Number.isFinite(totalBytes)) task.totalBytes = Math.max(0, totalBytes);
    task.completedBytes = Math.min(task.totalBytes, Math.max(0, Number(completedBytes || 0)));
  };
  const complete = id => {
    const task = tasks.get(id);
    if (task) Object.assign(task, { state: 'complete', completedBytes: task.totalBytes });
  };
  const fail = (id, message) => {
    const task = tasks.get(id);
    if (task) Object.assign(task, { state: 'error', message });
  };
  const snapshot = () => {
    const rows = [...tasks.values()];
    return {
      state: !rows.length ? 'idle' : rows.some(task => task.state === 'transferring') ? 'transferring'
        : rows.some(task => task.state === 'error') ? 'error' : rows.some(task => task.state === 'waiting') ? 'waiting' : 'complete',
      totalFiles: rows.length,
      completedFiles: rows.filter(task => task.state === 'complete').length,
      totalBytes: rows.reduce((sum, task) => sum + task.totalBytes, 0),
      completedBytes: rows.reduce((sum, task) => sum + task.completedBytes, 0),
      message: rows.find(task => task.message)?.message || '',
    };
  };
  return { begin, update, complete, fail, snapshot };
};
