type BootstrapResult = { success: boolean; message?: string; data?: any };
type BootstrapJob = { id: string; status: string; result?: BootstrapResult };
type JobResponse = { success: boolean; code?: string; message?: string; data?: { job?: BootstrapJob } };

// A dropped connection can mean recovery is still working. Keep polling the
// same receipt while the app continues working with its local state.
export const runPortableBootstrap = async ({
  start, poll, signal, now = Date.now,
  pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
  timeoutMs = 5 * 60_000,
}: {
  start: () => Promise<JobResponse>;
  poll: (id: string) => Promise<JobResponse>;
  signal?: AbortSignal;
  now?: () => number;
  pause?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}): Promise<BootstrapResult> => {
  const deadline = now() + timeoutMs;
  let jobId = '';
  while (now() < deadline) {
    if (signal?.aborted) throw new DOMException('Inicio cancelado', 'AbortError');
    let response: JobResponse;
    try { response = jobId ? await poll(jobId) : await start(); }
    catch (error: any) {
      if (signal?.aborted) throw error;
      await pause(1000);
      continue;
    }
    if (response.code === 'BOOTSTRAP_JOB_NOT_FOUND') {
      jobId = ''; // The service restarted; resume preparation on the new process.
      await pause(1000);
      continue;
    }
    if (!response.success) return { success: false, message: response.message || 'No se pudo preparar ARMI.' };
    const job = response.data?.job;
    if (!job) throw new Error('El servicio local devolvió un estado de inicio inválido.');
    jobId = job.id;
    if (job.status === 'completed') return job.result || { success: false, message: 'No se recibió el resultado del inicio.' };
    await pause(1000);
  }
  return { success: false, message: 'La preparación está tardando más de lo esperado. Reintenta sin borrar datos; ARMI conservará el trabajo que siga en curso.' };
};
