/**
 * Verify the notice disappears when its draft is deleted — in a REAL Session.
 *
 * The report: deleting the masked message leaves the notice behind. The composer
 * is read live for this, so the check drives real deletion (select-all + delete
 * through the composer's own paste path, then a keyboard Backspace) rather than
 * poking the DOM.
 *
 * Usage: node scripts/check-draft-deleted.mjs "http://127.0.0.1:3098/?token=..."
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = process.argv[2];
if (target === undefined) {
  console.error('usage: node scripts/check-draft-deleted.mjs <url>');
  process.exit(2);
}
const CHROME = [
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((candidate) => existsSync(candidate));
const profileDir = mkdtempSync(join(tmpdir(), 'dsh-del-'));
const port = 9349;
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
const logs = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) { pending.get(message.id)?.(message); pending.delete(message.id); return; }
  if (message.method === 'Runtime.consoleAPICalled') {
    logs.push('[' + message.params.type + '] ' + (message.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (message.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + message.params.exceptionDetails.text);
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
await sleep(17000);

const results = [];
const record = (name, value) => {
  results.push(`${value === true ? 'PASS' : value === false ? 'FAIL' : 'INFO'}  ${name}${typeof value === 'string' ? `: ${value}` : ''}`);
};

const flow = await send('Runtime.evaluate', {
  expression: `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const field = () => document.querySelector('[data-composer-input]');
    const notice = () => document.querySelector('.dsh-data-mask-notice');
    // Open a real Session first: the start screen is a different subtree.
    const rows = [...document.querySelectorAll('[data-row-key^="session:"]')];
    if (rows.length < 2) return 'fewer than two sessions';
    rows[1].click();
    await wait(3200);

    const editor = field();
    if (editor === null) return 'no composer after opening a session';
    const steps = [];
    const snap = (label) => steps.push({ label, draft: field().textContent, notice: notice() !== null });

    editor.focus();
    const data = new DataTransfer();
    data.setData('text/plain', '{"name":"12312","phone":"13812345678"}');
    editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    await wait(1400);
    snap('after paste');

    // Delete the draft the way a user does: select everything, then Backspace
    // through the composer's own key handling.
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await wait(200);
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true }));
    editor.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }));
    await wait(1500);
    snap('after deleting the draft');

    // And a case the notice must SURVIVE: paste, then hold to reveal.
    const data2 = new DataTransfer();
    data2.setData('text/plain', '{"no":"1"}');
    editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data2 }));
    await wait(1200);
    snap('second paste');
    const button = [...(notice()?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('查看原文'));
    if (button !== undefined) {
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      await wait(800);
      snap('held (must stay visible)');
      button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      await wait(800);
      snap('released');
    }
    return steps;
  })()`,
  awaitPromise: true,
  returnByValue: true,
}, sessionId);

const steps = flow.result.value;
if (!Array.isArray(steps)) {
  record('flow', steps);
} else {
  const at = (label) => steps.find((step) => step.label === label);
  for (const step of steps) {
    record(`${step.label}: draft="${String(step.draft).slice(0, 40)}"`, `notice=${String(step.notice)}`);
  }
  record('notice appears after the paste', at('after paste')?.notice === true);
  record('notice disappears when the draft is deleted', at('after deleting the draft')?.notice === false ? `draft="${String(at('after deleting the draft')?.draft)}"` : false);
  record('notice stays visible while the original is held', at('held (must stay visible)')?.notice === true ? `draft="${String(at('held (must stay visible)')?.draft)}"` : false);
}

console.log(results.join('\n'));
const relevant = logs.filter((line) => line.includes('data-mask') || line.includes('exception'));
console.log('\n--- plugin console output ---');
console.log(relevant.length === 0 ? '(none)' : relevant.join('\n'));

socket.close();
chrome.kill();
setTimeout(() => {
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* disposable */ }
}, 500);
process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0);
