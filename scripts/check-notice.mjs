/**
 * Verify the three reported notice defects are fixed, in a real browser.
 *
 * 1. the notice sits ABOVE the composer card (not over the input field)
 * 2. holding 按住查看原文 swaps the COMPOSER to the original, and release restores
 * 3. the notice does not follow the user into another conversation
 *
 * Usage: node scripts/check-notice.mjs "http://127.0.0.1:3098/?token=..."
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = process.argv[2];
if (target === undefined) {
  console.error('usage: node scripts/check-notice.mjs <url>');
  process.exit(2);
}
const CHROME = [
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((candidate) => existsSync(candidate));
const profileDir = mkdtempSync(join(tmpdir(), 'dsh-notice-'));
const port = 9339;
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
const consoleLines = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) { pending.get(message.id)?.(message); pending.delete(message.id); return; }
  if (message.method === 'Runtime.consoleAPICalled') {
    consoleLines.push('[' + message.params.type + '] ' + (message.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleLines.push('[exception] ' + message.params.exceptionDetails.text + ' ' + (message.params.exceptionDetails.exception?.description ?? ''));
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

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const results = [];
const record = (name, value) => {
  results.push(`${value === true ? 'PASS' : value === false ? 'FAIL' : 'INFO'}  ${name}${typeof value === 'string' ? `: ${value}` : ''}`);
};

// A multi-line paste, like the report's.
const setup = await evaluate(`(async () => {
  const editor = document.querySelector('[data-composer-input]');
  if (editor === null) return 'no composer';
  editor.focus();
  const sample = '{\\n  "phone": "13812345678",\\n  "email": "zhangsan@example.com"\\n}';
  const data = new DataTransfer();
  data.setData('text/plain', sample);
  editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const card = editor.closest('[data-composer-card]');
  const overlay = document.querySelector('.dsh-data-mask-overlay');
  if (card === null || overlay === null) return { card: card !== null, overlay: overlay !== null };
  const cardRect = card.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const fieldRect = editor.getBoundingClientRect();
  return {
    draft: editor.textContent,
    card: { top: Math.round(cardRect.top), bottom: Math.round(cardRect.bottom) },
    overlay: { top: Math.round(overlayRect.top), bottom: Math.round(overlayRect.bottom) },
    field: { top: Math.round(fieldRect.top), bottom: Math.round(fieldRect.bottom) },
    overlapsCard: overlayRect.bottom > cardRect.top && overlayRect.top < cardRect.bottom,
    overlapsField: overlayRect.bottom > fieldRect.top && overlayRect.top < fieldRect.bottom,
  };
})()`);
if (typeof setup === 'object') {
  // A JSON payload's sensitive fields are labelled by FIELD name, so the labels
  // are 手机号/邮箱 rather than the value-shaped 手机号/固话.
  const maskedByField = setup.draft.includes('"phone": "手机号"') && setup.draft.includes('"email": "邮箱"');
  record('multi-line paste was masked', maskedByField && !setup.draft.includes('13812345678') ? `"${setup.draft.replace(/\n/g, '\\n')}"` : false);
  record('notice sits ABOVE the composer card', setup.overlapsCard === false ? `card top=${String(setup.card.top)} notice bottom=${String(setup.overlay.bottom)}` : false);
  record('notice does not cover the input field', setup.overlapsField === false ? `field top=${String(setup.field.top)} notice bottom=${String(setup.overlay.bottom)}` : false);
} else {
  record('setup', setup);
}

// Hold to reveal: the COMPOSER must carry the original while held.
const reveal = await evaluate(`(async () => {
  const notice = document.querySelector('.dsh-data-mask-notice');
  const editor = document.querySelector('[data-composer-input]');
  if (notice === null) return 'no notice';
  const button = [...notice.querySelectorAll('button')].find((b) => b.textContent.includes('查看原文'));
  if (button === undefined) return 'no reveal button';
  const before = editor.textContent;
  button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const held = editor.textContent;
  const heldNotice = document.querySelector('.dsh-data-mask-notice')?.textContent ?? '';
  button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return { before, held, after: editor.textContent, heldNotice };
})()`);
if (typeof reveal === 'object') {
  record('composer shows the original while held', reveal.held.includes('13812345678') && reveal.held.includes('zhangsan@example.com') ? `"${reveal.held.replace(/\n/g, '\\n')}"` : false);
  record('composer is masked again after release', !reveal.after.includes('13812345678') && reveal.after.includes('手机号') ? `"${reveal.after.replace(/\n/g, '\\n')}"` : false);
  record('notice explains the held state', reveal.heldNotice.includes('输入框已切到原文') ? `"${reveal.heldNotice}"` : false);
} else {
  record('hold to reveal', reveal);
}

// Switching conversation ownership is checked in a REAL Session by
// scripts/check-session-flow.mjs: the composer survives a switch (its ancestor
// chain is byte-identical, measured), so ownership comes from the sidebar's
// selected row and cannot be simulated by swapping the composer node here.
record('session ownership is covered by check-session-flow.mjs', 'see that script');

console.log(results.join('\n'));
const relevant = consoleLines.filter((line) => line.includes('data-mask') || line.includes('exception'));
console.log('\n--- plugin console output ---');
console.log(relevant.length === 0 ? '(none)' : relevant.join('\n'));

socket.close();
chrome.kill();
setTimeout(() => {
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* disposable */ }
}, 500);
process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0);
