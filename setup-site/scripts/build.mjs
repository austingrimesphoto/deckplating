import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');

await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });

for (const entry of await fs.readdir(root, { withFileTypes: true })) {
  if (!entry.isFile() || (!entry.name.endsWith('.html') && entry.name !== '_headers')) continue;
  await fs.copyFile(path.join(root, entry.name), path.join(output, entry.name));
}
await fs.cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
