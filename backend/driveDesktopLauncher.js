import { execFile, spawn } from 'node:child_process';

export const probeDriveProcess = () => new Promise((resolve) => {
  if (process.platform !== 'win32') return resolve(null);
  execFile('tasklist.exe', ['/FI', 'IMAGENAME eq GoogleDriveFS.exe', '/NH'],
    { windowsHide: true, encoding: 'utf8', timeout: 3000 },
    (error, stdout) => resolve(error ? null : /GoogleDriveFS\.exe/i.test(String(stdout || ''))));
});

const spawnDrive = (executable) => new Promise((resolve, reject) => {
  const child = spawn(executable, ['--startup_mode'], {
    detached: true, windowsHide: true, stdio: 'ignore',
  });
  child.once('error', reject);
  child.once('spawn', () => { child.unref(); resolve(); });
});

// One decision per backend session, shared by every status consumer.
// Seeing Drive already running also consumes the decision: closing it is respected.
export const createDriveDesktopLauncher = ({
  probe = probeDriveProcess, launch = spawnDrive, now = Date.now,
  automaticEnabled = true,
} = {}) => {
  let automaticDecisionMade = false;
  let startingUntil = 0;
  let cached = { at: -Infinity, running: null };
  let probeInFlight = null;
  let actionInFlight = null;

  const check = async (fresh = false) => {
    if (!fresh && now() - cached.at < 15_000) return cached.running;
    if (!probeInFlight) {
      probeInFlight = Promise.resolve().then(probe).catch(() => null).then((running) => {
        cached = { at: now(), running };
        return running;
      }).finally(() => { probeInFlight = null; });
    }
    return probeInFlight;
  };

  const observe = ({ executablePath = '', automatic = false, manual = false } = {}) => {
    if (actionInFlight) return actionInFlight.then((result) => manual && !result.launchAttempted
      && result.processRunning === false ? observe({ executablePath, manual: true }) : result);
    actionInFlight = (async () => {
      const running = await check(manual);
      if (running === true) {
        if (automatic || manual) automaticDecisionMade = true;
        startingUntil = 0;
        return { processRunning: true, launchAttempted: false, starting: false };
      }
      if (running === null) return { processRunning: null, launchAttempted: false, starting: now() < startingUntil };
      if (now() < startingUntil) return { processRunning: false, launchAttempted: false, starting: true };
      const shouldLaunch = manual || (automatic && automaticEnabled && !automaticDecisionMade);
      if (!shouldLaunch || !executablePath) return { processRunning: false, launchAttempted: false, starting: false };
      automaticDecisionMade = true;
      startingUntil = now() + 60_000;
      try {
        await launch(executablePath);
        cached.at = -Infinity;
        return { processRunning: false, launchAttempted: true, starting: true };
      } catch (error) {
        startingUntil = 0;
        return { processRunning: false, launchAttempted: false, starting: false, error: error.message };
      }
    })().finally(() => { actionInFlight = null; });
    return actionInFlight;
  };
  return { observe };
};
