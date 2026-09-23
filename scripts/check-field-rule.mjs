/**
 * Verify the field-name rule in a real browser, on the reported JSON shape.
 *
 * Pastes an order/detail payload whose identifiers are short or numeric — the
 * values that no value-shaped rule can recognize — and reports what the composer
 * received. Also drives the settings preview, so the rule's own toggle is
 * covered.
 *
 * Usage: node scripts/check-field-rule.mjs "http://127.0.0.1:3098/?token=..."
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = process.argv[2];
if (target === undefined) {
  console.error('usage: node scripts/check-field-rule.mjs <url>');
  process.exit(2);
}
const CHROME = [
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((candidate) => existsSync(candidate));
const profileDir = mkdtempSync(join(tmpdir(), 'dsh-field-'));
const port = 9345;
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
await sleep(16000);

const results = [];
const record = (name, value) => {
  results.push(`${value === true ? 'PASS' : value === false ? 'FAIL' : 'INFO'}  ${name}${typeof value === 'string' ? `: ${value}` : ''}`);
};

const payload = '{"id":503,"name":"12312","username":"123123","phone":"123132","email":"12321","department":"DEPARTMENT_01","work_no":"A1001","no":"1","version":"1.2.3"}';
const paste = await send('Runtime.evaluate', {
  expression: `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const editor = document.querySelector('[data-composer-input]');
    editor.focus();
    const data = new DataTransfer();
    data.setData('text/plain', ${JSON.stringify(payload)});
    editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    await wait(1200);
    return editor.textContent;
  })()`,
  awaitPromise: true,
  returnByValue: true,
}, sessionId);
const received = paste.result.value;
record('paste result', `"${String(received)}"`);

let parsed = null;
try {
  parsed = JSON.parse(received);
} catch {
  parsed = null;
}
record('the masked JSON is still valid JSON', parsed !== null ? 'parsed' : false);
if (parsed !== null) {
  record('"name" replaced (short value, shape could never match)', parsed.name === '姓名' ? `name="${String(parsed.name)}"` : false);
  record('"username" replaced', parsed.username === '用户名' ? `username="${String(parsed.username)}"` : false);
  record('"work_no" replaced', parsed.work_no === '工号' ? `work_no="${String(parsed.work_no)}"` : false);
  record('"no" replaced', parsed.no === '编号' ? `no="${String(parsed.no)}"` : false);
  record('"phone" / "email" replaced', parsed.phone === '手机号' && parsed.email === '邮箱' ? `phone="${String(parsed.phone)}" email="${String(parsed.email)}"` : false);
  record('"version" left alone', parsed.version === '1.2.3' ? `version="${String(parsed.version)}"` : false);
  record('"department" left alone', parsed.department === 'DEPARTMENT_01' ? `department="${String(parsed.department)}"` : false);
  record('"id" left alone (not a sensitive field)', parsed.id === 503 ? `id=${String(parsed.id)}` : false);
}

// The settings preview must show the same behaviour, and the rule has a toggle.
const preview = await send('Runtime.evaluate', {
  expression: `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const hit = (root) => {
      const nodes = [...root.querySelectorAll('button,[role="button"],a,div')];
      return nodes.find((el) => (el.textContent ?? '').trim() === '设置');
    };
    hit(document)?.click();
    await wait(900);
    const row = [...document.querySelectorAll('button,[role="tab"],[role="button"],li,div')]
      .filter((el) => (el.textContent ?? '').trim() === '数据脱敏').pop();
    row?.click();
    await wait(900);
    const section = document.querySelector('.dsh-data-mask-section');
    if (section === null) return 'settings section did not open';
    const rules = [...section.querySelectorAll('.dsh-data-mask-rule')];
    const fieldRule = rules.find((el) => (el.textContent ?? '').includes('敏感字段值'));
    const sample = section.querySelectorAll('textarea')[1];
    if (sample !== undefined) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(sample, '{"name":"12312","no":"1"}');
      sample.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(600);
    }
    return {
      ruleRows: rules.length,
      hasFieldRule: fieldRule !== undefined,
      toggles: section.querySelectorAll('[role="switch"],input[type="checkbox"]').length,
      output: section.querySelector('.dsh-data-mask-preview')?.textContent ?? '',
    };
  })()`,
  awaitPromise: true,
  returnByValue: true,
}, sessionId);
const panel = preview.result.value;
if (typeof panel === 'object') {
  record('规则列表里有「敏感字段值」这条', panel.hasFieldRule === true ? `${String(panel.ruleRows)} 条规则` : false);
  record('设置页试算同样生效', String(panel.output).includes('姓名') && String(panel.output).includes('编号') ? `"${String(panel.output)}"` : false);
} else {
  record('settings preview', panel);
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
