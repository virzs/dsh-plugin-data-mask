/**
 * Does masking stay stable when its own output is pasted again?
 *
 * The field-name rule replaces values with labels such as "姓名". If a label
 * looked like a value again, a second paste would rewrite it and the draft could
 * drift (for example `"name":"[姓名]"` becoming `"name":"[姓名]"` with extra
 * nesting). This probe pastes the masked text back through the engine twice and
 * reports every step.
 *
 * Usage: node scripts/probe-field-rule.mjs --idempotence
 */
import { sanitize } from '../engine.js';

const cases = [
  '{"name":"12312","username":"u1","work_no":"A1001","no":"1"}',
  '{"order_no":"SO-99","phone":"13812345678"}',
  '{"user_name":"张三","id_card":"110101199003078515"}',
  'name = zhangsan, no = 7',
];

let stable = true;
for (const mode of ['label', 'partial', 'redact']) {
  for (const input of cases) {
    const first = sanitize(input, { mode }).text;
    const second = sanitize(first, { mode }).text;
    const third = sanitize(second, { mode }).text;
    const ok = first === second && second === third;
    if (!ok) stable = false;
    console.log(`${ok ? 'STABLE ' : 'DRIFT  '} [${mode}] ${input}`);
    console.log(`         1st: ${first}`);
    if (first !== second) console.log(`         2nd: ${second}`);
    if (second !== third) console.log(`         3rd: ${third}`);
  }
}

// A masked label inside an unrelated field must not attract the rule.
const decoys = [
  '{"remark":"姓名","version":"1.2.3"}',
  '{"message":"user_name"}',
];
for (const input of decoys) {
  const once = sanitize(input, { mode: 'label' }).text;
  const twice = sanitize(once, { mode: 'label' }).text;
  const ok = once === twice;
  if (!ok) stable = false;
  console.log(`${ok ? 'STABLE ' : 'DRIFT  '} [decoy] ${input} -> ${once}`);
}

console.log(stable ? '\nRESULT: idempotent' : '\nRESULT: drift detected');
process.exit(stable ? 0 : 1);
