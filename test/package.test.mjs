import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { REGION_START, REGION_END, renderEngineBlock } from '../scripts/build-client.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const clientPath = join(root, 'client.js');
const client = readFileSync(clientPath, 'utf8');

test('the inlined engine is in sync with engine.js', () => {
  const before = readFileSync(clientPath, 'utf8');
  execFileSync(process.execPath, [join(root, 'scripts', 'build-client.mjs')], { stdio: 'pipe' });
  const after = readFileSync(clientPath, 'utf8');
  assert.equal(after, before, 'run `npm run build` — the inlined engine is stale');
});

test('the generated engine region carries the whole engine', () => {
  const start = client.indexOf(REGION_START);
  const end = client.indexOf(REGION_END);
  assert.ok(start !== -1 && end > start, 'client.js lost its generated-engine sentinels');
  const region = client.slice(start + REGION_START.length, end);
  assert.equal(region.trim(), renderEngineBlock().trim());
  // Spot-check that the region is executable code, not a re-export stub.
  for (const marker of ['function sanitize(', 'const RULES = [', 'function parseCustomRules(']) {
    assert.ok(region.includes(marker), `engine region is missing ${marker}`);
  }
});

test('the Client bundle requires only module-table seed words', () => {
  // A package subpath is NOT resolvable in the browser module table, and a
  // failed require rejects the import and fails the web boot gate (verified in
  // a real browser with scripts/check-web-boot.mjs). Only platform seed words
  // may be required, and each optional one must be guarded.
  const required = [...client.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((match) => match[2]);
  assert.deepEqual(required, ['react', '@deepseek-ai/dsh-client-ui-primitives']);
  // The primitives are optional: their require sits in a try/catch with a
  // native-control fallback.
  assert.match(client, /try \{\s*\n\s*Field = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/);
  assert.match(client, /Field\?\.Switch \?\? NativeCheckbox/);
  // The shell Checkbox renders its label text, which would duplicate the rule name.
  assert.match(client, /function RuleToggle\(props\) \{\s*\n\s*const Component = Field\?\.Switch \?\? NativeCheckbox;/);
});

test('the settings surface is the shell Settings panel, not a plugin panel', () => {
  // The requirement: settings live in 设置 (the sidebar foot), so the plugin
  // registers a `settings.section` page and ships no floating panel of its own.
  assert.match(client, /ctx\.slots\.inject\('settings\.section'/);
  assert.match(client, /name: 'settings\.section'/);
  assert.match(client, /label: \(\) => t\('nav\.label'\)/);
  assert.doesNotMatch(client, /dsh-data-mask-panel/);
  assert.doesNotMatch(client, /dsh-data-mask-chip/);
});

test('the settings page uses the shell type scale and theme tokens', () => {
  // 14/20 titles, 12/18 descriptions and 16px rows are the shipped settings-row
  // metrics; colors must come from theme tokens so the page follows the active
  // theme instead of inventing a palette of its own.
  assert.match(client, /\.dsh-data-mask-title \{ font-size: 14px; line-height: 20px; color: var\(--dsw-alias-label-primary\)/);
  assert.match(client, /\.dsh-data-mask-description \{ margin-top: 4px; font-size: 12px; line-height: 18px; color: var\(--dsw-alias-label-secondary\)/);
  assert.match(client, /\.dsh-data-mask-row \{[^}]*padding: 16px 0;[^}]*border-bottom: \.5px solid var\(--dsw-alias-border-l2\)/);
  const hardcoded = [...client.matchAll(/color:\s*(#[0-9A-Fa-f]{3,8}|rgba?\([^)]*\))/g)].map((match) => match[1]);
  assert.deepEqual(hardcoded, [], `hardcoded colors found: ${hardcoded.join(', ')}`);
});

test('no helper is declared twice', () => {
  // A stale duplicate silently wins (a later declaration shadows the earlier
  // one), which is exactly how the notice kept using an outdated placement rule
  // after the new rule had been written.
  const names = [...client.matchAll(/^ {4}function ([A-Za-z_$][\w$]*)\(/gm)].map((match) => match[1]);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  assert.deepEqual(duplicates, [], `declared twice: ${duplicates.join(', ')}`);
});

test('the notice anchors to the shell-marked composer card', () => {
  // Geometry cannot identify the card: it is ~27% narrower than the viewport on
  // the start screen and ~68% narrower inside a session, and the field's own
  // scrollport sits inside it. The shell's own marker is the only safe anchor.
  assert.match(client, /closest\?\.\('\[data-composer-card\]'\)/);
  // Placed above the card, never over the composer.
  assert.match(client, /window\.innerHeight - rect\.top \+ 8/);
  assert.doesNotMatch(client, /window\.innerHeight - rect\.bottom/);
});

test('the reveal swaps the composer, not only the notice', () => {
  // The requirement: holding 按住查看原文 shows the original IN the composer.
  assert.match(client, /function swapDraft\(record, reveal\)/);
  assert.match(client, /dispatchPaste\(editor, target\)/);
  // Releasing must not clobber a draft the user changed while holding.
  assert.match(client, /if \(current !== expected\) return false;/);
});

test('the hold-to-reveal hold cannot stick and cannot double-write', () => {
  // Every previous attempt failed on one of these two:
  //  - a cached flag went stale, so later presses were skipped;
  //  - two release paths each ran the restore, and the second APPENDED the text.
  // The current design is idempotent in both places instead of relying on exactly
  // one caller, and carries no release timer (a poll cancelled every hold).
  const notice = client.slice(client.indexOf('function MaskNotice('));
  assert.match(notice, /const heldRef = useRef\(false\);/);
  assert.match(notice, /if \(heldRef\.current === next\) return;/);
  // Release is heard in both places on purpose; the duplicate is absorbed.
  assert.match(notice, /document\.addEventListener\('pointerup', release, true\)/);
  assert.match(notice, /onPointerUp: \(\) => setRevealed\(false\)/);
  // No poll-based release: a timer here breaks holding entirely.
  assert.doesNotMatch(notice, /setInterval\(release/);
  // Pointer capture swallowed every press after the first one.
  assert.doesNotMatch(client, /setPointerCapture/);
  // And the write itself is idempotent against a repeated report.
  assert.match(client, /if \(reveal \? live === 'swapped' : live === 'masked'\) return;/);
});

test('the notice belongs to the Session the paste happened in', () => {
  // The composer SURVIVES a conversation switch — its whole ancestor chain is
  // byte-identical before and after (measured), so "the node is still mounted"
  // proved nothing and the notice followed the user around. Ownership comes from
  // the sidebar's selected row instead, and the sidebar is watched so the notice
  // hides at once rather than on the next tick.
  assert.match(client, /function currentSessionKey\(\)/);
  assert.match(client, /\[data-row-key\^="session:"\]\[class\*="selected"\]/);
  assert.match(client, /sessionKey: currentSessionKey\(\)/);
  assert.match(client, /if \(owner === null\) return now === null;/);
  assert.match(client, /new MutationObserver\(tick\)/);
});

test('the notice matches the composer card width', () => {
  // The owner's report: the notice was narrower than the composer. The width is
  // measured from the card, and the stylesheet value is only a first-frame
  // fallback.
  assert.match(client, /width: `\$\{String\(Math\.round\(rect\.width\)\)\}px`/);
  assert.match(client, /element\.style\.width = placement\.width/);
});

test('the package ships no module-table subpath artifact', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.exports['./client-engine'], undefined);
  assert.equal(existsSync(join(root, 'client-engine.js')), false);
  assert.equal(manifest.files.includes('client-engine.js'), false);
});

test('the Client bundle registers exactly the manifest package id', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const id = /__ModuleLoader__\.load\(\{\s*\n\s*id: '([^']+)'/.exec(client);
  assert.equal(id?.[1], manifest.name);
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /name: '@local\/dsh-plugin-data-mask'/);
});

test('the plugin injects only services it cannot live without', () => {
  // A required-but-missing service parks the fiber, and the boot gate then
  // refuses to start the GUI — so `locale` is read through `ctx.get`, which
  // needs no declaration, instead of through the `ctx.locale` getter.
  assert.match(client, /inject: \['slots'\]/);
  assert.match(client, /ctx\.get\('locale'\)/);
  assert.doesNotMatch(client, /ctx\.locale/);
});

test('every ctx interaction in apply() is guarded', () => {
  // The failure that blocked boot came from an unguarded step inside apply.
  const apply = client.slice(client.indexOf('      apply(ctx) {'));
  assert.ok(apply.length > 0, 'apply() not found');
  const guards = [...apply.matchAll(/try \{/g)].length;
  assert.ok(guards >= 4, `apply() has only ${String(guards)} guards`);
  // Comments mention these calls too, so judge the code lines only.
  const code = apply
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');
  for (const call of ['ctx.effect', 'ctx.slots.inject']) {
    const at = code.indexOf(call);
    assert.ok(at !== -1, `${call} not found in apply()`);
    assert.ok(
      code.lastIndexOf('try {', at) > code.lastIndexOf('} catch', at),
      `${call} is not inside a try block`,
    );
  }
});

test('ctx.effect callbacks return a disposer instead of being side effects', () => {
  // `ctx.effect(cb)` registers cb's RETURN VALUE as the disposer: passing an
  // already-invoked call would install the resource and immediately remove it
  // again. This is exactly how the stylesheet went missing in the browser.
  assert.match(client, /ctx\.effect\(installStyles, 'data-mask: stylesheet'\)/);
  assert.doesNotMatch(client, /ctx\.effect\(installStyles\(\)/);
  assert.match(client, /ctx\.effect\(\(\) => locale\.register\(NS, DICTIONARIES\), 'data-mask: dictionaries'\)/);
  assert.match(client, /ctx\.effect\(\(\) => attachPasteInterceptor\(\), 'data-mask: paste interceptor'\)/);
});

test('the section follows the shipped row metrics', () => {
  // Verified in a real browser as computed styles, so the page cannot silently
  // lose its stylesheet and fall back to unstyled markup.
  const rules = client.slice(client.indexOf('const STYLE_TEXT = `'));
  for (const expectation of [
    /\.dsh-data-mask-row \{[^}]*padding: 16px 0;/,
    /border-bottom: \.5px solid var\(--dsw-alias-border-l2\)/,
    /\.dsh-data-mask-title \{ font-size: 14px; line-height: 20px;/,
    /\.dsh-data-mask-description \{ margin-top: 4px; font-size: 12px; line-height: 18px;/,
  ]) {
    assert.match(rules, expectation);
  }
});
