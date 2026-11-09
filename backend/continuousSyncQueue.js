// Coalesce writes without postponing the first deadline. Requests during a run
// remain pending and get their own pass after it finishes.
export const createContinuousSyncQueue = (run, {
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) => {
  let timer = null;
  let dueAt = Infinity;
  let running = false;
  let stopped = false;
  const arm = () => {
    if (stopped || running || !Number.isFinite(dueAt)) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(async () => {
      timer = null;
      dueAt = Infinity;
      running = true;
      try { await run(); }
      finally { running = false; arm(); }
    }, Math.max(0, dueAt - now()));
    timer?.unref?.();
  };
  return {
    request(delayMs = 1000) {
      stopped = false;
      const next = now() + Math.max(100, Number(delayMs) || 1000);
      if (next >= dueAt) return;
      dueAt = next;
      arm();
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      dueAt = Infinity;
    },
  };
};
