/**
 * Inline the masking engine into the delivered Client bundle.
 *
 * Why this exists: the browser module table resolves the package's own id and
 * its `/client` subpath only. A sibling module such as
 * `@local/dsh-plugin-data-mask/engine` is NOT resolvable there, and a failed
 * `require` inside a bundle's factory rejects the import — which, for a client
 * plugin, fails the web boot gate and blocks the whole GUI (verified in a real
 * browser through `scripts/check-web-boot.mjs`). So the engine ships *inside*
 * `client.js`, and this script is what puts it there.
 *
 * `engine.js` stays the single source of truth: this script rewrites only the
 * text between the two sentinel comments, and `npm test` fails when that region
 * drifts from `engine.js`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const source = readFileSync(join(root, 'engine.js'), 'utf8');

/** The engine's public names, in the order the Client half receives them. */
export const ENGINE_EXPORTS = [
  'MODES',
  'RULES',
  'sanitize',
  'parseCustomRules',
  'formatCustomRules',
  'defaultRules',
  'luhn',
  'validNationalId',
  'validChinaPhone',
  'looksLikeJwt',
  'privateIpv4',
  'isIpv6',
];

/** Sentinel lines marking the generated engine region inside `client.js`. */
export const REGION_START = '    // #region generated engine (scripts/build-client.mjs)';
export const REGION_END = '    // #endregion generated engine';

/**
 * Turn `engine.js` into the indented, dependency-free block that lives inside
 * the Client factory: doc comments and the `export` keyword go, the code stays.
 * @param indent - leading whitespace for every line.
 * @returns the block, ending in a single newline.
 */
export function renderEngineBlock(indent = '    ') {
  const body = source
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/^export /gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `${body.split('\n').map((line) => (line === '' ? '' : indent + line)).join('\n')}\n`;
}

const clientPath = join(root, 'client.js');
const client = readFileSync(clientPath, 'utf8');
const start = client.indexOf(REGION_START);
const end = client.indexOf(REGION_END);
if (start === -1 || end === -1 || end < start) {
  throw new Error('client.js is missing the generated-engine sentinel comments');
}
const before = client.slice(0, start + REGION_START.length + 1);
const after = client.slice(end);
const next = `${before}${renderEngineBlock()}${after}`;

if (next === client) {
  console.log('client.js is already in sync with engine.js');
} else {
  writeFileSync(clientPath, next, 'utf8');
  console.log(`client.js updated with ${String(source.length)} bytes of engine source`);
}
