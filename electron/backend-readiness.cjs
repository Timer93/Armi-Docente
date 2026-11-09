const waitForServer = async (url, timeoutMs = 90_000, {
  fetchImpl = fetch, now = Date.now,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  requestTimeoutMs = 4_000, pollMs = 500,
} = {}) => {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(requestTimeoutMs, deadline - now()));
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (response.ok) return true;
    } catch {}
    finally { clearTimeout(timer); }
    const remaining = deadline - now();
    if (remaining > 0) await pause(Math.min(pollMs, remaining));
  }
  return false;
};

module.exports = { waitForServer };
