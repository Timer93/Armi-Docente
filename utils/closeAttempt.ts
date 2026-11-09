// A cancelled/expired close must never resume and close a working window when
// an old network request eventually returns. The backend may still finish that
// request safely; only the abandoned renderer continuation is stopped here.
export const createCloseAttempt = ({
  timeoutMs = 45_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) => {
  let stopped = false;
  let rejectStopped: (error: Error) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectStopped = reject; });
  // A synchronous failure can dispose the attempt before its first wait.
  void cancelled.catch(() => {});
  const stop = (message: string) => {
    if (stopped) return;
    stopped = true;
    clearTimer(timer);
    rejectStopped(new Error(message));
  };
  const timer = setTimer(() => stop('El cierre está tardando demasiado. Puedes seguir trabajando o reintentarlo. La sincronización que ya comenzó puede continuar en segundo plano.'), timeoutMs);
  return {
    wait: <T>(operation: Promise<T>): Promise<T> => Promise.race([cancelled, operation]).then(value => {
      if (stopped) throw new Error('Este intento de cierre ya terminó.');
      return value;
    }),
    cancel: () => stop('Se canceló este intento de cierre.'),
    dispose: () => { clearTimer(timer); },
  };
};
