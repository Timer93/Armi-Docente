import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ensureDir, syncRuntimeRoot } from './paths.js';

const KEY_PATH = path.join(syncRuntimeRoot, 'student-password-vault.key');

const getVaultKey = () => {
  ensureDir(syncRuntimeRoot);
  if (fs.existsSync(KEY_PATH)) {
    const existing = Buffer.from(String(fs.readFileSync(KEY_PATH, 'utf8')).trim(), 'base64');
    if (existing.length === 32) return existing;
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_PATH, key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  return key;
};

const encryptStudentPassword = (password) => {
  const value = String(password || '');
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getVaultKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
};

const decryptStudentPassword = (payload) => {
  try {
    const [version, ivValue, tagValue, encryptedValue] = String(payload || '').split('.');
    if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', getVaultKey(), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
};

export { encryptStudentPassword, decryptStudentPassword };
