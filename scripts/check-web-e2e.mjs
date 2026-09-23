/**
 * End-to-end check of the plugin in a real browser.
 *
 * `scripts/check-web-boot.mjs` answers "does the GUI still boot". This one
 * answers the actual product questions, through the DevTools Protocol:
 *
 * 1. did the app mount (and therefore did the boot gate pass)?
 * 2. is the dock chip rendered into the composer dock?
 * 3. does a paste into the composer come out masked?
 * 4. does the notice appear, and does 撤销 (undo) put the original back?
 *
 * Usage: node scripts/check-web-e2e.mjs "http://127.0.0.1:3099/?token=..."
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = process.argv[2];
if (target === undefined) {
  console.error('usage: node scripts/check-web-e2e.mjs <url>');
  process.exit(2);
}

const CHROME = [
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((candidate) => existsSync(candidate));
if (CHROME === undefined) {
  console.error('no Chromium-based browser found');
  process.exit(2);
}

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-'));
const port = 9334;
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

const consoleLines = [];
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    const text = (message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ');
    consoleLines.push(`[${message.params.type}] ${text}`);
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleLines.push(`[exception] ${message.params.exceptionDetails.text} ${message.params.exceptionDetails.exception?.description ?? ''}`);
  }
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
await send('Page.enable', {}, sessionId);
await send('Page.navigate', { url: target }, sessionId);
await sleep(16000);

/**
 * Evaluate an expression in the page and return its value.
 * @param expression - a self-contained expression (an async IIFE is fine).
 */
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

const results = [];
const record = (name, value) => {
  results.push(`${value === true ? 'PASS' : value === false ? 'FAIL' : 'INFO'}  ${name}${typeof value === 'string' ? `: ${value}` : ''}`);
};

// 1. The app mounted: the boot gate passed and the shell rendered.
const mounted = await evaluate(`Boolean(document.querySelector('[data-dsh-boot]')) === false && document.body.innerText.includes('HARNESS') === false && document.body.innerText.length > 0`);
record('app mounted (no boot failure screen)', await evaluate(`!document.body.innerText.includes('Failed to load plugins')`));
record('boot overlay removed', await evaluate(`document.querySelector('[data-dsh-boot]') === null`));

// 2. No chip: the plugin's configuration lives in the shell's Settings panel.
const chip = await evaluate(`(() => {
  const el = document.querySelector('.dsh-data-mask-chip');
  return el === null ? null : el.textContent;
})()`);
record('no floating chip in the composer area', chip === null ? true : `"${chip}"`);

// 3. A paste into the composer comes out masked.
const paste = await evaluate(`(async () => {
  const editor = document.querySelector('[contenteditable=""],[contenteditable="true"]');
  if (editor === null) return 'no editable composer found';
  editor.focus();
  const data = new DataTransfer();
  data.setData('text/plain', '张三 13812345678 邮箱 zhangsan@example.com 收');
  const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
  editor.dispatchEvent(event);
  await new Promise((resolve) => setTimeout(resolve, 700));
  return editor.textContent;
})()`);
record('paste lands in the composer', typeof paste === 'string' ? `"${paste}"` : false);
record('sensitive values were masked', typeof paste === 'string' && paste.includes('[手机号') && paste.includes('[邮箱') && !paste.includes('13812345678'));
record('context text preserved', typeof paste === 'string' && paste.includes('张三') && paste.includes('收'));

// 4. The notice appears with both actions.
const notice = await evaluate(`(() => {
  const el = document.querySelector('.dsh-data-mask-notice');
  if (el === null) return null;
  return { text: el.textContent, buttons: [...el.querySelectorAll('button')].map((b) => b.textContent) };
})()`);
record('masked-paste notice rendered', notice === null ? false : `"${notice.text}"`);
record('notice offers 按住查看原文 + 撤销脱敏', notice !== null && notice.buttons.some((b) => b.includes('查看原文')) && notice.buttons.some((b) => b.includes('撤销')));

// 5. Hold-to-reveal shows the original only while held.
const reveal = await evaluate(`(async () => {
  const notice = document.querySelector('.dsh-data-mask-notice');
  if (notice === null) return 'no notice';
  const button = [...notice.querySelectorAll('button')].find((b) => b.textContent.includes('查看原文'));
  if (button === undefined) return 'no reveal button';
  const preview = () => notice.querySelector('.dsh-data-mask-notice-preview').textContent;
  const before = preview();
  button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 250));
  const held = preview();
  button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 250));
  return { before, held, after: preview() };
})()`);
if (typeof reveal === 'object') {
  record('reveal hidden by default', !reveal.before.includes('13812345678') ? `"${reveal.before.slice(0, 60)}"` : false);
  record('original visible while held', reveal.held.includes('13812345678') ? `"${reveal.held.slice(0, 60)}"` : false);
  record('hidden again after release', !reveal.after.includes('13812345678'));
} else {
  record('hold-to-reveal', reveal);
}

// 6. Undo puts the original text back.
const undo = await evaluate(`(async () => {
  const notice = document.querySelector('.dsh-data-mask-notice');
  if (notice === null) return 'no notice';
  const button = [...notice.querySelectorAll('button')].find((b) => b.textContent.includes('撤销'));
  if (button === undefined) return 'no undo button';
  const editor = document.querySelector('[contenteditable=""],[contenteditable="true"]');
  const before = {
    text: editor.textContent,
    selection: String(window.getSelection()?.toString() ?? ''),
    isEditable: editor.isEditable,
    connected: editor.isConnected,
    active: document.activeElement === editor,
    noticePreview: notice.querySelector('.dsh-data-mask-notice-preview')?.textContent ?? null,
  };
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 900));
  return {
    draft: editor.textContent,
    notice: document.querySelector('.dsh-data-mask-notice')?.textContent ?? null,
    before,
    afterEditability: { isEditable: editor.isEditable, connected: editor.isConnected },
  };
})()`);
if (typeof undo === 'object') {
  console.log('UNDO-DETAIL ' + JSON.stringify(undo));
  record('undo restored the original text', undo.draft.includes('13812345678') && undo.draft.includes('zhangsan@example.com') ? `"${undo.draft}"` : false);
  record('undo confirmed in the notice', String(undo.notice).includes('已撤销') ? `"${undo.notice}"` : `"${String(undo.notice)}"`);
} else {
  record('undo', undo);
}

console.log(results.join('\n'));
const relevant = consoleLines.filter((line) => line.includes('data-mask') || line.includes('exception') || line.includes('error'));
console.log('\n--- plugin console output ---');
console.log(relevant.length === 0 ? '(none)' : relevant.join('\n'));

socket.close();
chrome.kill();
try {
  rmSync(profileDir, { recursive: true, force: true });
} catch {
  // The temporary profile is disposable.
}
process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0);
