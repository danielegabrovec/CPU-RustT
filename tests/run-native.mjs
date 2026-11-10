// Launch only test-owned native processes and always shut them down afterwards.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, open, access, copyFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { chromium, expect } from '@playwright/test';
import { runNativeSmoke } from './native-smoke.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const binary = path.resolve(project, arg('--exe') ?? 'artifacts/CPU-RustT.exe');
await access(binary);
const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const output = path.join(project, 'test-output', 'native-runs', stamp);
const data = path.join(output, 'data');
await mkdir(data, { recursive: true });
const owned = [];
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const invoke = (page, command, args) => page.evaluate(({ command, args }) => window.__TAURI__.core.invoke(command, args), { command, args });

async function launchNative(label) {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const out = await open(path.join(output, `${label}-stdout.log`), 'w');
  const err = await open(path.join(output, `${label}-stderr.log`), 'w');
  const child = spawn(binary, [], {
    cwd: path.dirname(binary), windowsHide: true,
    env: { ...process.env, CPU_RUSTT_DATA_DIR: data,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` },
    stdio: ['ignore', out.fd, err.fd],
  });
  const run = { child, out, err, cdp: `http://127.0.0.1:${port}`, exited: false, label };
  owned.push(run);
  child.once('exit', code => { run.exited = true; run.exitCode = code; });
  child.once('error', error => { run.launchError = error; run.exited = true; });
  const deadline = Date.now() + 45000;
  while (true) {
    if (run.launchError) throw run.launchError;
    if (run.exited) throw new Error('L’app di prova si è chiusa prima della connessione. Chiudere eventuali altre istanze CPU-RustT e riprovare.');
    try { const response = await fetch(`${run.cdp}/json/version`, { signal: AbortSignal.timeout(1000) }); if (response.ok) break; } catch {}
    assert(Date.now() < deadline, 'La WebView di prova non ha avviato la porta di debug entro 45 secondi.');
    await pause(200);
  }
  return run;
}

async function attachOwned(run) {
  const browser = await chromium.connectOverCDP(run.cdp);
  try {
    let page;
    await expect.poll(() => {
      page = browser.contexts().flatMap(context => context.pages()).find(candidate => /tauri\.localhost/.test(candidate.url()));
      return Boolean(page);
    }, { timeout: 30000 }).toBe(true);
    await expect.poll(async () => page.evaluate(() => Boolean(window.__CPU_RUSTT_QA__?.getState()?.ready)).catch(() => false), { timeout: 20000 }).toBe(true);
    const state = await invoke(page, 'get_state');
    assert.equal(path.resolve(state.database_path), path.join(data, 'workspace.sqlite3'), 'Refusing mutations or close outside the dedicated test database');
    return { browser, page, state };
  } catch (error) { await browser.close().catch(() => {}); throw error; }
}

async function closeOwned(run, strict = true) {
  if (run.exited) {
    if (strict) assert.equal(run.exitCode, 0, 'The test application must exit successfully');
    return;
  }
  let closeError;
  try {
    const attached = await attachOwned(run);
    try {
      await attached.page.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(error => { if (!/closed|destroyed/i.test(error.message)) throw error; });
    } finally { await attached.browser.close().catch(() => {}); }
  } catch (error) { closeError = error; }
  const deadline = Date.now() + 15000;
  while (!run.exited && Date.now() < deadline) await pause(100);
  if (!run.exited) {
    // This child was spawned here, never discovered by a process-name lookup.
    run.child.kill();
    const killDeadline = Date.now() + 5000;
    while (!run.exited && Date.now() < killDeadline) await pause(100);
    closeError ??= new Error('La chiusura normale dell’app di prova ha superato 15 secondi.');
  }
  if (strict) {
    if (closeError) throw closeError;
    assert.equal(run.exitCode, 0, 'The test application must exit successfully');
  } else if (closeError) console.error(`Chiusura della sola istanza di prova: ${closeError.message}`);
}

async function verifyRestart(first, result) {
  const started = Date.now();
  let attached, restarted;
  try {
    attached = await attachOwned(first);
    attached.page.on('pageerror', error => result.pageErrors.push(String(error)));
    const originalPreferences = attached.state.preferences;
    const preferences = { ...originalPreferences, interval_ms: originalPreferences.interval_ms === 500 ? 1000 : 500, theme_light: !originalPreferences.theme_light };
    await invoke(attached.page, 'save_preferences', { preferences });
    await expect.poll(async () => (await invoke(attached.page, 'get_state')).preferences).toEqual(preferences);
    const name = `QA-native-restart-${stamp}`;
    await invoke(attached.page, 'start_recording', { name });
    const id = (await invoke(attached.page, 'get_state')).active_session;
    assert(Number.isInteger(id));
    result.sessions.push({ id, name });
    await expect.poll(async () => (await invoke(attached.page, 'get_sessions')).find(session => session.id === id)?.samples, { timeout: 15000 }).toBeGreaterThanOrEqual(3);
    const before = (await invoke(attached.page, 'get_sessions')).find(session => session.id === id);
    await attached.browser.close(); attached = null;
    await closeOwned(first);

    const database = new DatabaseSync(path.join(data, 'workspace.sqlite3'), { readOnly: true });
    let saved;
    try {
      assert.equal(database.prepare('PRAGMA quick_check').get().quick_check, 'ok');
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sessions WHERE state = 'open'").get().count, 0, 'Clean shutdown must finalize every QA recording');
      saved = database.prepare('SELECT id, name, state FROM sessions WHERE id = ?').get(id);
      assert.equal(saved?.name, name);
      assert.equal(saved?.state, 'complete', 'An active recording must be completed on clean shutdown');
      assert(Number(database.prepare('SELECT COUNT(*) AS count FROM samples WHERE session_id = ?').get(id).count) >= before.samples);
    } finally { database.close(); }

    restarted = await launchNative('restart');
    attached = await attachOwned(restarted);
    attached.page.on('pageerror', error => result.pageErrors.push(String(error)));
    assert.equal(attached.state.active_session, null, 'Restart must not leave the closed recording active');
    assert.deepEqual(attached.state.preferences, preferences, 'Preferences must survive a real process restart');
    const sessions = await invoke(attached.page, 'get_sessions');
    for (const expected of result.sessions) {
      const session = sessions.find(row => row.id === expected.id);
      assert.equal(session?.name, expected.name);
      assert.equal(session?.state, 'complete');
      assert(session.samples >= (session.id === id ? before.samples : 4));
    }
    await attached.page.locator('.nav-item[data-route="settings"]').click();
    await expect(attached.page.locator('#settings-form [name="interval_ms"]')).toHaveValue(String(preferences.interval_ms));
    await expect(attached.page.locator('html')).toHaveAttribute('data-theme', preferences.theme_light ? 'light' : 'dark');
    await invoke(attached.page, 'save_preferences', { preferences: originalPreferences });
    await expect.poll(async () => (await invoke(attached.page, 'get_state')).preferences).toEqual(originalPreferences);
    const restartScreenshot = path.join(output, 'native-restarted-settings.png');
    await attached.page.screenshot({ path: restartScreenshot });
    result.screenshots.push(restartScreenshot);
    assert.equal(result.pageErrors.length, 0, 'Restarted WebView reported JavaScript errors');
    const details = { sessionId: id, recordedBeforeClose: before.samples, persistedSessions: result.sessions.length, quickCheck: 'ok', cleanExitCode: first.exitCode, restoredInterval: preferences.interval_ms, restoredThemeLight: preferences.theme_light };
    await attached.browser.close(); attached = null;
    await closeOwned(restarted);
    result.checks.push({ name: 'clean shutdown finalizes recording and restart restores SQLite sessions and preferences', passed: true, milliseconds: Date.now() - started, details });
    console.log(`PASS ${result.checks.at(-1).name}`);
  } catch (error) {
    result.checks.push({ name: 'clean shutdown finalizes recording and restart restores SQLite sessions and preferences', passed: false, milliseconds: Date.now() - started, error: String(error.stack || error) });
    result.passed = false;
    console.error(`FAIL ${result.checks.at(-1).name}`);
  } finally { await attached?.browser.close().catch(() => {}); }
}

let result;
try {
  const first = await launchNative('initial');
  result = await runNativeSmoke({ cdpUrl: first.cdp, outputDir: output, dataDir: data });
  if (result.passed) await verifyRestart(first, result);
} finally {
  for (const run of owned) {
    await closeOwned(run, false);
    await run.out.close(); await run.err.close();
  }
}
if (result) {
  result.finished = new Date().toISOString();
  result.passed = result.passed && result.checks.every(check => check.passed) && result.pageErrors.length === 0;
  await writeFile(path.join(output, 'native-smoke-report.json'), JSON.stringify(result, null, 2));
  await copyFile(path.join(output, 'native-smoke-report.json'), path.join(project, 'test-output', 'native-smoke-report.json'));
  await writeFile(path.join(project, 'test-output', 'latest-native-run.json'), JSON.stringify({ binary: path.relative(project, binary), output: path.relative(project, output), passed: result.passed }, null, 2));
  if (!result.passed) process.exitCode = 1;
  console.log(JSON.stringify({ passed: result.passed, checks: result.checks.length, report: path.relative(project, path.join(output, 'native-smoke-report.json')) }));
}
