const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, utilityProcess } = require('electron');
const { stopUtilityBackend } = require('../electron/backend-shutdown.cjs');
const root = process.env.ARMI_LIFECYCLE_TEST_ROOT;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const children = [];
const launch = async (name, extra = {}) => {
  const ready = path.join(root, `${name}.ready.json`);
  const marker = path.join(root, `${name}.stopped`);
  const child = utilityProcess.fork(path.resolve('electron/backend-process.cjs'), [], {
    stdio: 'ignore', env: { ...process.env, ARMI_BACKEND_ENTRY: path.join(root, 'fixture.mjs'),
      ARMI_BACKEND_OWNER_PID: String(process.pid), ARMI_TEST_READY: ready, ARMI_TEST_STOPPED: marker, ...extra },
  });
  children.push(child);
  const deadline = Date.now() + 8000;
  while (!fs.existsSync(ready) && Date.now() < deadline) await wait(30);
  assert.ok(fs.existsSync(ready), `Backend fixture ${name} must start`);
  return { child, marker, ...JSON.parse(fs.readFileSync(ready)) };
};
app.whenReady().then(async () => {
  try {
    const normal = await launch('normal');
    assert.equal((await fetch(`http://127.0.0.1:${normal.port}`)).status, 200);
    await stopUtilityBackend(normal.child);
    assert.equal(alive(normal.pid), false, 'Graceful IPC must terminate the real utility process');
    assert.ok(fs.existsSync(normal.marker), 'IPC must run server shutdown before exiting');
    await assert.rejects(fetch(`http://127.0.0.1:${normal.port}`));

    const stuck = await launch('stuck', { ARMI_TEST_HANG: '1' });
    await stopUtilityBackend(stuck.child, { timeoutMs: 250 });
    assert.equal(alive(stuck.pid), false, 'A blocked backend must be terminated before app exit');

    const orphan = await launch('orphan', { ARMI_BACKEND_OWNER_PID: '2147483647' });
    const deadline = Date.now() + 6000;
    while (alive(orphan.pid) && Date.now() < deadline) await wait(50);
    assert.equal(alive(orphan.pid), false, 'A backend whose owner died must stop itself');
    assert.ok(fs.existsSync(orphan.marker));
    console.log('OK: real Electron utility IPC shutdown, released port, forced blocked-process shutdown, and orphan watchdog.');
    app.exit(0);
  } catch (error) {
    console.error(error);
    for (const child of children) { try { child.kill(); } catch {} }
    app.exit(1);
  }
});
