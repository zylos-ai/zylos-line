import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function writeJsonAtomic(filePath, data, mode = 0o644) {
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let renamed = false;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, filePath);
    renamed = true;
  } finally {
    if (!renamed) {
      try {
        fs.unlinkSync(tmp);
      } catch {}
    }
  }
}
