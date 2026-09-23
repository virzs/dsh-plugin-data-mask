/**
 * Print the composer card's own children, to find a deterministic marker.
 *
 * Usage: node scripts/check-composer-dom.mjs "http://127.0.0.1:3098/?token=..."
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = process.argv[2];
const CHROME = [
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((candidate) => existsSync(candidate));
const profileDir = mkdtempSync(join(tmpdir(), 'dsh-dom-'));
const port = 9341;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let version;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (response.ok) { version = await response.json(); break; }
  } catch { /* not up */ }
  await sleep(250);
}
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) { pending.get(message.id)?.(message); pending.delete(message.id); }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, (message) => (message.error ? reject(new Error(message.error.message)) : resolve(message.result)));
  socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: target }, sessionId);
await sleep(16000);

const result = await send('Runtime.evaluate', {
  expression: `(() => {
    const describe = (el, depth) => {
      const rect = el.getBoundingClientRect();
      const attrs = [...el.attributes]
        .filter((a) => a.name.startsWith('data-') || a.name === 'role')
        .map((a) => a.name + '=' + a.value.slice(0, 28));
      const out = '  '.repeat(depth) + el.tagName.toLowerCase()
        + (el.className ? '.' + String(el.className).slice(0, 34) : '')
        + ' [' + Math.round(rect.top) + '-' + Math.round(rect.bottom) + ']'
        + (attrs.length > 0 ? ' {' + attrs.join(' ') + '}' : '');
      const lines = [out];
      if (depth < 2) for (const child of el.children) lines.push(describe(child, depth + 1));
      return lines.join('\\n');
    };
    const field = document.querySelector('[data-composer-input]');
    if (field === null) return 'no composer field';
    // Every composer-owned data attribute, and which ancestors carry one.
    const markerNames = [...new Set([...document.querySelectorAll('*')]
      .flatMap((el) => [...el.attributes].map((a) => a.name))
      .filter((name) => name.startsWith('data-') && /composer|input|attachment|lexical|placeholder|phase|tool/.test(name)))];
    const ancestors = [];
    for (let node = field; node !== null && node !== document.body; node = node.parentElement) {
      ancestors.push({
        cls: String(node.className).slice(0, 40),
        rect: (() => { const r = node.getBoundingClientRect(); return Math.round(r.top) + '-' + Math.round(r.bottom); })(),
        markers: [...node.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name + '=' + a.value.slice(0, 24)),
      });
    }
    return 'MARKER NAMES: ' + markerNames.join(', ') + '\\n\\nFIELD ANCESTORS:\\n'
      + ancestors.map((a, i) => '  '.repeat(Math.min(i, 3)) + a.cls + ' [' + a.rect + '] ' + (a.markers.length > 0 ? JSON.stringify(a.markers) : '')).join('\\n');
  })()`,
  returnByValue: true,
}, sessionId);
console.log(result.result.value);

socket.close();
chrome.kill();
setTimeout(() => {
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* disposable */ }
}, 500);
