/**
 * Capture screenshots of the data-mask settings page, for visual review.
 *
 * Usage: node scripts/shoot-settings.mjs "http://127.0.0.1:3098/?token=..." [outDir]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = process.argv[2];
const outDir = process.argv[3] ?? 'E:/Projects/Work/MJK/dsh-plugin-data-mask/screenshots';
if (target === undefined) {
  console.error('usage: node scripts/shoot-settings.mjs <url> [outDir]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const CHROME = [
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((candidate) => existsSync(candidate));
const profileDir = mkdtempSync(join(tmpdir(), 'dsh-shot-'));
const port = 9338;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--force-device-scale-factor=1', '--window-size=1440,900', 'about:blank',
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: target }, sessionId);
await sleep(16000);

/** Write one full-page screenshot. */
async function shoot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  const path = join(outDir, `${name}.png`);
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  console.log(`wrote ${path}`);
}

/** Run an expression in the page. */
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

// 1. The composer with the notice after a masked paste.
await evaluate(`(async () => {
  const editor = document.querySelector('[contenteditable=""],[contenteditable="true"]');
  editor.focus();
  const data = new DataTransfer();
  data.setData('text/plain', '张三 13812345678 邮箱 zhangsan@example.com 收');
  editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  await new Promise((resolve) => setTimeout(resolve, 900));
})()`);
await shoot('01-composer-notice');

// 2. The settings page, reached from the sidebar foot.
const opened = await evaluate(`(async () => {
  const nodes = [...document.querySelectorAll('button,[role="button"],a')];
  const button = nodes.find((el) => (el.textContent ?? '').trim() === '设置');
  if (button === undefined) return 'no settings button';
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const row = [...document.querySelectorAll('button,[role="tab"],[role="button"],li,div')]
    .filter((el) => (el.textContent ?? '').trim() === '数据脱敏').pop();
  if (row === undefined) return 'no section row';
  row.click();
  await new Promise((resolve) => setTimeout(resolve, 900));
  return document.querySelector('.dsh-data-mask-section') !== null;
})()`);
console.log('settings section open:', opened);
await shoot('02-settings-top');

// 3. Scrolled down: rules, custom rules, live preview.
await evaluate(`(() => {
  const scroller = document.querySelector('.dsh-data-mask-section')?.closest('[class*="scroll"],[class*="content"]') ?? document.scrollingElement;
  const section = document.querySelector('.dsh-data-mask-section');
  const target = section?.querySelectorAll('.dsh-data-mask-row')[2];
  target?.scrollIntoView({ block: 'start' });
  return scroller !== null;
})()`);
await sleep(600);
await shoot('03-settings-rules');

// 4. The bottom of the page: custom rules and the live preview.
await evaluate(`(() => {
  const rows = document.querySelectorAll('.dsh-data-mask-row');
  rows[rows.length - 1]?.scrollIntoView({ block: 'end' });
})()`);
await sleep(600);
await shoot('04-settings-preview');

socket.close();
chrome.kill();
setTimeout(() => {
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {
    // disposable
  }
}, 500);
