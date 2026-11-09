const createCloseHandshake = ({ sendRequest, closeWithoutRenderer, onUnresponsive,
  setTimer = setTimeout, clearTimer = clearTimeout, timeoutMs = 3_000 }) => {
  let ready = false;
  let pending = false;
  let acknowledged = false;
  let timer = null;
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null; };
  return {
    setReady(value) {
      ready = Boolean(value);
      if (!ready) { clear(); pending = false; acknowledged = false; }
    },
    request() {
      if (pending && !acknowledged) return;
      // The renderer may have finished with a conflict or dismissed its dialog.
      // A later X must reach it again. Its own in-flight guard prevents a
      // second sync while an attempt is still running.
      clear();
      pending = true;
      acknowledged = false;
      // During startup there is no sync UI and no editable application state.
      if (!ready) { void closeWithoutRenderer(); return; }
      const fallback = () => { clear(); void onUnresponsive(); };
      timer = setTimer(fallback, timeoutMs);
      try { sendRequest(); } catch { fallback(); }
    },
    acknowledge() { clear(); acknowledged = true; },
    cancel() { clear(); pending = false; acknowledged = false; },
    dispose() { clear(); pending = false; acknowledged = false; ready = false; },
  };
};
module.exports = { createCloseHandshake };
