/**
 * Reproduce the two reported failures inside a REAL Session (not the start screen).
 *
 * Every earlier check ran on the start screen, where the composer is a different
 * DOM subtree with a different scope. This one opens an existing Session from the
 * sidebar first, then:
 *
 * 1. pastes JSON, holds 按住查看原文 twice in a row, and prints the composer at
 *    each step, so "works once then never again" is visible as data;
 * 2. switches to ANOTHER Session and checks whether the notice is still there;
 * 3. switches back.
 *
 * Usage: node scripts/check-session-flow.mjs "http://127.0.0.1:3098/?token=..."
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = process.argv[2];
if (target === undefined) {
  console.error('usage: node scripts/check-session-flow.mjs <url>');
  process.exit(2);
}
const CHROME = [
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((candidate) => existsSync(candidate));
const profileDir = mkdtempSync(join(tmpdir(), 'dsh-flow-'));
const shotDir = 'E:/Projects/Work/MJK/dsh-plugin-data-mask/screenshots';
const port = 9346;
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
    logs.push('[exception] ' + message.params.exceptionDetails.text + ' ' + (message.params.exceptionDetails.exception?.description ?? ''));
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

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function shoot(name) {
  // Screenshots are a local visual aid, never a deliverable: the directory is
  // gitignored (the images capture the owner's own session list), so it may not
  // exist and shooting must not fail the check.
  try {
    mkdirSync(shotDir, { recursive: true });
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(shotDir, name + '.png'), Buffer.from(shot.data, 'base64'));
  } catch (error) {
    console.log(`(screenshot ${name} skipped: ${String(error.message)})`);
  }
}

// Open a real Session from the sidebar: the composer there is a different subtree
// with different scope than the start screen, and every earlier check ran on the
// start screen.
const opened = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rows = [...document.querySelectorAll('[data-row-key^="session:"]')];
  const pick = (index) => rows[index];
  if (rows.length < 2) return 'fewer than two sessions in the sidebar';
  const first = pick(1);
  first.click();
  await wait(3500);
  const field = document.querySelector('[data-composer-input]');
  return {
    count: rows.length,
    opened: (first.textContent ?? '').trim().slice(0, 30),
    composer: field !== null,
    card: field?.closest('[data-composer-card]') !== null,
    fieldCls: field === null ? null : String(field.className).slice(0, 30),
  };
})()`);
console.log('opened session:', JSON.stringify(opened));
await shoot('10-session-opened');

const trace = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const field = () => document.querySelector('[data-composer-input]');
  const notice = () => document.querySelector('.dsh-data-mask-notice');
  const button = () => {
    const el = notice();
    return el === null ? null : [...el.querySelectorAll('button')].find((b) => b.textContent.includes('查看原文'));
  };
  const press = (type, el, id) => el.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: id, pointerType: 'mouse', isPrimary: true,
    buttons: type === 'pointerup' ? 0 : 1,
  }));
  const editor = field();
  if (editor === null) return 'no composer in session';
  editor.focus();
  const data = new DataTransfer();
  data.setData('text/plain', '{"name":"12312","phone":"13812345678","no":"1"}');
  editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  await wait(1400);

  const steps = [];
  const snap = (label) => steps.push({
    label,
    draft: field().textContent,
    notice: (notice()?.textContent ?? '').slice(0, 50),
    tone: notice()?.getAttribute('data-tone') ?? null,
    hasButton: button() !== null,
    connected: notice() !== null,
  });
  snap('after paste');

  for (let cycle = 1; cycle <= 2; cycle += 1) {
    const target = button();
    if (target === null) { snap('cycle ' + cycle + ': no button'); break; }
    press('pointerdown', target, cycle);
    await wait(900);
    snap('cycle ' + cycle + ' held');
    press('pointerup', document.body, cycle);
    await wait(900);
    snap('cycle ' + cycle + ' released');
  }

  // Undo, if it is offered.
  const undoButton = [...(notice()?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('撤销'));
  if (undoButton !== undefined) {
    undoButton.click();
    await wait(1000);
    snap('after undo');
  } else {
    snap('no undo button');
  }
  return steps;
})()`);
console.log('\nSESSION TRACE (paste, hold x2, undo):');
console.log(JSON.stringify(trace, null, 2));
await shoot('11-session-after-reveal');

// Switching conversations: away, then BACK to the same one. Rows are addressed by
// their `data-row-key`, never by index — a click reorders the list.
const switching = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const notice = () => document.querySelector('.dsh-data-mask-notice');
  const selectedKey = () => {
    const row = document.querySelector('[data-row-key^="session:"][class*="selected"]');
    return row === null ? null : row.getAttribute('data-row-key');
  };
  const byKey = (key) => document.querySelector('[data-row-key="' + key + '"]');
  const keys = [...document.querySelectorAll('[data-row-key^="session:"]')].map((row) => row.getAttribute('data-row-key'));
  const home = selectedKey();
  const other = keys.find((key) => key !== home);
  const steps = [];
  const snap = (label) => steps.push({
    label,
    noticeVisible: notice() !== null,
    session: (selectedKey() ?? '(none)').slice(9, 17),
    draft: (document.querySelector('[data-composer-input]')?.textContent ?? '').slice(0, 34),
  });
  snap('before switching');
  byKey(other).click();
  await wait(3000);
  snap('after switching away');
  byKey(home).click();
  await wait(3000);
  snap('after switching back');
  return { home: home?.slice(9, 17), other: other?.slice(9, 17), steps };
})()`);
console.log('\nSESSION SWITCH:');
console.log(JSON.stringify(switching, null, 2));

const results = [];
const record = (name, value) => {
  results.push(`${value === true ? 'PASS' : value === false ? 'FAIL' : 'INFO'}  ${name}${typeof value === 'string' ? `: ${value}` : ''}`);
};
const steps = Array.isArray(trace) ? trace : [];
const at = (label) => steps.find((step) => step.label === label);
record('hold 1 shows the original', String(at('cycle 1 held')?.draft ?? '').includes('13812345678') ? `"${String(at('cycle 1 held')?.draft)}"` : false);
record('hold 1 restores the mask on release', String(at('cycle 1 released')?.draft ?? '') === '{"name":"姓名","phone":"手机号","no":"编号"}' ? `"${String(at('cycle 1 released')?.draft)}"` : false);
record('hold 2 still works (the reported "only once" failure)', String(at('cycle 2 held')?.draft ?? '').includes('13812345678') ? `"${String(at('cycle 2 held')?.draft)}"` : false);
record('hold 2 restores the mask on release', String(at('cycle 2 released')?.draft ?? '') === '{"name":"姓名","phone":"手机号","no":"编号"}' ? `"${String(at('cycle 2 released')?.draft)}"` : false);
record('undo puts the original back', String(at('after undo')?.draft ?? '').includes('"name":"12312"') ? `"${String(at('after undo')?.draft)}"` : false);

const switchSteps = Array.isArray(switching?.steps) ? switching.steps : [];
const atSwitch = (label) => switchSteps.find((step) => step.label === label);
record('notice visible in its own Session', atSwitch('before switching')?.noticeVisible === true);
record('notice hides when another Session is selected', atSwitch('after switching away')?.noticeVisible === false ? `now on ${String(atSwitch('after switching away')?.session)}` : false);
record('notice returns when the Session comes back', atSwitch('after switching back')?.noticeVisible === true ? `back on ${String(atSwitch('after switching back')?.session)}` : false);

console.log('\nRESULTS:');
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
