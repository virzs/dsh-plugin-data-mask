/**
 * Print what the Web GUI currently shows, for triage when a selector is absent.
 *
 * Usage: node scripts/check-page.mjs "http://127.0.0.1:3098/?token=..."
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
const profileDir = mkdtempSync(join(tmpdir(), 'dsh-page-'));
const port = 9336;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let version;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (response.ok) {
      version = await response.json();
      break;
    }
  } catch {
    // not up yet
  }
  await sleep(250);
}
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  }
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
await send('Page.navigate', { url: target }, sessionId);
await sleep(17000);

const info = await send('Runtime.evaluate', {
  expression: `(() => ({
    url: location.href.replace(/token=[^&]+/, 'token=***'),
    editableCount: document.querySelectorAll('[contenteditable=""],[contenteditable="true"]').length,
    composerInput: document.querySelectorAll('[data-composer-input]').length,
    hasBootOverlay: document.querySelector('[data-dsh-boot]') !== null,
    chipCount: document.querySelectorAll('.dsh-data-mask-chip').length,
    pluginStyle: document.getElementById('dsh-data-mask-style') !== null,
    text: document.body.innerText.slice(0, 900),
    inputs: [...document.querySelectorAll('input,textarea')].slice(0, 6).map((el) => el.tagName + ':' + (el.getAttribute('placeholder') ?? el.type)),
  }))()`,
  returnByValue: true,
}, sessionId);
console.log(JSON.stringify(info.result.value, null, 2));

socket.close();
chrome.kill();
try {
  rmSync(profileDir, { recursive: true, force: true });
} catch {
  // disposable
}
