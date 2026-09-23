import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitize,
  parseCustomRules,
  formatCustomRules,
  luhn,
  validNationalId,
  looksLikeJwt,
  privateIpv4,
  isIpv6,
} from '../engine.js';

/** Convenience: mask and return only the text. */
function mask(text, options) {
  return sanitize(text, options).text;
}

test('label mode replaces each sensitive value with its type label', () => {
  const input = '客户张三 电话 13812345678，邮箱 zhangsan@example.com，麻烦今天回访。';
  const output = mask(input);
  assert.equal(output, '客户张三 电话 [手机号/固话]，邮箱 [邮箱地址]，麻烦今天回访。');
});

test('a valid 18-digit national id is masked, an invalid checksum is left alone', () => {
  const good = sanitize('身份证 110101199003078515 请核对', { mode: 'label' });
  assert.equal(good.text, '身份证 [身份证号] 请核对');
  assert.deepEqual(good.hits.map((hit) => hit.id), ['nationalid']);

  // Same digits, last character changed: the GB 11643 checksum no longer holds.
  assert.equal(mask('编号 110101199003078514 结束'), '编号 110101199003078514 结束');
});

test('bank card masking requires the Luhn checksum', () => {
  // 4111 1111 1111 1111 is a Luhn-valid test number.
  assert.equal(mask('卡号 4111111111111111 请查收'), '卡号 [银行卡号] 请查收');
  assert.equal(mask('订单号 4111111111111112 请查收'), '订单号 4111111111111112 请查收');
});

test('a 16-digit card is never re-masked as a phone or an ID', () => {
  const { hits } = sanitize('卡号 4111111111111111');
  assert.deepEqual(hits, [{ id: 'bankcard', label: '银行卡号', count: 1 }]);
});

test('API keys, JWTs, bearer tokens and PEM blocks are all caught', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
  assert.equal(mask(pem), '[证书/私钥]');
  assert.equal(mask('凭证 sk-abcdefghijklmnopqrstuvwxyz012345 收'), '凭证 [API 密钥] 收');
  assert.equal(mask('git push ghp_abcdefghijklmnopqrstuvwx'), 'git push [API 密钥]');
  // The JWT rule outranks the Authorization-header rule, so the scheme word stays.
  assert.equal(mask('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefg'), 'Authorization: Bearer [JWT 令牌]');
  assert.equal(mask('Authorization: Bearer abcdefghijklmnopqrstuvwxyz'), 'Authorization: [Authorization 头]');
  assert.equal(mask('token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefg'), 'token: [JWT 令牌]');
});

test('connection strings keep their scheme but lose their credentials', () => {
  assert.equal(
    mask('jdbc 用 mysql://root:Pa55w0rd@10.0.0.8:3306/efms 连'),
    'jdbc 用 [mysql 连接串] 连',
  );
  assert.equal(mask('password=P@ssw0rd2024'), 'password --> [连接串]');
  assert.equal(mask('key=sk-abcdefghijklmnopqrstuvwxyz012345'), 'key --> [连接串]');
});

test('private IPs are masked while public IPs are left readable', () => {
  assert.equal(mask('内网 192.168.1.10 与 10.20.30.40'), '内网 [内网 IP 地址] 与 [内网 IP 地址]');
  assert.equal(mask('公网 8.8.8.8 正常'), '公网 8.8.8.8 正常');
});

test('a MAC address is not mistaken for a one-group IPv6 address', () => {
  assert.deepEqual(sanitize('MAC 00:1A:2B:3C:4D:5E 结束').hits.map((hit) => hit.id), ['mac']);
  assert.equal(mask('MAC 00:1A:2B:3C:4D:5E 结束'), 'MAC [MAC 地址] 结束');
});

test('both compressed and full IPv6 addresses are masked', () => {
  assert.equal(mask('网关 fe80::1 不可用'), '网关 [IPv6 地址] 不可用');
  assert.equal(
    mask('地址 2001:0db8:85a3:0000:0000:8a2e:0370:7334 正常'),
    '地址 [IPv6 地址] 正常',
  );
  // Source-code spellings of the loopback address are not IPv6 values here.
  assert.equal(mask('作用域 ::1 与 :: 保留'), '作用域 ::1 与 :: 保留');
});

