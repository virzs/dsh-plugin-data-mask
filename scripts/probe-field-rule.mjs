/**
 * One-off probe: how does the field-name rule behave on realistic JSON keys?
 *
 * Kept as a script (not a test) because it prints the decisions, which is what
 * makes a false positive obvious; `test/engine.test.mjs` locks in the verdicts.
 *
 * Usage: node scripts/probe-field-rule.mjs
 */
import { sanitize, RULES } from '../engine.js';

const rule = RULES.find((entry) => entry.id === 'fieldname');
console.log('rule order:', rule.order, 'enabled:', rule.enabled);

const samples = [
  '"name":"12312"',
  '"username":"user01"',
  '"user_name":"u1"',
  '"uname":"u1"',
  '"work_no":"A1001"',
  '"workno":"A1001"',
  '"no":"1"',
  '"order_no":"SO-99"',
  '"phone":"123132"',
  '"mobile":"123"',
  '"email":"12321"',
  '"id_card":"110101199003078515"',
  '"department":"DEPARTMENT_01"',
  '"remarks":"请审批"',
  '"status":10',
  '"version":"1.2.3"',
  '"amount":"12345"',
  '"country":"+86"',
  '"support":"team"',
  '"dead_day":null',
  '"remark":"ok"',
  '{"user":{"id":503,"name":"1231"}}',
  '{"order_no":"SO-99","status":10}',
  '{"name":"张三","phone":"13812345678"}',
  'name = zhangsan',
];

for (const sample of samples) {
  const { text, hits } = sanitize(sample, { mode: 'label' });
  const ids = hits.map((hit) => hit.id).join('+') || '-';
  console.log(`${ids.padEnd(18)} ${sample.padEnd(44)} -> ${text}`);
}

console.log('\n--- modes on one field ---');
for (const mode of ['label', 'partial', 'redact']) {
  console.log(mode.padEnd(8), sanitize('{"name":"张三","no":"1"}', { mode }).text);
}
