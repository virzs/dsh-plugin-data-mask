import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const generated = join(root, 'client-engine.js');

test('client-engine.js is in sync with engine.js', () => {
  const before = readFileSync(generated, 'utf8');
  execFileSync(process.execPath, [join(root, 'scripts', 'build-client-engine.mjs')], { stdio: 'pipe' });
  const after = readFileSync(generated, 'utf8');
  assert.equal(after, before, 'client-engine.js is stale — run `npm run build`');
});

test('every module the Client half loads exists in the package', () => {
  const client = readFileSync(join(root, 'client.js'), 'utf8');
  const required = [...client.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]);
  // The module table resolves a package's own id only; a subpath needs its own
  // registered factory, which is why the engine ships as its own bundle.
  assert.deepEqual(required, ['react', 'react-dom', '@local/dsh-plugin-data-mask/engine']);
  const engine = readFileSync(generated, 'utf8');
  assert.match(engine, /__ModuleLoader__\.load\(\{\s*\n\s*id: '@local\/dsh-plugin-data-mask\/engine'/);
});

test('the Client bundle registers exactly the manifest package id', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const client = readFileSync(join(root, 'client.js'), 'utf8');
  const id = /__ModuleLoader__\.load\(\{\s*\n\s*id: '([^']+)'/.exec(client);
  assert.equal(id?.[1], manifest.name);
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /name: '@local\/dsh-plugin-data-mask'/);
});
