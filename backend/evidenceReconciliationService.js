import { Worker } from 'worker_threads';

let activeWorker = null;
let activeReconciliation = null;

export const reconcileEvidenceState = () => {
  if (activeReconciliation) return activeReconciliation;

  activeReconciliation = new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/evidenceReconciliation.worker.js', import.meta.url));
    activeWorker = worker;
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    worker.once('message', (message) => {
      if (message?.success) finish(resolve, message.result);
      else finish(reject, new Error(message?.error || 'No se pudo actualizar el indice portatil de evidencias.'));
    });
    worker.once('error', (error) => finish(reject, error));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish(reject, new Error(`La actualizacion de evidencias termino con codigo ${code}.`));
      else if (!settled) finish(resolve, null);
    });
  }).finally(() => {
    activeWorker = null;
    activeReconciliation = null;
  });

  return activeReconciliation;
};

export const shutdownEvidenceReconciliation = async () => {
  const worker = activeWorker;
  activeWorker = null;
  if (worker) await worker.terminate().catch(() => {});
};
