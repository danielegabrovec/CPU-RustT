// Native WebView2 QA. This script attaches to an existing test instance and
// detaches afterwards; it never launches, closes or replaces the application.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { chromium, expect } from '@playwright/test';

const project = fileURLToPath(new URL('../', import.meta.url));
const inside = (file, directory) => {
  const relative = path.relative(path.resolve(directory), path.resolve(file));
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export async function runNativeSmoke({ cdpUrl = 'http://127.0.0.1:9223', outputDir = path.join(project, 'test-output'), dataDir = path.join(project, 'test-output', 'native-data') } = {}) {
  await mkdir(outputDir, { recursive: true });
  const report = { started: new Date().toISOString(), cdpUrl, checks: [], screenshots: [], sessions: [], files: [], pageErrors: [], skipped: [], passed: false };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let browser, page, originalPreferences;
  const readState = () => page.evaluate(() => window.__TAURI__.core.invoke('get_state'));
  const uiState = () => page.evaluate(() => window.__CPU_RUSTT_QA__.getState());
  const readSessions = () => page.evaluate(() => window.__TAURI__.core.invoke('get_sessions'));
  const navigate = async route => {
    await page.locator(`.nav-item[data-route="${route}"]`).click();
    await expect(page.locator('#content')).toHaveAttribute('data-route', route);
  };
  const screenshot = async name => {
    const file = path.join(outputDir, `native-${name}.png`);
    await page.screenshot({ path: file });
    report.screenshots.push(file);
  };
  const check = async (name, fn) => {
    const started = Date.now();
    try { const details = await fn(); report.checks.push({ name, passed: true, milliseconds: Date.now() - started, details }); }
    catch (error) {
      report.checks.push({ name, passed: false, milliseconds: Date.now() - started, error: String(error.stack || error) });
      if (page) await screenshot(`failure-${report.checks.length}`).catch(() => {});
    }
    console.log(`${report.checks.at(-1).passed ? 'PASS' : 'FAIL'} ${name}`);
  };
  const waitForNewFile = async (directory, before, predicate) => {
    let created;
    await expect.poll(async () => {
      created = (await readdir(directory)).find(name => !before.includes(name) && predicate(name));
      return Boolean(created);
    }, { timeout: 15000 }).toBe(true);
    const file = path.join(directory, created);
    assert(inside(file, dataDir), 'Generated file must stay inside the dedicated test data directory');
    if (file.endsWith('.json')) {
      await expect.poll(async () => { try { JSON.parse(await readFile(file, 'utf8')); return true; } catch { return false; } }, { timeout: 15000 }).toBe(true);
    }
    report.files.push(file);
    return file;
  };
  const saveInterval = async interval => {
    await navigate('settings');
    await page.locator('#settings-form [name="interval_ms"]').fill(String(interval));
    await page.locator('#settings-form button[type="submit"]').click();
    await expect.poll(async () => (await readState()).preferences.interval_ms).toBe(interval);
  };
  const recordSession = async suffix => {
    assert.equal((await readState()).active_session, null, 'A recording is already active');
    const name = `QA-native-${stamp}-${suffix}`;
    await page.locator('#record-button').click();
    await expect(page.locator('#action-dialog')).toBeVisible();
    await page.locator('#dialog-input').fill(name);
    await page.locator('#dialog-confirm').click();
    await expect.poll(async () => (await readState()).active_session, { timeout: 15000 }).not.toBeNull();
    const id = (await readState()).active_session;
    const row = (await readSessions()).find(session => session.id === id);
    assert.equal(row?.name, name, 'Only the newly created QA recording may be modified');
    report.sessions.push({ id, name });
    await expect.poll(async () => (await readSessions()).find(session => session.id === id)?.samples, { timeout: 15000 }).toBeGreaterThanOrEqual(4);
    return id;
  };
  const stopOwnSession = async () => {
    const id = (await readState()).active_session;
    assert(report.sessions.some(session => session.id === id), 'Refusing to stop a recording not created by this test');
    await expect.poll(async () => (await uiState()).active_session).toBe(id);
    await page.locator('#record-button').click();
    await expect.poll(async () => (await readState()).active_session).toBeNull();
    const saved = (await readSessions()).find(session => session.id === id);
    assert.equal(saved.state, 'complete');
    return saved;
  };
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    await expect.poll(() => {
      page = browser.contexts().flatMap(context => context.pages()).find(candidate => /tauri\.localhost/.test(candidate.url()));
      return Boolean(page);
    }, { timeout: 30000, message: 'Waiting for the native WebView to finish its initial about:blank navigation' }).toBe(true);
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => report.pageErrors.push(String(error)));
    await expect.poll(async () => page.evaluate(() => Boolean(window.__CPU_RUSTT_QA__?.getState()?.ready)).catch(() => false), { timeout: 20000 }).toBe(true);
    const initial = await readState();
    assert.equal(path.resolve(initial.database_path), path.join(path.resolve(dataDir), 'workspace.sqlite3'), 'Refusing mutations outside the dedicated native-smoke database');
    assert(inside(initial.export_dir, dataDir), 'Exports must use the dedicated test directory');
    assert.equal(initial.active_session, null, 'Close the existing test recording before running QA');
    originalPreferences = initial.preferences;
    report.browser = browser.version();
    report.database = initial.database_path;
    const logicalCores = initial.inventory.logical_cores;
    const gpuNames = initial.snapshot.gpus.map(gpu => gpu.name);
    report.hardware = { cpu: initial.inventory.cpu_name, physicalCores: initial.inventory.physical_cores, logicalCores: initial.inventory.logical_cores, gpus: initial.snapshot.gpus.map(gpu => ({ name: gpu.name, source: gpu.source, utilization: gpu.utilization })) };

    await check('native hardware and navigation', async () => {
      assert(logicalCores > 0);
      assert.equal(initial.snapshot.per_core.length, logicalCores);
      assert(initial.snapshot.gpus.every(gpu => gpu.utilization === null || (gpu.utilization >= 0 && gpu.utilization <= 100)));
      const routes = await page.locator('.nav-item').evaluateAll(items => items.map(item => ({ route: item.dataset.route, label: item.textContent.trim() })));
      assert.equal(routes.length, 14);
      assert(routes.some(item => item.route === 'analysis'));
      for (const { route, label } of routes) {
        await navigate(route);
        assert((await page.locator('#content').innerText()).trim().length > 40, `${label} has no content`);
        assert(!/undefined|\bNaN\b/.test(await page.locator('#content').innerText()), `${label} renders an invalid value`);
        await screenshot(route);
      }
      return { routes };
    });
    await check('process search, sorting and fixed detail', async () => {
      await navigate('processes');
      await page.locator('#process-search').fill('QA-no-such-process-5ec694');
      await expect(page.locator('#process-table [data-process]')).toHaveCount(0);
      await page.locator('#process-search').fill('');
      await page.locator('#process-sort').selectOption('Pid');
      if ((await page.locator('#process-order').innerText()).includes('Decrescente')) await page.locator('#process-order').click();
      const pids = await page.locator('#process-table [data-process]').evaluateAll(rows => rows.map(row => Number(row.dataset.process)));
      assert(pids.length > 0);
      assert.deepEqual(pids, [...pids].sort((a, b) => a - b));
      const pid = pids.find(value => value > 4) ?? pids[0];
      await page.locator('#process-search').fill(String(pid));
      await page.locator(`#process-table [data-process="${pid}"]`).click();
      await expect(page.locator('#process-detail')).toContainText(`PID ${pid}`);
      const detail = await page.locator('#process-detail').innerText();
      const prior = (await readState()).snapshot.timestamp_unix;
      await expect.poll(async () => (await readState()).snapshot.timestamp_unix).toBeGreaterThan(prior);
      assert.equal(await page.locator('#process-detail').innerText(), detail);
      await screenshot('process-detail');
      await page.locator('[data-action="close-process"]').click();
      await page.locator('#process-search').fill('');
      return { count: pids.length, selectedPid: pid };
    });
    await check('pause freezes only the view', async () => {
      await navigate('overview');
      await page.locator('#pause-button').click();
      const frozen = await page.evaluate(() => window.__CPU_RUSTT_QA__.getView().snapshot.timestamp_unix);
      await expect.poll(async () => (await readState()).snapshot.timestamp_unix, { timeout: 15000 }).toBeGreaterThan(frozen + 1);
      assert.equal(await page.evaluate(() => window.__CPU_RUSTT_QA__.getView().snapshot.timestamp_unix), frozen);
      await expect(page.locator('#global-banner')).toContainText('Vista in pausa');
      await screenshot('paused');
      await page.locator('#pause-button').click();
      await expect.poll(() => page.evaluate(() => window.__CPU_RUSTT_QA__.getView().snapshot.timestamp_unix)).toBeGreaterThan(frozen);
      return { frozenTimestamp: frozen, backendTimestamp: (await readState()).snapshot.timestamp_unix };
    });
    await check('paused export preserves the visible sample', async () => {
      await navigate('overview');
      await page.locator('#pause-button').click();
      const frozen = await page.evaluate(() => window.__CPU_RUSTT_QA__.getView().snapshot);
      await expect.poll(async () => (await readState()).snapshot.timestamp_unix, { timeout: 15000 }).toBeGreaterThan(frozen.timestamp_unix + 1);
      const exportDir = (await readState()).export_dir;
      const before = await readdir(exportDir).catch(() => []);
      await page.locator('#export-button').click();
      const file = await waitForNewFile(exportDir, before, name => name.startsWith('hardware-') && name.endsWith('.json'));
      const exported = JSON.parse(await readFile(file, 'utf8'));
      assert.equal(exported.snapshot.timestamp_unix, frozen.timestamp_unix);
      assert.equal(Math.fround(exported.snapshot.cpu_percent), Math.fround(frozen.cpu_percent));
      await page.locator('#pause-button').click();
      return { file, visibleTimestamp: frozen.timestamp_unix, exportedTimestamp: exported.snapshot.timestamp_unix };
    });
    await check('preferences persist 500 ms and restore 1000 ms', async () => {
      await saveInterval(500);
      await expect(page.locator('#settings-form [name="interval_ms"]')).toHaveValue('500');
      await screenshot('settings-500');
      await saveInterval(1000);
      return { interval: (await readState()).preferences.interval_ms };
    });
    await check('record QA session and explicitly confirm one CPU benchmark', async () => {
      const id = await recordSession('A');
      await navigate('cpu');
      await page.locator('#cpu-repeats').selectOption('1');
      const before = new Set((await readState()).benchmarks.map(item => item.id));
      await page.locator('[data-action="cpu-benchmark"]').click();
      await expect(page.locator('#action-dialog')).toBeVisible();
      await expect(page.locator('#dialog-title')).toHaveText('Avvia benchmark CPU');
      await expect(page.locator('#dialog-description')).toContainText('1 prove');
      await page.locator('#dialog-confirm').click();
      await expect.poll(async () => (await readState()).benchmarks.some(item => item.kind === 'cpu' && !before.has(item.id)), { timeout: 30000 }).toBe(true);
      await expect.poll(async () => (await readState()).benchmark_running, { timeout: 10000 }).toBe(false);
      const benchmark = (await readState()).benchmarks.find(item => item.kind === 'cpu' && !before.has(item.id));
      assert.equal(benchmark.session_id, id);
      assert(benchmark.cpu.single_ops_per_sec > 0 && benchmark.cpu.multi_ops_per_sec > 0);
      await screenshot('cpu-benchmark');
      const saved = await stopOwnSession();
      return { session: saved, benchmark };
    });
    await check('record second QA session', async () => {
      await recordSession('B');
      return await stopOwnSession();
    });
    await check('replay and scrub recorded samples', async () => {
      assert.equal(report.sessions.length, 2);
      await navigate('sessions');
      const id = report.sessions[0].id;
      await page.locator(`[data-session-action="replay"][data-id="${id}"]`).click();
      await expect(page.locator('#replay-banner')).toBeVisible();
      const before = await page.evaluate(() => window.__CPU_RUSTT_QA__.getView().snapshot.elapsed_secs);
      await page.locator('#replay-slider').focus();
      await page.locator('#replay-slider').press('End');
      await expect.poll(() => page.evaluate(() => window.__CPU_RUSTT_QA__.getView().snapshot.elapsed_secs)).toBeGreaterThan(before);
      await navigate('cpu');
      const view = await page.evaluate(() => window.__CPU_RUSTT_QA__.getView());
      const limitations = (view.snapshot.warnings || []).filter(value => /replay|storico|riepilog|thread/i.test(value));
      await screenshot('replay-cpu');
      await page.locator('#replay-live').click();
      await expect(page.locator('#replay-banner')).toBeHidden();
      return { sessionId: id, perCoreCount: view.snapshot.per_core.length, warnings: limitations };
    });
    await check('compare both QA sessions', async () => {
      assert.equal(report.sessions.length, 2);
      await navigate('compare');
      await page.locator('#compare-left').selectOption(String(report.sessions[0].id));
      await page.locator('#compare-right').selectOption(String(report.sessions[1].id));
      await expect(page.locator('#compare-left')).toHaveValue(String(report.sessions[0].id));
      await expect(page.locator('#compare-right')).toHaveValue(String(report.sessions[1].id));
      await page.locator('#compare-form button[type="submit"]').click();
      await expect(page.getByRole('heading', { name: 'Differenze fra sessioni', exact: true })).toBeVisible();
      await expect(page.locator('#content')).toContainText('Delta B − A');
      await screenshot('comparison');
    });
    await check('export hardware and session JSON through UI', async () => {
      const exportDir = (await readState()).export_dir;
      await mkdir(exportDir, { recursive: true });
      let before = await readdir(exportDir);
      await page.locator('#export-button').click();
      const hardwareFile = await waitForNewFile(exportDir, before, name => name.startsWith('hardware-') && name.endsWith('.json'));
      const hardware = JSON.parse(await readFile(hardwareFile, 'utf8'));
      assert.equal(hardware.schema_version, 1);
      assert.equal(hardware.inventory.logical_cores, logicalCores);
      assert(hardware.snapshot.timestamp_unix > 0);
      await navigate('sessions');
      before = await readdir(exportDir);
      await page.locator(`[data-session-action="export"][data-id="${report.sessions[0].id}"]`).click();
      const sessionFile = await waitForNewFile(exportDir, before, name => name.startsWith(`sessione-${report.sessions[0].id}-`) && name.endsWith('.json'));
      const exported = JSON.parse(await readFile(sessionFile, 'utf8'));
      assert.equal(exported.format_version, 1);
      assert(exported.samples?.length >= 4);
      return { hardwareFile, sessionFile, exportedSamples: exported.samples.length };
    });
    await check('backup creates a valid SQLite database', async () => {
      const exportDir = (await readState()).export_dir;
      const before = await readdir(exportDir);
      await page.locator('[data-action="backup"]').first().click();
      const file = await waitForNewFile(exportDir, before, name => name.endsWith('.sqlite3'));
      // The destination can exist before SQLite finishes copying pages. Assert
      // the user's completion feedback before inspecting the finished artifact.
      await expect(page.locator('#toast')).toContainText('Backup SQLite salvato', { timeout: 15000 });
      assert.equal((await readFile(file)).subarray(0, 16).toString(), 'SQLite format 3\0');
      const database = new DatabaseSync(file, { readOnly: true });
      try {
        assert.equal(database.prepare('PRAGMA quick_check').get().quick_check, 'ok');
        const names = database.prepare('SELECT name FROM sessions WHERE name LIKE ?').all(`QA-native-${stamp}-%`).map(row => row.name);
        assert.equal(names.length, 2);
        return { file, quickCheck: 'ok', qaSessions: names };
      } finally { database.close(); }
    });
    await check('chart keyboard, pointer inspection and CPU/GPU selection', async () => {
      await navigate('cpu');
      const frame = page.locator('.chart-frame').first();
      await expect(frame).toBeVisible();
      await frame.focus();
      await frame.press('Home');
      await expect(frame.locator('.chart-tooltip')).toContainText('Campione 1 /');
      await frame.press('End');
      await expect(frame.locator('.chart-tooltip')).toBeVisible();
      await expect(frame.locator('.chart-cursor')).toBeVisible();
      await frame.press('ArrowLeft');
      const box = await frame.boundingBox();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
      await expect(frame.locator('.chart-tooltip')).toBeVisible();
      await screenshot('chart-hover');
      await expect(page.locator('#cpu-series option')).toHaveCount(logicalCores + 1);
      await page.locator('#cpu-series').selectOption('0');
      await expect(page.locator('#cpu-series')).toHaveValue('0');
      await expect(page.locator('.chart-frame').first()).toHaveAttribute('aria-label', /thread 1/i);
      await screenshot('cpu-thread-1');
      await page.locator('#cpu-series').selectOption(String(logicalCores - 1));
      await expect(page.locator('.chart-frame').first()).toHaveAttribute('aria-label', new RegExp(`thread ${logicalCores}\\b`, 'i'));
      await page.locator('#cpu-series').selectOption('total');
      await navigate('gpu');
      if (gpuNames.length) {
        await expect(page.locator('#gpu-adapter option')).toHaveCount(gpuNames.length + 1);
        for (let index = 0; index < gpuNames.length; index++) {
          await page.locator('#gpu-adapter').selectOption(String(index));
          await expect(page.locator('#content')).toContainText(gpuNames[index]);
          await expect(page.locator('.chart-frame')).toHaveCount(3);
        }
        const memoryChart = page.locator('.chart-frame').nth(1);
        await memoryChart.focus();
        await memoryChart.press('End');
        await expect(memoryChart.locator('.chart-tooltip')).toContainText('Memoria dedicata');
        await screenshot('gpu-selected');
        await page.locator('#gpu-adapter').selectOption('all');
        await expect(page.locator('.chart-frame')).toHaveCount(3 * gpuNames.length);
      } else {
        await expect(page.locator('.chart-frame')).toHaveCount(0);
      }
    });
    await check('native Rust statistics match complete session JSON and SQLite', async () => {
      await navigate('analysis');
      await expect(page.locator('#analysis-source')).toBeVisible();
      await page.locator('#analysis-window').selectOption('60');
      await page.locator('#analysis-refresh').click();
      await expect(page.locator('#analysis-metric')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Statistiche per ogni risorsa', exact: true })).toBeVisible();
      await screenshot('analysis-live');
      const id = report.sessions[0].id;
      await page.locator('#analysis-source').selectOption(String(id));
      await page.locator('#analysis-window').selectOption('all');
      await page.locator('#analysis-refresh').click();
      await expect(page.locator('#analysis-source')).toHaveValue(String(id));
      await expect(page.locator('#analysis-refresh')).toBeEnabled();
      const sessionFile = report.files.find(file => path.basename(file).startsWith(`sessione-${id}-`));
      assert(sessionFile, 'Session export is required for independent statistics verification');
      const exported = JSON.parse(await readFile(sessionFile, 'utf8'));
      assert(exported.samples.every(sample => sample.per_core.length === logicalCores));
      const database = new DatabaseSync(report.database, { readOnly: true });
      let sqliteSamples;
      try { sqliteSamples = Number(database.prepare('SELECT COUNT(*) AS count FROM samples WHERE session_id = ?').get(id).count); }
      finally { database.close(); }
      const analysis = await page.evaluate(sessionId => window.__TAURI__.core.invoke('analyze_data', { sessionId, windowSeconds: null }), id);
      assert.equal(analysis.samples, sqliteSamples);
      assert.equal(analysis.samples, exported.samples.length);
      assert.equal(analysis.metrics.filter(metric => /^cpu\.core\.\d+$/.test(metric.id)).length, logicalCores);
      const cpu = analysis.metrics.find(metric => metric.id === 'cpu.total').statistics;
      // JSON decimal values originate from Rust f32; reconstruct that precision
      // before the independent JS arithmetic used as the reference.
      const values = exported.samples.map(sample => Math.fround(sample.cpu_percent));
      const sorted = [...values].sort((a, b) => a - b);
      const expected = { mean: values.reduce((sum, value) => sum + value, 0) / values.length, min: sorted[0], max: sorted.at(-1), p95: sorted[Math.ceil(sorted.length * .95) - 1] };
      for (const key of Object.keys(expected)) assert(Math.abs(cpu[key] - expected[key]) < 1e-9, `${key}: Rust ${cpu[key]} versus independent JS ${expected[key]}`);
      assert.equal(cpu.count, sqliteSamples);
      assert.equal(cpu.missing, 0);
      await page.locator('#analysis-metric').selectOption('cpu.core.0');
      await expect(page.locator('.chart-frame')).toBeVisible();
      await screenshot('analysis-recorded');
      return { sessionId: id, sqliteSamples, exportedSamples: exported.samples.length, reportSamples: analysis.samples, logicalCoreMetrics: logicalCores, expectedCpu: expected, actualCpu: cpu };
    });
    await check('export complete analysis JSON through UI', async () => {
      const exportDir = (await readState()).export_dir;
      const before = await readdir(exportDir);
      await page.locator('[data-action="export-analysis"]').click();
      const file = await waitForNewFile(exportDir, before, name => name.startsWith('analisi-') && name.endsWith('.json'));
      const exported = JSON.parse(await readFile(file, 'utf8'));
      const source = JSON.parse(await readFile(report.files.find(candidate => path.basename(candidate).startsWith(`sessione-${report.sessions[0].id}-`)), 'utf8'));
      assert.equal(exported.samples, source.samples.length);
      assert(exported.metrics.find(metric => metric.id === 'cpu.total').statistics.count === source.samples.length);
      return { file, samples: exported.samples, metrics: exported.metrics.length };
    });
    await check('problem analysis and optional read-only Windows events', async () => {
      await navigate('diagnostics');
      await page.locator('#diagnostics-window').selectOption('all');
      await page.locator('#diagnostics-refresh').click();
      await expect(page.getByRole('heading', { name: 'Risultato dei controlli', exact: true })).toBeVisible();
      const diagnostics = await page.evaluate(() => window.__TAURI__.core.invoke('get_diagnostics', { sessionId: null, windowSeconds: null }));
      assert(diagnostics.samples > 0);
      assert(Array.isArray(diagnostics.findings));
      assert(diagnostics.findings.every(finding => ['error', 'warning', 'info'].includes(finding.severity) && finding.evidence && finding.recommendation));
      await screenshot('diagnostics-analysis');
      const beforeTimestamp = (await readState()).snapshot.timestamp_unix;
      await page.locator('[data-action="scan-system-events"]').click();
      const heading = page.getByRole('heading', { name: 'Eventi di sistema Windows', exact: true });
      await expect(heading).toBeVisible({ timeout: 15000 });
      const panel = heading.locator('xpath=ancestor::section[1]');
      const eventCount = await panel.locator('tbody tr').count();
      const emptyTable = await panel.locator('tbody tr td[colspan]').count();
      const actualEventCount = emptyTable ? 0 : eventCount;
      assert(actualEventCount <= 100);
      const warnings = await panel.locator('.warning-text').allTextContents();
      await expect.poll(async () => (await readState()).snapshot.timestamp_unix).toBeGreaterThan(beforeTimestamp);
      await screenshot('system-events');
      // Keep event messages out of the report and terminal; only local screenshot
      // evidence contains the table the user can inspect in the application.
      return { samples: diagnostics.samples, findings: diagnostics.findings.length, severities: Object.fromEntries(['error', 'warning', 'info'].map(level => [level, diagnostics.findings.filter(finding => finding.severity === level).length])), eventCount: actualEventCount, warnings };
    });
    await check('light and dark theme', async () => {
      await navigate('overview');
      await page.locator('#theme-button').click();
      await expect.poll(async () => (await readState()).preferences.theme_light).toBe(!originalPreferences.theme_light);
      await screenshot('theme-alternate');
      await page.locator('#theme-button').click();
      await expect.poll(async () => (await readState()).preferences.theme_light).toBe(originalPreferences.theme_light);
    });
    await check('release author, version and embedded third-party licenses', async () => {
      const metadata = await page.evaluate(async () => {
        const info = await window.__TAURI__.core.invoke('app_info');
        return { name: info.name, version: info.version, author: info.author, copyright: info.copyright,
          license: info.license, noticesLength: info.third_party_notices.length };
      });
      const packageMetadata = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
      assert.equal(metadata.name, 'CPU-RustT');
      assert.equal(metadata.version, packageMetadata.version);
      assert.equal(metadata.author, 'Daniele Gabrovec');
      assert(metadata.copyright.includes('Daniele Gabrovec'));
      assert.equal(metadata.license, 'MIT');
      assert(metadata.noticesLength > 10000);
      await page.locator('#about-button').click();
      await expect(page.locator('#about-dialog')).toBeVisible();
      await expect(page.locator('#about-dialog')).toContainText('Daniele Gabrovec');
      await expect(page.locator('#about-dialog')).toContainText(packageMetadata.version);
      await screenshot('about');
      await page.locator('#about-close').click();
      await expect(page.locator('#about-dialog')).not.toBeVisible();
      return metadata;
    });
    assert.equal(report.pageErrors.length, 0, 'WebView reported JavaScript errors');
  } catch (error) {
    report.fatal = String(error.stack || error);
  } finally {
    if (page && originalPreferences) {
      try {
        if (await page.locator('#action-dialog[open]').count()) await page.locator('#dialog-cancel').click();
        if (await page.locator('#replay-live').count()) await page.locator('#replay-live').click();
        const active = (await readState()).active_session;
        if (active !== null && report.sessions.some(session => session.id === active)) await stopOwnSession();
        if ((await readState()).preferences.interval_ms !== originalPreferences.interval_ms) await saveInterval(originalPreferences.interval_ms);
        if ((await readState()).preferences.theme_light !== originalPreferences.theme_light) { await page.locator('#theme-button').click(); await expect.poll(async () => (await readState()).preferences.theme_light).toBe(originalPreferences.theme_light); }
        if ((await page.locator('#pause-button').innerText()).includes('Riprendi')) await page.locator('#pause-button').click();
        await navigate('overview');
      } catch (error) { report.cleanupError = String(error.stack || error); }
    }
    report.finished = new Date().toISOString();
    report.passed = !report.fatal && !report.cleanupError && report.checks.length > 0 && report.checks.every(check => check.passed) && report.pageErrors.length === 0;
    await writeFile(path.join(outputDir, 'native-smoke-report.json'), JSON.stringify(report, null, 2));
    // Playwright closes only its CDP connection for an attached browser.
    await browser?.close();
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runNativeSmoke();
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, skipped: report.skipped, report: path.join(project, 'test-output', 'native-smoke-report.json') }));
  if (!report.passed) process.exitCode = 1;
}
