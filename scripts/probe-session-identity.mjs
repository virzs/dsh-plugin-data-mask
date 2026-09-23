/**
 * Find a usable Session identity signal in the DOM.
 *
 * Switching conversations reuses the composer node (the draft merely goes empty),
 * so `isConnected` cannot answer "is this still the same conversation?". This
 * probe compares the DOM before and after a switch and reports which attributes
 * actually changed, so ownership can be decided from a real signal.
 *
 * Usage: node scripts/probe-session-identity.mjs "http://127.0.0.1:3098/?token=..."
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
const profileDir = mkdtempSync(join(tmpdir(), 'dsh-id-'));
const port = 9348;
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
await sleep(17000);

const report = await send('Runtime.evaluate', {
  expression: `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // Snapshot the composer's ancestor chain: tag, class, and every data-* value.
    const chain = () => {
      const field = document.querySelector('[data-composer-input]');
      if (field === null) return 'no composer';
      const out = [];
      for (let node = field; node !== null && node !== document.body; node = node.parentElement) {
        const attrs = [...node.attributes]
          .filter((a) => a.name.startsWith('data-') || a.name === 'role' || a.name === 'key')
          .map((a) => a.name + '=' + a.value.slice(0, 40));
        out.push(node.tagName.toLowerCase() + '|' + String(node.className).slice(0, 30) + '|' + attrs.join(' '));
      }
      return out;
    };
    const rows = () => [...document.querySelectorAll('[data-row-key^="session:"]')];
    const selected = () => {
      const el = document.querySelector('[data-row-key^="session:"][class*="selected"]');
      return el === null ? null : el.getAttribute('data-row-key');
    };
    const byKey = (key) => document.querySelector('[data-row-key="' + key + '"]');

    const keys = rows().map((row) => row.getAttribute('data-row-key'));
    const firstKey = keys[1];
    const secondKey = keys[2];
    byKey(firstKey).click();
    await wait(3000);
    const before = { key: selected(), chain: chain(), hash: location.hash };

    byKey(secondKey).click();
    await wait(3000);
    const after = { key: selected(), chain: chain(), hash: location.hash };

    // Which lines differ?
    const diff = [];
    const max = Math.max(before.chain.length, after.chain.length);
    for (let i = 0; i < max; i += 1) {
      if (before.chain[i] !== after.chain[i]) diff.push({ depth: i, before: before.chain[i] ?? null, after: after.chain[i] ?? null });
    }

    // Also: does the shell mark the conversation root anywhere else?
    const markers = [...document.querySelectorAll('[data-session-id],[data-conversation-id],[data-session],[data-conversation]')]
      .slice(0, 8)
      .map((el) => ({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 30), attrs: [...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name + '=' + a.value) }));

    return { firstKey, secondKey, before: { key: before.key, hash: before.hash }, after: { key: after.key, hash: after.hash }, diff, markers };
  })()`,
  awaitPromise: true,
  returnByValue: true,
}, sessionId);
console.log(JSON.stringify(report.result.value, null, 2));

socket.close();
chrome.kill();
setTimeout(() => {
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* disposable */ }
}, 500);
