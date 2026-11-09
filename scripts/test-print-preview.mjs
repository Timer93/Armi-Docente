import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('artifacts/print-preview-test');
fs.mkdirSync(root, { recursive: true });
const env = { ...process.env, ARMI_PRINT_TEST_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawnSync(createRequire(import.meta.url)('electron'), ['scripts/test-print-preview-electron.cjs'], {
  cwd: process.cwd(), windowsHide: true, encoding: 'utf8', timeout: 90_000, env
});
process.stdout.write(child.stdout || ''); process.stderr.write(child.stderr || '');
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
