const { execFile } = require('node:child_process');

const isProcessAlive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
};
const forceStopProcess = pid => new Promise((resolve, reject) => {
  if (process.platform === 'win32') {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, error => {
      if (error && isProcessAlive(pid)) reject(error); else resolve();
    });
  } else {
    try { process.kill(pid, 'SIGKILL'); resolve(); }
    catch (error) { if (error.code === 'ESRCH') resolve(); else reject(error); }
  }
});

// UtilityProcess.kill() is a graceful request. Do not leave Electron until the
// owned backend has actually released its sockets, even when it is blocked.
const stopUtilityBackend = async (child, { timeoutMs = 6000, isAlive = isProcessAlive,
  forceStop = forceStopProcess, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) => {
  const pid = child?.pid;
  if (!pid) return;
  try { child.postMessage({ type: 'armi:shutdown' }); }
  catch { try { child.kill(); } catch {} }
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid) && Date.now() < deadline) await wait(100);
  if (isAlive(pid)) await forceStop(pid);
  if (isAlive(pid)) throw new Error(`El servidor interno ${pid} no se detuvo.`);
};

module.exports = { stopUtilityBackend };