test('partial mode keeps a readable head and tail', () => {
  assert.equal(mask('电话 13812345678', { mode: 'partial' }), '电话 138****5678');
  assert.equal(mask('卡号 4111111111111111', { mode: 'partial' }), '卡号 4111****1111');
  assert.equal(mask('邮箱 zhangsan@example.com', { mode: 'partial' }), '邮箱 zh***@example.com');
  // The hidden run has a fixed width, so the original length never leaks.
  assert.equal(mask('身份证 110101199003078515', { mode: 'partial' }), '身份证 110101****8515');
});

test('redact mode hides the value length', () => {
  // The asterisk run is capped, so neither a short nor a long value leaks its size.
  assert.equal(mask('电话 13812345678', { mode: 'redact' }), '电话 ***********');
  assert.equal(mask('卡号 4111111111111111', { mode: 'redact' }), '卡号 ************');
});

test('a per-rule override wins over the global mode', () => {
  const output = mask('电话 13812345678 邮箱 a@b.com', {
    mode: 'partial',
    ruleOverrides: { phone: { mode: 'label' }, email: { mask: '[邮箱已隐藏]' } },
  });
  assert.equal(output, '电话 [手机号/固话] 邮箱 [邮箱已隐藏]');
});

test('the master switch and per-rule disable both stop masking', () => {
  assert.equal(mask('电话 13812345678', { enabled: false }), '电话 13812345678');
  assert.equal(mask('电话 13812345678', { ruleOverrides: { phone: { enabled: false } } }), '电话 13812345678');
});

test('multiple groups in one paste are counted individually', () => {
  const { hits, total } = sanitize('13812345678 和 13998765432 都是手机号');
  assert.equal(total, 2);
  assert.deepEqual(hits, [{ id: 'phone', label: '手机号/固话', count: 2 }]);
});

test('ordinary prose, dates, versions, prices and times survive untouched', () => {
  const input = '今天 2024-03-07 15:30 发布 v1.2.3，金额 12345.67 元，共 3 个文件。';
  assert.equal(mask(input), input);
});

test('empty and non-string input are handled without throwing', () => {
  assert.deepEqual(sanitize(''), { text: '', hits: [], total: 0 });
  assert.equal(sanitize(undefined).text, '');
});

test('custom rules are parsed from the textarea dialect', () => {
  const { rules, bad } = parseCustomRules(
    ['# 工号', '/EMP-\\d{6}/ => [工号]', '内部项目名字 => [项目名]', '/[/ => broken'].join('\n'),
  );
  assert.equal(rules.length, 2);
  assert.equal(bad.length, 1);
  assert.equal(mask('联系人 EMP-123456 与 内部项目名字 甲', { customRules: rules }), '联系人 [工号] 与 [项目名] 甲');
});

test('custom rules survive a round trip through the textarea', () => {
  const source = '/EMP-\\d{6}/i => [工号]';
  const { rules } = parseCustomRules(source);
  assert.equal(formatCustomRules(rules), source);
});

test('a custom rule cannot re-mask a span a built-in rule already claimed', () => {
  const { rules } = parseCustomRules('/\\d{11}/ => [号码]');
  assert.equal(mask('电话 13812345678', { customRules: rules }), '电话 [手机号/固话]');
});

test('a short value under a sensitive field name is replaced by its field label', () => {
  // The requirement: values like `"name":"12312"` or `"no":"1"` can never be
  // recognized by their shape, so the FIELD name is the evidence.
  const output = mask('{"name":"12312","username":"user01","work_no":"A1001","no":"1"}');
  assert.equal(output, '{"name":"姓名","username":"用户名","work_no":"工号","no":"编号"}');
  // The surrounding JSON survives: the quotes are put back.
  assert.deepEqual(JSON.parse(output), {
    name: '姓名', username: '用户名', work_no: '工号', no: '编号',
  });
});

