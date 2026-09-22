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
