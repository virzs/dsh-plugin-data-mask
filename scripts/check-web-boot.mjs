/**
 * Load the Web GUI in headless Chrome and report what the page console said.
 *
 * The boot gate reports "import failed (see console for the import error)", so
 * the only authoritative source for a client-half failure is the browser
 * console. This driver boots a throwaway profile's Web UI in headless Chrome
 * over the DevTools Protocol, captures console messages, page errors, and
 * failed requests, and prints them.
 *
 * Usage: node scripts/check-web-boot.mjs "http://127.0.0.1:3099/?token=..."
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = process.argv[2];
if (target === undefined) {
  console.error('usage: node scripts/check-web-boot.mjs <url>');
  process.exit(2);
}

const CHROME = [
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((candidate) => existsSync(candidate));
if (CHROME === undefined) {
  console.error('no Chromium-based browser found');
  process.exit(2);
}

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-headless-'));
const port = 9333;
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-gpu',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until the DevTools HTTP endpoint answers. */
async function waitForDevTools() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      // Not listening yet.
    }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

const version = await waitForDevTools();
const browserSocket = version.webSocketDebuggerUrl;

/** One CDP connection to the browser endpoint, with routed events. */
const events = [];
const pending = new Map();
let nextId = 0;
const socket = new WebSocket(browserSocket);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
    return;
  }
  events.push(message);
});

/** Send one CDP command. */
function send(method, params = {}, sessionId) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, (message) => {
      if (message.error !== undefined) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
  });
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

await send('Runtime.enable', {}, sessionId);
await send('Log.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);
await send('Page.navigate', { url: target }, sessionId);

// The boot gate resolves after every entry settles; give it room.
await sleep(15000);

const collected = events
  .filter((event) => event.sessionId === sessionId)
  .map((event) => {
    const { method, params } = event;
    if (method === 'Runtime.consoleAPICalled') {
      const text = (params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? arg.unserializableValue ?? JSON.stringify(arg.preview ?? {}))
        .join(' ');
      return `[console.${params.type}] ${text}`;
    }
    if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails;
      return `[exception] ${details.text} ${details.exception?.description ?? ''} @ ${details.url ?? ''}:${details.lineNumber ?? ''}`;
    }
    if (method === 'Log.entryAdded') return `[log.${params.entry.level}] ${params.entry.text} ${params.entry.url ?? ''}`;
    if (method === 'Network.loadingFailed') return `[net-fail] ${params.errorText} ${params.type}`;
    if (method === 'Network.responseReceived' && params.response.status >= 400) {
      return `[http ${params.response.status}] ${params.response.url}`;
    }
    return null;
  })
  .filter((line) => line !== null);

console.log(collected.length === 0 ? '(no console output captured)' : collected.join('\n'));

// What the page itself shows, when the boot gate gave up.
try {
  const html = await send('Runtime.evaluate', {
    expression: 'document.body ? document.body.innerText.slice(0, 1200) : "(no body)"',
    returnByValue: true,
  }, sessionId);
  console.log('\n--- visible page text ---\n' + String(html.result.value));
} catch (error) {
  console.log('\n(could not read page text: ' + error.message + ')');
}

socket.close();
chrome.kill();
try {
  rmSync(profileDir, { recursive: true, force: true });
} catch {
  // The temporary profile is disposable.
}
