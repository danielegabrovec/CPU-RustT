// Audit the exact staged/tracked source set. Real telemetry stays local.
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
assert(files.length > 30, 'Stage the reviewable source set before running the publication check');
const blocked = /(^|\/)(?:node_modules|target|test-output|artifacts|dati-portabili|\.env(?:\..*)?)(?:\/|$)|\.(?:exe|pdb|sqlite3?(?:-wal|-shm)?|db(?:-wal|-shm)?|log|partial)$/i;
const secrets = /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
for (const relative of files) {
  assert(!blocked.test(relative), `Local/generated data staged: ${relative}`);
  assert(!relative.startsWith('src-tauri/gen/schemas/'), `Generated Tauri schema staged: ${relative}`);
  const file = path.join(root, relative);
  assert(statSync(file).size < 10 * 1024 * 1024, `Unexpected large source file: ${relative}`);
  if (!/\.(?:png|ico|icns|webp|jpg|jpeg)$/i.test(relative)) {
    const text = readFileSync(file, 'utf8');
    assert(!secrets.test(text), `Possible credential or private key: ${relative}`);
    assert(!/C:[\\/]Users[\\/](?:danie|daniele)[\\/]/i.test(text), `Personal absolute path: ${relative}`);
  }
}
for (const required of ['README.md','LICENSE','THIRD-PARTY-NOTICES.txt','CONTRIBUTING.md','CHANGELOG.md',
  '.github/workflows/ci.yml','docs/ANALISI.md','docs/HARDWARE.md','docs/ARCHITETTURA.md','docs/SVILUPPO.md',
  'docs/VERIFICHE.md','docs/INFORMAZIONI-LEGALI.md','tests/frontend-fixture.mjs','tests/run-native.mjs']) {
  assert(files.includes(required), `Missing release source: ${required}`);
}
for (const relative of files.filter(file => file.endsWith('.md'))) {
  const text = readFileSync(path.join(root, relative), 'utf8');
  for (const [, raw] of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = raw.replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^(?:[a-z]+:|\/)/i.test(target)) continue;
    assert(existsSync(path.resolve(root, path.dirname(relative), decodeURIComponent(target))), `Broken local documentation link in ${relative}: ${target}`);
  }
}
console.log(JSON.stringify({ sourceFiles: files.length, publicSourceCheck: 'passed', excluded: ['telemetry', 'databases', 'logs', 'build caches', 'local binaries', 'credentials'] }));
