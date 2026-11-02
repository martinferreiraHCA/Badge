#!/usr/bin/env node
/* Headless smoke test with Playwright: loads the app, visits every page,
   exercises each creative mode, builds an AVI, paints pixels, plays a game
   and takes screenshots into dist/screenshots. */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

(async () => {
  const port = 8765;
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(port)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const shots = path.join(__dirname, '..', 'dist', 'screenshots'); fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const url = 'http://localhost:' + port + '/index.html';
  try {
    await page.goto(url + '#home', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(shots, '01-home.png') });
    const go = async (p) => { await page.evaluate((h) => { location.hash = h; }, p); await page.waitForTimeout(350); };
    await go('studio');
    const modes = ['pattern', 'text', 'qr', 'clock', 'image', 'gif', 'video', 'sequence'];
    for (const m of modes) { await page.click('#modeTabs [data-mode="' + m + '"]'); await page.waitForTimeout(250); }
    await page.click('#modeTabs [data-mode="text"]');
    await page.fill('#inspectorBody textarea', 'BADGE STUDIO\nHOLA');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, '02-studio-text.png') });
    await page.click('#modeTabs [data-mode="pattern"]');
    await page.selectOption('#exDuration', '2'); await page.selectOption('#exFps', '5');
    await page.click('#buildAvi');
    await page.waitForFunction(() => !document.getElementById('downloadAvi').disabled, null, { timeout: 60000 });
    const meta = await page.textContent('#preparedMeta');
    console.log('AVI preparado:', meta);
    await page.click('#modeTabs [data-mode="qr"]'); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, '03-studio-qr.png') });
    await go('pixel');
    const box = await page.locator('#pixelCanvas').boundingBox();
    await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 200, box.y + 180, { steps: 12 }); await page.mouse.up();
    await page.click('#addFrame'); await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(shots, '04-pixel.png') });
    await go('arcade');
    await page.click('#startGame'); await page.waitForTimeout(400);
    const s = await page.locator('#stage').boundingBox();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down(); await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2 - 80, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(shots, '05-arcade.png') });
    await go('materials'); await page.waitForTimeout(800); await page.screenshot({ path: path.join(shots, '06-materials.png') });
    await go('library'); await page.waitForTimeout(300);
    await go('device'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, '07-device.png') });
    await go('settings'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, '08-settings.png') });
    await page.setViewportSize({ width: 390, height: 844 }); await go('studio'); await page.waitForTimeout(400); await page.screenshot({ path: path.join(shots, '09-mobile-studio.png') });
    /* ---- end-to-end against the simulated badge injected into the page ---- */
    const simSrc = fs.readFileSync(path.join(__dirname, '..', 'tests', 'helpers', 'sim-badge.js'), 'utf8').replace("const BS = globalThis.BS;", '').replace(/module\.exports[^;]*;/, '');
    const page2 = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    page2.on('pageerror', (e) => errors.push('sim pageerror: ' + e.message));
    await page2.addInitScript({ content: 'window.__simReady = () => { const BS = window.BS; ' + simSrc + ' const badge = new SimBadge({ name: "E01-SIM" }); badge.files = ["OLD001.AVI", "OLD002.AVI"]; window.__badge = badge; return new FakeBluetooth(badge); };' });
    await page2.addInitScript({ content: 'Object.defineProperty(window, "__badgeBluetooth", { get() { if (!window.__bt && window.BS) window.__bt = window.__simReady(); return window.__bt; } });' });
    await page2.goto(url + '#device', { waitUntil: 'load' }); await page2.waitForTimeout(400);
    await page2.click('#deviceConnect');
    await page2.waitForFunction(() => document.getElementById('deviceStatus').textContent.includes('listo'), null, { timeout: 10000 });
    await page2.waitForFunction(() => document.querySelectorAll('#deviceFiles .file-card').length === 2, null, { timeout: 10000 });
    console.log('Simulado: conectado, archivos listados:', await page2.textContent('#deviceFilesTitle'));
    page2.on('dialog', (d) => d.accept());
    await page2.click('#deviceFiles [data-delete-file="0"]');
    await page2.waitForFunction(() => document.querySelectorAll('#deviceFiles .file-card').length === 1, null, { timeout: 10000 });
    console.log('Simulado: borrado OK, quedan', await page2.evaluate(() => window.__badge.files.join(',')));
    await page2.evaluate(() => { location.hash = 'studio'; }); await page2.waitForTimeout(400);
    await page2.selectOption('#exDuration', '2'); await page2.selectOption('#exFps', '5'); await page2.click('#buildAvi');
    await page2.waitForFunction(() => !document.getElementById('sendBadge').disabled, null, { timeout: 60000 });
    await page2.click('#sendBadge'); await page2.waitForTimeout(200); await page2.click('#confirmSend');
    await page2.waitForFunction(() => document.getElementById('transferPercent').textContent.startsWith('100'), null, { timeout: 30000 });
    const sent = await page2.evaluate(() => ({ files: window.__badge.files, size: window.__badge.received.size, ok: window.__badge.received.data.length === window.__badge.received.size }));
    console.log('Simulado: envío completo', JSON.stringify(sent));
    if (!sent.files.includes('BADGE001.AVI') || !sent.ok) throw new Error('El envío simulado no terminó como se esperaba');
    await page2.waitForFunction(() => document.querySelectorAll('#deviceFiles .file-card').length === 2, null, { timeout: 10000 });
    await page2.screenshot({ path: path.join(shots, '11-device-connected.png') });
    await page2.click('#diagBtn'); await page2.waitForFunction(() => document.querySelectorAll('#diagResult div').length >= 5, null, { timeout: 20000 });
    await page2.screenshot({ path: path.join(shots, '12-device-diagnostics.png') });
    await page2.close();
    const dist = path.join(__dirname, '..', 'dist', 'badge-studio.html');
    if (fs.existsSync(dist)) { await page.setViewportSize({ width: 1360, height: 900 }); await page.goto('file://' + dist + '#studio'); await page.waitForTimeout(600); await page.screenshot({ path: path.join(shots, '10-single-file.png') }); }
  } finally {
    await browser.close(); server.kill();
  }
  const real = errors.filter((e) => !/favicon|manifest|serviceWorker|sw\.js|apple-touch|icon-192/i.test(e));
  if (real.length) { console.error('Errores detectados:\n' + real.join('\n')); process.exit(1); }
  console.log('Smoke test OK · capturas en dist/screenshots');
})().catch((e) => { console.error(e); process.exit(1); });
