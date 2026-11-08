// Launch only a test-owned native process and always shut it down afterwards.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, open, access, copyFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { runNativeSmoke } from './native-smoke.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const binary = path.resolve(project, arg('--exe') ?? 'artifacts/CPU-RustT.exe');
await access(binary);
const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const output = path.join(project, 'test-output', 'native-runs', stamp);
const data = path.join(output, 'data');
await mkdir(data, { recursive: true });
const server = createServer();
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const cdp = `http://127.0.0.1:${port}`;
const out = await open(path.join(output, 'stdout.log'), 'w');
const err = await open(path.join(output, 'stderr.log'), 'w');
const child = spawn(binary, [], {
  cwd: path.dirname(binary), windowsHide: true,
  env: { ...process.env, CPU_RUSTT_DATA_DIR: data,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` },
  stdio: ['ignore', out.fd, err.fd],
});
let exited = false, launchError;
child.once('exit', () => { exited = true; });
child.once('error', error => { launchError = error; exited = true; });
let result;
try {
  const deadline = Date.now() + 45000;
  while (true) {
    if (launchError) throw launchError;
    if (exited) throw new Error('L’app di prova si è chiusa prima della connessione. Chiudere eventuali altre istanze CPU-RustT e riprovare.');
    try { const response = await fetch(`${cdp}/json/version`); if (response.ok) break; } catch {}
    assert(Date.now() < deadline, 'La WebView di prova non ha avviato la porta di debug entro 45 secondi.');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  result = await runNativeSmoke({ cdpUrl: cdp, outputDir: output, dataDir: data });
  await copyFile(path.join(output, 'native-smoke-report.json'), path.join(project, 'test-output', 'native-smoke-report.json'));
  await writeFile(path.join(project, 'test-output', 'latest-native-run.json'), JSON.stringify({ binary: path.relative(project, binary), output: path.relative(project, output), passed: result.passed }, null, 2));
  if (!result.passed) process.exitCode = 1;
  console.log(JSON.stringify({ passed: result.passed, checks: result.checks.length, report: path.relative(project, path.join(output, 'native-smoke-report.json')) }));
} finally {
  if (!exited) {
    try {
      const browser = await chromium.connectOverCDP(cdp);
      const page = browser.contexts().flatMap(context => context.pages())[0];
      // The data-path guard in runNativeSmoke already rejected unrelated windows.
      const actual = await page.evaluate(() => window.__TAURI__.core.invoke('get_state'));
      assert.equal(path.resolve(actual.database_path), path.join(data, 'workspace.sqlite3'));
      await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(error => { if (!/closed|destroyed/i.test(error.message)) throw error; });
      await browser.close().catch(() => {});
    } catch (error) { console.error(`Chiusura della sola istanza di prova: ${error.message}`); }
    const deadline = Date.now() + 10000;
    while (!exited && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    if (!exited) child.kill();
  }
  await out.close(); await err.close();
}
