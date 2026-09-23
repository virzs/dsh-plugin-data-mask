/**
 * Diagnose the notice's width and the hold-to-reveal state machine.
 *
 * 1. How wide is the notice versus the composer card?
 * 2. What happens across a full reveal cycle: press, hold, release, then press
 *    again? The report is that the second interaction does nothing and the notice
 *    starts claiming the draft changed.
 *
 * Usage: node scripts/check-reveal-cycle.mjs "http://127.0.0.1:3098/?token=..."
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = process.argv[2];
if (target === undefined) {
  console.error('usage: node scripts/check-reveal-cycle.mjs <url>');
  process.exit(2);
}
const CHROME = [
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((candidate) => existsSync(candidate));
const profileDir = mkdtempSync(join(tmpdir(), 'dsh-reveal-'));
const port = 9342;
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
  expression: `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const editor = document.querySelector('[data-composer-input]');
    if (editor === null) return 'no composer';
    editor.focus();
    const data = new DataTransfer();
    data.setData('text/plain', '张三 13812345678 收');
    editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    await wait(1400);

    const card = document.querySelector('[data-composer-card]');
    const overlay = document.querySelector('.dsh-data-mask-overlay');
    const notice = document.querySelector('.dsh-data-mask-notice');
    const snapshot = (label) => ({
      label,
      draft: editor.textContent,
      noticeText: (document.querySelector('.dsh-data-mask-notice')?.textContent ?? '').slice(0, 70),
      overlayWidth: overlay === null ? null : Math.round(overlay.getBoundingClientRect().width),
      cardWidth: card === null ? null : Math.round(card.getBoundingClientRect().width),
      noticeWidth: notice === null ? null : Math.round(notice.getBoundingClientRect().width),
      preview: (document.querySelector('.dsh-data-mask-notice-preview')?.textContent ?? '').slice(0, 40),
    });
    const button = () => {
      const notice = document.querySelector('.dsh-data-mask-notice');
      return notice === null ? null : [...notice.querySelectorAll('button')].find((b) => b.textContent.includes('查看原文'));
    };
    const states = [snapshot('after paste')];

    const first = button();
    if (first === null) return { states, error: 'no reveal button' };
    first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    await wait(900);
    states.push(snapshot('held #1'));
    first.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    await wait(900);
    states.push(snapshot('released #1'));

    const second = button();
    if (second === null) return { states, error: 'reveal button disappeared after release' };
    second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 }));
    await wait(900);
    states.push(snapshot('held #2'));
    second.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
    await wait(900);
    states.push(snapshot('released #2'));

    const third = button();
    if (third !== null) {
      third.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3 }));
      await wait(900);
      states.push(snapshot('held #3'));
      third.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3 }));
      await wait(900);
      states.push(snapshot('released #3'));
    }
    return { states };
  })()`,
  awaitPromise: true,
  returnByValue: true,
}, sessionId);
console.log(JSON.stringify(result.result.value, null, 2));

socket.close();
chrome.kill();
setTimeout(() => {
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* disposable */ }
}, 500);
