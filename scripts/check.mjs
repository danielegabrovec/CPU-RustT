import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const directory of ['web', 'tests', 'scripts']) {
  for (const file of readdirSync(path.join(root, directory)).filter(file => /\.(?:mjs|js)$/.test(file))) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, directory, file)], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, `${directory}/${file}: ${result.stderr}`);
  }
}
const html = readFileSync(path.join(root, 'web/index.html'), 'utf8');
for (const [, target] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  assert(!/^(?:https?:|\/\/)/i.test(target), `External runtime asset: ${target}`);
  assert(existsSync(path.resolve(root, 'web', target)), `Missing local asset: ${target}`);
}
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const config = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const manifest = readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
assert.equal(config.version, pkg.version, 'Tauri/npm version mismatch');
assert.equal(lock.packages[''].version, pkg.version, 'npm lock version mismatch');
assert.equal(manifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1], pkg.version, 'Cargo/npm version mismatch');
assert.equal(pkg.author, 'Daniele Gabrovec');
assert.equal(config.bundle.publisher, 'Daniele Gabrovec');
assert(config.bundle.copyright.includes('Daniele Gabrovec'));
assert(readFileSync(path.join(root, 'LICENSE'), 'utf8').includes('Copyright (c) 2026 Daniele Gabrovec'));
assert(readFileSync(path.join(root, 'THIRD-PARTY-NOTICES.txt'), 'utf8').includes(`CPU-RustT ${pkg.version}`));
console.log(`JavaScript, local assets, versions and author metadata: OK (${pkg.version})`);
