#!/usr/bin/env node
/* Headless Edge screenshot + debug harness over the Chrome DevTools Protocol.
 * Usage:
 *   node tools/cdp_capture.js --out screenshots/x.png --wait 1200 [--eval "js"]
 *        [--after 1200] [--url file:///...] [--width 1440] [--height 900]
 */
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return fallback;
}

const outPath = path.resolve(ROOT, arg('out', 'screenshots/capture.png'));
const url = arg('url', 'file:///' + (ROOT + '/.tmp/scene-test.html').replace(/\\/g, '/'));
const width = parseInt(arg('width', '1440'), 10);
const height = parseInt(arg('height', '900'), 10);
const readyWait = parseInt(arg('ready-wait', '20000'), 10);
const waitMs = parseInt(arg('wait', '1200'), 10);
const afterMs = parseInt(arg('after', '1200'), 10);
const evalJs = arg('eval', '');
const port = 9400 + Math.floor(Math.random() * 200);
const profile = path.join(ROOT, '.tmp', 'edge-cdp-' + port);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.mkdirSync(profile, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForFetch(u, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(u);
      if (res.ok) return await res.json();
    } catch (_) { /* retry */ }
    await sleep(120);
  }
  throw new Error('DevTools endpoint did not start');
}

(async () => {
  const child = spawn(EDGE, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage',
    '--disable-features=Translate,MediaRouter',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--window-size=' + width + ',' + height,
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  let ws;
  const consoleLines = [];
  const errorLines = [];
  try {
    const pages = await waitForFetch('http://127.0.0.1:' + port + '/json/list');
    const page = pages.find((p) => p.type === 'page');
    if (!page) throw new Error('No page target');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
        consoleLines.push(msg.params.type + ': ' + text);
        if (msg.params.type === 'error' || msg.params.type === 'warning') errorLines.push(text);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        const text = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'exception';
        errorLines.push(String(text));
        consoleLines.push('EXCEPTION: ' + text);
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        errorLines.push(msg.params.entry.text);
      }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
      screenWidth: width, screenHeight: height
    });
    await send('Page.navigate', { url });
    await sleep(900);

    async function evaluate(expression, awaitPromise = false) {
      const r = await send('Runtime.evaluate', {
        expression, awaitPromise, returnByValue: true, userGesture: true
      });
      if (r.exceptionDetails) {
        throw new Error('Eval exception: ' + ((r.exceptionDetails.exception && (r.exceptionDetails.exception.description || r.exceptionDetails.exception.value)) || r.exceptionDetails.text));
      }
      return r.result ? r.result.value : undefined;
    }

    const started = Date.now();
    let ready = false;
    while (Date.now() - started < readyWait) {
      try {
        ready = await evaluate('!!window.__A4_READY__');
      } catch (_) { ready = false; }
      if (ready) break;
      await sleep(250);
    }
    const bootInfo = await evaluate(`(() => ({
      ready: !!window.__A4_READY__,
      status: (document.getElementById('boot-status')||{}).textContent || null,
      error: document.getElementById('webgl-error') ? !document.getElementById('webgl-error').hidden : false,
      bootPresent: !!document.getElementById('boot-screen')
    }))()`);
    console.log(JSON.stringify({ ready, bootInfo, elapsedMs: Date.now() - started }, null, 2));
    if (!ready) {
      console.log('NOT READY — console log:');
      console.log(consoleLines.join('\n'));
    }

    await sleep(waitMs);
    if (evalJs) {
      console.log('EVAL:', evalJs);
      try {
        const value = await evaluate(evalJs, true);
        console.log('EVAL_RESULT:', JSON.stringify(value));
      } catch (err) {
        console.error('EVAL_ERROR:', err.message);
        errorLines.push('EVAL_ERROR: ' + err.message);
      }
      await sleep(afterMs);
    }

    const stats = await evaluate(`window.__A4_DEBUG__ ? window.__A4_DEBUG__.getStats() : null`);
    const state = await evaluate(`window.__A4_DEBUG__ ? window.__A4_DEBUG__.state : null`);
    console.log('STATS:', JSON.stringify(stats, null, 2));
    console.log('STATE:', JSON.stringify(state, null, 2));
    if (errorLines.length) {
      console.log('CONSOLE_ERRORS:');
      console.log(errorLines.slice(0, 20).join('\n'));
    } else {
      console.log('CONSOLE_ERRORS: none');
    }
    if (consoleLines.length) {
      console.log('CONSOLE_TAIL:');
      console.log(consoleLines.slice(-12).join('\n'));
    }

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
    console.log('SCREENSHOT:', outPath, fs.statSync(outPath).size, 'bytes');
    ws.close();
    child.kill();
    await sleep(250);
    process.exit(errorLines.some((e) => !/GPU stall|GL Driver|Fallback/.test(e)) ? 2 : 0);
  } catch (err) {
    console.error(err && err.stack || err);
    if (ws) try { ws.close(); } catch (_) {}
    child.kill();
    process.exit(1);
  } finally {
    // best-effort cleanup of profile after the browser exits
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {} }, 1000);
  }
})();
