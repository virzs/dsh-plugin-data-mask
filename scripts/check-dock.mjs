/**
 * Diagnose why a composer-dock entry is or is not rendered.
 *
 * Prints the DOM around the composer, which slots currently carry rendered
 * occupants, and whether the plugin's own stylesheet and registration landed.
 *
 * Usage: node scripts/check-dock.mjs "http://127.0.0.1:3099/?token=..."
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
const profileDir = mkdtempSync(join(tmpdir(), 'dsh-dock-'));
const port = 9335;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let version;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (response.ok) {
      version = await response.json();
      break;
    }
  } catch {
    // Not up yet.
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
await sleep(16000);

const report = await send('Runtime.evaluate', {
  expression: `(() => {
    const out = {};
    out.hasPluginStyle = document.getElementById('dsh-data-mask-style') !== null;
    out.styleBytes = document.getElementById('dsh-data-mask-style')?.textContent.length ?? 0;
    out.chip = document.querySelector('.dsh-data-mask-chip') !== null;
    const editable = document.querySelector('[contenteditable=""],[contenteditable="true"]');
    out.editable = editable !== null;
    if (editable !== null) {
      let node = editable;
      out.ancestors = [];
      for (let i = 0; i < 12 && node !== null; i += 1) {
        out.ancestors.push(node.tagName.toLowerCase() + (node.className ? '.' + String(node.className).slice(0, 60) : '') + ' children=' + String(node.children.length));
        node = node.parentElement;
      }
      const card = editable.closest('form') ?? editable.parentElement?.parentElement ?? null;
      out.cardHtmlTail = card === null ? null : card.outerHTML.slice(-1500);
    }
    out.bodyHasChipText = document.body.innerText.includes('脱敏');
    return out;
  })()`,
  returnByValue: true,
}, sessionId);
console.log(JSON.stringify(report.result.value, null, 2));

socket.close();
chrome.kill();
rmSync(profileDir, { recursive: true, force: true });
