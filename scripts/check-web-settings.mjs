/**
 * End-to-end check of the data-mask settings page and the paste notice.
 *
 * Product questions this answers, through the DevTools Protocol:
 *
 * 1. does the shell's own Settings panel list 数据脱敏 among its sections?
 * 2. does that section render the shipped-style rows and the shell's controls?
 * 3. does toggling 启用粘贴脱敏 actually persist, and does masking then stop?
 * 4. does the paste notice still appear (and offer reveal + undo) with no chip?
 *
 * Usage: node scripts/check-web-settings.mjs "http://127.0.0.1:3098/?token=..."
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = process.argv[2];
if (target === undefined) {
  console.error('usage: node scripts/check-web-settings.mjs <url>');
  process.exit(2);
}

const CHROME = [
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((candidate) => existsSync(candidate));
const profileDir = mkdtempSync(join(tmpdir(), 'dsh-settings-'));
const port = 9337;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1722,994', 'about:blank',
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
const consoleLines = [];
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

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

const results = [];
const record = (name, value) => {
  results.push(`${value === true ? 'PASS' : value === false ? 'FAIL' : 'INFO'}  ${name}${typeof value === 'string' ? `: ${value}` : ''}`);
};

// 1. Open the shell's Settings panel from the sidebar foot.
const opened = await evaluate(`(async () => {
  const hit = (root) => {
    const nodes = [...root.querySelectorAll('button,[role="button"],a,[role="menuitem"],[role="tab"]')];
    return nodes.find((el) => (el.textContent ?? '').trim() === '设置')
      ?? nodes.find((el) => (el.getAttribute('aria-label') ?? '') === '设置')
      ?? nodes.find((el) => (el.getAttribute('title') ?? '') === '设置');
  };
  const button = hit(document);
  if (button === undefined) return 'no 设置 button found';
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return document.body.innerText.includes('设置') || document.querySelector('[role="dialog"]') !== null;
})()`);
record('settings panel opens from the sidebar foot', opened === true ? 'opened' : opened);

// 2. The panel lists the plugin's section.
const listed = await evaluate(`(() => {
  const panel = document.querySelector('[role="dialog"]') ?? document.body;
  const rows = [...panel.querySelectorAll('button,[role="tab"],[role="button"],li,div')]
    .filter((el) => (el.textContent ?? '').trim() === '数据脱敏');
  return { found: rows.length > 0, sectionCount: rows.length };
})()`);
record('设置 lists 数据脱敏', listed.found === true ? `matched ${String(listed.sectionCount)} node(s)` : false);

// 3. Open it and inspect the rendered page.
const page = await evaluate(`(async () => {
  const panel = document.querySelector('[role="dialog"]') ?? document.body;
  const row = [...panel.querySelectorAll('button,[role="tab"],[role="button"],li,div')]
    .filter((el) => (el.textContent ?? '').trim() === '数据脱敏')
    .pop();
  if (row === undefined) return 'nav row missing';
  row.click();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const section = document.querySelector('.dsh-data-mask-section');
  if (section === null) return 'section did not render';
  const text = section.innerText;
  const switches = section.querySelectorAll('[role="switch"],input[type="checkbox"]');
  return {
    text: text.slice(0, 400),
    rows: section.querySelectorAll('.dsh-data-mask-row').length,
    switchers: switches.length,
    ruleRows: section.querySelectorAll('.dsh-data-mask-rule').length,
    segmented: section.querySelectorAll('[role="radiogroup"],[role="tablist"]').length,
    textareas: section.querySelectorAll('textarea').length,
    preview: section.querySelector('.dsh-data-mask-preview')?.textContent ?? '',
    titleSize: getComputedStyle(section.querySelector('.dsh-data-mask-title')).fontSize,
    titleColor: getComputedStyle(section.querySelector('.dsh-data-mask-title')).color,
    // The multi-line rows are the stacked ones; the first row of the column is
    // a side-by-side row only when it stacks nothing.
    rowPadding: getComputedStyle(section.querySelectorAll('.dsh-data-mask-row')[2]).paddingTop,
    rowBorder: getComputedStyle(section.querySelectorAll('.dsh-data-mask-row')[2]).borderBottomWidth,
    styleInstalled: document.getElementById('dsh-data-mask-style') !== null,
  };
})()`);
if (typeof page === 'object') {
  record('settings page rendered', `rows=${String(page.rows)} ruleRows=${String(page.ruleRows)} controls=${String(page.switchers)} textareas=${String(page.textareas)} segmented=${String(page.segmented)}`);
  record('plugin stylesheet installed', page.styleInstalled);
  record('uses the shell type scale (14px titles, 16px rows, .5px divider)', `title=${page.titleSize} padding=${page.rowPadding} border=${page.rowBorder} color=${page.titleColor}`);
  record('live preview masks the sample', page.preview.includes('[手机号') ? `"${page.preview.slice(0, 70)}"` : false);
} else {
  record('settings page', page);
}

// 4. Turning the master switch off stops masking.
const off = await evaluate(`(async () => {
  const section = document.querySelector('.dsh-data-mask-section');
  if (section === null) return 'no section';
  // The shell Switch renders a button carrying role="switch".
  const control = section.querySelector('button[role="switch"],button')
    ?? section.querySelector('input[type="checkbox"]:not([aria-hidden="true"])');
  if (control === null) return 'no switch';
  const before = localStorage.getItem('dsh.data-mask.settings.v1');
  control.click();
  await new Promise((resolve) => setTimeout(resolve, 600));
  const after = localStorage.getItem('dsh.data-mask.settings.v1');
  const editor = document.querySelector('[contenteditable=""],[contenteditable="true"]');
  if (editor === null) return { before, after, paste: 'no editor' };
  editor.focus();
  const data = new DataTransfer();
  data.setData('text/plain', '张三 13812345678 收');
  editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  await new Promise((resolve) => setTimeout(resolve, 800));
  return { before, after, paste: editor.textContent, tag: control.tagName, role: control.getAttribute('role') };
})()`);
if (typeof off === 'object') {
  record('switch element', `${String(off.tag)}+${String(off.role)}`);
  record('switch click persisted the setting', off.after !== off.before ? `${String(off.before)} → ${String(off.after)}` : false);
  record('masking is off after disabling', off.paste.includes('13812345678') ? `"${off.paste}"` : false);
} else {
  record('master switch', off);
}

// 5. Switch it back on, reload so the composer is empty and the saved setting is
//    read fresh, then paste: masked, and the notice offers reveal + undo.
const reenabled = await evaluate(`(async () => {
  const section = document.querySelector('.dsh-data-mask-section');
  const control = section?.querySelector('button[role="switch"],button')
    ?? section?.querySelector('input[type="checkbox"]:not([aria-hidden="true"])');
  control?.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  return localStorage.getItem('dsh.data-mask.settings.v1');
})()`);
record('setting saved as enabled again', String(reenabled).includes('"enabled":true') ? String(reenabled) : false);

await send('Page.navigate', { url: target }, sessionId);
await sleep(16000);

const back = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const editor = () => document.querySelector('[contenteditable=""],[contenteditable="true"]');
  let target = editor();
  if (target === null) return 'no editor after reload';
  // Empty the draft first: a draft that still holds the previous (unmasked) paste
  // is a draft the notice must NOT describe — it no longer matches what was
  // written, which is exactly the deletion case the plugin now detects.
  target.focus();
  const range = document.createRange();
  range.selectNodeContents(target);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true }));
  target.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }));
  await wait(1200);
  const emptied = editor().textContent;

  target = editor();
  target.focus();
  const focused = document.activeElement === target;
  const data = new DataTransfer();
  data.setData('text/plain', '张三 13812345678 收');
  target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  await wait(1000);
  const notice = document.querySelector('.dsh-data-mask-notice');
  return {
    emptied,
    focused,
    draft: editor().textContent,
    notice: notice?.textContent ?? null,
    buttons: notice === null ? [] : [...notice.querySelectorAll('button')].map((b) => b.textContent),
    chip: document.querySelectorAll('.dsh-data-mask-chip').length,
    bootFailed: document.body.innerText.includes('Failed to load plugins'),
  };
})()`);
if (typeof back === 'object') {
  record('page reloads cleanly with the plugin (no boot failure)', back.bootFailed === false);
  record('draft was emptied before the paste', back.emptied === '' ? `"${String(back.emptied)}"` : false);
  record('masking masked the clean paste', back.draft === '张三 [手机号/固话] 收' ? `"${back.draft}"` : false);
  record('notice appears with reveal + undo', back.buttons.some((b) => b.includes('查看原文')) && back.buttons.some((b) => b.includes('撤销')) ? `"${String(back.notice)}"` : false);
  record('no chip is rendered any more', back.chip === 0);
} else {
  record('re-enable and paste', back);
}

console.log(results.join('\n'));
const relevant = consoleLines.filter((line) => line.includes('data-mask') || line.includes('exception'));
console.log('\n--- plugin console output ---');
console.log(relevant.length === 0 ? '(none)' : relevant.join('\n'));

socket.close();
chrome.kill();
setTimeout(() => {
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {
    // disposable
  }
}, 500);
process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0);
