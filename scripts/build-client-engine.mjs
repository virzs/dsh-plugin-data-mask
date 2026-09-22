/**
 * Generate `client-engine.js` — the browser module-table form of `engine.js`.
 *
 * The Harness browser module table only resolves a package's own id (and its
 * `/client` subpath), so the Client half cannot `require` an arbitrary ESM
 * subpath. This script keeps `engine.js` as the single source of truth and
 * emits the module-loader wrapper the browser needs, which is what `client.js`
 * requires at runtime. Run `npm run build` after editing `engine.js`; `npm test`
 * checks the source module, and the generated wrapper is asserted to be in sync.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const source = readFileSync(join(root, 'engine.js'), 'utf8');

/** Public names the Client half consumes. */
const EXPORTS = [
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

// Strip the doc-comment blocks (the wrapper carries a pointer to engine.js
// instead) and the `export` keyword, leaving plain function declarations.
const body = source
  .replace(/\/\*\*[\s\S]*?\*\//g, '')
  .replace(/^export /gm, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const output = `/**
 * GENERATED FILE — do not edit.
 *
 * Browser module-table form of \`engine.js\`, produced by \`npm run build\`.
 * The rules, validators and masking logic are the ones in \`engine.js\`; read
 * that file, and run \`npm test\` to verify the behavior.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-data-mask/engine',
  factory() {
${body.replace(/^/gm, '    ')}
    return { ${EXPORTS.join(', ')} };
  },
});
`;

writeFileSync(join(root, 'client-engine.js'), output, 'utf8');
console.log(`client-engine.js written (${output.length} bytes, ${EXPORTS.length} exports)`);
