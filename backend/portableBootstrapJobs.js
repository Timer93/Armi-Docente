import crypto from 'node:crypto';

// Return the job receipt before starting disk work. Retrying a receipt must not
// launch another recovery while the original one is still running.
export const createPortableBootstrapJobs = (bootstrap) => {
  const jobs = new Map();
  const queue = [];
  let running = false;
  const view = job => ({ id: job.id, status: job.status, ...(job.result ? { result: job.result } : {}) });
  const drain = async () => {
    if (running || !queue.length) return;
    running = true;
    const job = queue.shift();
    job.status = 'running';
    try { job.result = await bootstrap(job.state); }
    catch (error) { job.result = { success: false, message: String(error?.message || error) }; }
    finally {
      job.status = 'completed';
      job.completedAt = Date.now();
      delete job.state;
      running = false;
      if (queue.length) setImmediate(drain);
    }
  };
  return {
    start(state = {}, requestId) {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId || '')) throw new Error('Identificador de inicio inválido.');
      const existing = jobs.get(requestId);
      if (existing) return view(existing);
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(Object.entries(state).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
      for (const job of jobs.values()) {
        if (job.status !== 'completed' && job.fingerprint === fingerprint) return view(job);
      }
      for (const [id, job] of jobs) {
        if (job.completedAt && Date.now() - job.completedAt > 30 * 60_000) jobs.delete(id);
      }
      if ([...jobs.values()].filter(job => job.status !== 'completed').length >= 10) throw new Error('Hay varios inicios pendientes. Espera a que termine la recuperación.');
      // Bound completed receipts as well as queued work.
      if (jobs.size >= 50) {
        const completed = [...jobs.values()].find(job => job.status === 'completed');
        if (completed) jobs.delete(completed.id);
      }
      const job = { id: requestId, fingerprint, state: structuredClone(state), status: 'queued' };
      jobs.set(job.id, job);
      queue.push(job);
      setImmediate(drain);
      return view(job);
    },
    get(id) { const job = jobs.get(id); return job ? view(job) : null; },
  };
};
