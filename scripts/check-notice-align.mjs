/**
 * Verify the notice lines up with the composer card, and that hold-to-reveal
 * survives repeated use — including a real pointer path (move, press, move, release).
 *
 * The earlier defect only appeared with a genuine pointer sequence: `pointerleave`
 * fires while the cursor travels toward the button, which cancelled the hold
 * before it began. Synthetic press/release alone never reproduced it, so this
 * check drives move events too.
 *
 * Usage: node scripts/check-notice-align.mjs "http://127.0.0.1:3098/?token=..."
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = process.argv[2];
if (target === undefined) {
  console.error('usage: node scripts/check-notice-align.mjs <url>');
  process.exit(2);
}
const CHROME = [
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((candidate) => existsSync(candidate));
const profileDir = mkdtempSync(join(tmpdir(), 'dsh-align-'));
const port = 9344;
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
    logs.push((message.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
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

const results = [];
const record = (name, value) => {
  results.push(`${value === true ? 'PASS' : value === false ? 'FAIL' : 'INFO'}  ${name}${typeof value === 'string' ? `: ${value}` : ''}`);
};

// Geometry: the notice must share the card's left edge and width.
const geometry = await send('Runtime.evaluate', {
  expression: `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const editor = document.querySelector('[data-composer-input]');
    editor.focus();
    const data = new DataTransfer();
    data.setData('text/plain', '张三 13812345678 收');
    editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    await wait(1500);
    const card = editor.closest('[data-composer-card]').getBoundingClientRect();
    const overlay = document.querySelector('.dsh-data-mask-overlay').getBoundingClientRect();
    return {
      cardLeft: Math.round(card.left), cardWidth: Math.round(card.width), cardTop: Math.round(card.top),
      noticeLeft: Math.round(overlay.left), noticeWidth: Math.round(overlay.width), noticeBottom: Math.round(overlay.bottom),
    };
  })()`,
  awaitPromise: true,
  returnByValue: true,
}, sessionId);
const g = geometry.result.value;
record('notice left edge matches the composer card', Math.abs(g.noticeLeft - g.cardLeft) <= 2 ? `notice ${String(g.noticeLeft)} vs card ${String(g.cardLeft)}` : false);
record('notice width matches the composer card', Math.abs(g.noticeWidth - g.cardWidth) <= 4 ? `notice ${String(g.noticeWidth)} vs card ${String(g.cardWidth)}` : false);
record('notice sits above the card', g.noticeBottom <= g.cardTop ? `notice bottom ${String(g.noticeBottom)} <= card top ${String(g.cardTop)}` : false);

// Reveal, driven like a real pointer: enter the button, move across it, press,
// move again while held, then release off the button entirely.
const reveal = await send('Runtime.evaluate', {
  expression: `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const editor = document.querySelector('[data-composer-input]');
    const buttonOf = () => {
      const notice = document.querySelector('.dsh-data-mask-notice');
      return notice === null ? null : [...notice.querySelectorAll('button')].find((b) => b.textContent.includes('查看原文'));
    };
    const pointer = (type, target, id) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: id, pointerType: 'mouse', isPrimary: true, buttons: type === 'pointerup' ? 0 : 1,
    }));
    const cycles = [];
    for (let i = 1; i <= 3; i += 1) {
      const button = buttonOf();
      if (button === null) { cycles.push({ i, error: 'no button' }); break; }
      // Travel to the button: leave/enter fire on neighbouring elements first.
      pointer('pointerover', button, i);
      pointer('pointerenter', button, i);
      pointer('pointermove', button, i);
      pointer('pointerdown', button, i);
      await wait(700);
      const held = editor.textContent;
      pointer('pointermove', button, i);
      await wait(150);
      // Release somewhere else entirely, as a real user might.
      const elsewhere = document.querySelector('[data-composer-card]');
      pointer('pointerup', elsewhere, i);
      await wait(700);
      cycles.push({ i, held, released: editor.textContent, notice: (document.querySelector('.dsh-data-mask-notice')?.textContent ?? '').slice(0, 46) });
    }
    return cycles;
  })()`,
  awaitPromise: true,
  returnByValue: true,
}, sessionId);
const cycles = reveal.result.value;
for (const cycle of cycles) {
  record(`cycle ${String(cycle.i)}: composer showed the original while held`, String(cycle.held).includes('13812345678') ? `"${String(cycle.held)}"` : false);
  record(`cycle ${String(cycle.i)}: mask restored after releasing elsewhere`, String(cycle.released) === '张三 [手机号/固话] 收' ? `"${String(cycle.released)}"` : false);
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
