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

test('the Client bundle requires nothing but the module-table seeds', () => {
  // A package subpath is NOT resolvable in the browser module table, and a
  // failed require rejects the import and fails the web boot gate (verified in
  // a real browser with scripts/check-web-boot.mjs).
  const required = [...client.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((match) => match[2]);
  assert.deepEqual(required, ['react']);
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
  for (const call of ['ctx.effect', 'ctx.slots.inject']) {
    const at = apply.indexOf(call);
    assert.ok(at !== -1, `${call} not found in apply()`);
    assert.ok(
      apply.lastIndexOf('try {', at) > apply.lastIndexOf('} catch', at),
      `${call} is not inside a try block`,
    );
  }
});