test('the field rule keeps unrelated fields intact', () => {
  // Boundary matching is what makes this safe: `\w*` absorbs a prefix so
  // `order_no` hits `no`, while these stay untouched.
  const input = '{"version":"1.2.3","amount":"12345","country":"+86","support":"team","remark":"ok","dead_day":null,"status":10}';
  assert.equal(mask(input), input);
});

test('a snake or camel case spelling picks the right field label', () => {
  assert.equal(mask('{"user_name":"u1"}'), '{"user_name":"用户名"}');
  assert.equal(mask('{"real_name":"张三"}'), '{"real_name":"姓名"}');
  assert.equal(mask('{"id_card":"110101199003078515"}'), '{"id_card":"证件号"}');
  assert.equal(mask('{"mobile":"123"}'), '{"mobile":"手机号"}');
  assert.equal(mask('{"email":"12321"}'), '{"email":"邮箱"}');
});

test('the field rule keeps the spelling and spacing it replaced', () => {
  assert.equal(mask('name = zhangsan'), 'name = [姓名]');
  assert.equal(mask('{"no" : "1"}'), '{"no" : "编号"}');
  assert.equal(mask("{'name': 'x'}"), "{'name': '姓名'}");
  assert.equal(mask('{"name":"张三","phone":"13812345678"}'), '{"name":"姓名","phone":"手机号"}');
});

test('the field rule follows the configured mode', () => {
  // A whole-value label cannot be partially masked, so `partial` masks whole too;
  // `redact` must still redact — it used to be ignored by every maskWith rule.
  assert.equal(mask('{"name":"张三"}', { mode: 'partial' }), '{"name":"姓名"}');
  assert.equal(mask('{"name":"张三"}', { mode: 'redact' }), '{"name":"******"}');
  assert.equal(mask('mysql://root:pw@10.0.0.8/db', { mode: 'redact' }), '[mysql 连接串]');
});

test('masking a field value twice does not drift', () => {
  // The replacement is a label, and a label must not look like a value again:
  // pasting already-masked text back through the engine has to be a no-op.
  for (const mode of ['label', 'partial', 'redact']) {
    for (const input of [
      '{"name":"12312","username":"u1","work_no":"A1001","no":"1"}',
      '{"name":"张三","no":"1"}',
      'name = zhangsan, no = 7',
    ]) {
      const once = mask(input, { mode });
      assert.equal(mask(once, { mode }), once, `drift in ${mode} mode for ${input}`);
    }
  }
  // A label sitting in an unrelated field must not attract the rule either.
  assert.equal(mask('{"remark":"姓名","version":"1.2.3"}'), '{"remark":"姓名","version":"1.2.3"}');
});

test('a field value is never re-masked by a value-shaped rule', () => {
  // The field rule outranks the value rules, so a long phone under `phone` reads
  // as a phone either way, while a 16-digit card under `id_card` is labelled by
  // its FIELD rather than as a bank card.
  assert.deepEqual(sanitize('{"phone":"13812345678"}').hits.map((hit) => hit.id), ['fieldname']);
  assert.deepEqual(sanitize('{"id_card":"4111111111111111"}').hits.map((hit) => hit.id), ['fieldname']);
});

test('a value-shaped match keeps working outside any field', () => {
  const { hits } = sanitize('联系 13812345678 或 zhangsan@example.com');
  assert.deepEqual(hits.map((hit) => hit.id), ['email', 'phone']);
});

test('the exported validators behave as documented', () => {
  assert.equal(luhn('4111 1111 1111 1111'), true);
  assert.equal(luhn('4111111111111112'), false);
  assert.equal(validNationalId('110101199003078515'), true);
  assert.equal(validNationalId('11010119900307851X'), false);
  assert.equal(looksLikeJwt('eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig'), true);
  assert.equal(looksLikeJwt('not-a-header.eyJhIjoxfQ.sig'), false);
  assert.equal(privateIpv4('172.20.1.1'), true);
  assert.equal(privateIpv4('172.32.1.1'), false);
  assert.equal(isIpv6('fe80::1'), true);
  assert.equal(isIpv6('1:2:3:4:5:6:7:8'), true);
  assert.equal(isIpv6('1:2:3:4:5:6:7:8:9'), false);
  assert.equal(isIpv6('10:30'), false);
});
