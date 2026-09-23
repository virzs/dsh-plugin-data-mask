/**
 * Paste-time data masking engine.
 *
 * Pure ESM with no runtime dependencies so the same module runs inside the
 * browser Client half (`client.js`), inside the Node test suite, and inside any
 * other consumer that wants the same rules.
 *
 * A rule claims a span of the pasted text; overlapping rules never both fire,
 * the first rule (and inside a rule, the leftmost match) wins. Every claim is
 * then replaced by its mask strategy.
 */

/** Mask strategies offered in the settings panel. */
export const MODES = ['label', 'partial', 'redact'];

/** Default replacement for a rule whose `mask` is not an explicit string. */
const FALLBACK = '***';

/**
 * Partial masking: keep the first `head` and last `tail` characters, hide the
 * rest behind a fixed-width asterisk run so the masked value leaks neither the
 * original length nor the hidden digits.
 * @param raw - matched text.
 * @param head - leading characters to keep.
 * @param tail - trailing characters to keep.
 * @param width - asterisk count between them.
 */
function keep(raw, head, tail, width = 4) {
  const size = raw.length;
  const h = Math.max(0, Math.min(head, size));
  const t = Math.max(0, Math.min(tail, Math.max(0, size - h)));
  const lead = raw.slice(0, h);
  const trail = t > 0 ? raw.slice(size - t) : '';
  return `${lead}${'*'.repeat(width)}${trail}`;
}

/** Strip every non-digit character. */
function digitsOf(raw) {
  return raw.replace(/\D+/g, '');
}

/**
 * Luhn checksum, the acceptance test for a plausible bank card number.
 * @param raw - digits, separators allowed.
 */
export function luhn(raw) {
  const digits = digitsOf(raw);
  if (digits.length < 12 || digits.length > 19) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * GB 11643-1999 checksum for an 18-digit mainland China ID number, plus a
 * plausible birth date. 15-digit legacy numbers only get a date sanity check.
 * @param raw - the matched ID text.
 */
export function validNationalId(raw) {
  const value = raw.trim().toUpperCase();
  if (/^\d{15}$/.test(value)) {
    return plausibleDate(value.slice(6, 12));
  }
  if (!/^\d{17}[\dX]$/.test(value)) return false;
  if (!plausibleDate(value.slice(6, 14))) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += (value.charCodeAt(i) - 48) * weights[i];
  return checks[sum % 11] === value[17];
}

/** @param value - `yyyymmdd` or `yymmdd` text. */
function plausibleDate(value) {
  let year;
  let month;
  let day;
  if (value.length === 8) {
    year = Number(value.slice(0, 4));
    month = Number(value.slice(4, 6));
    day = Number(value.slice(6, 8));
  } else if (value.length === 6) {
    year = 1900 + Number(value.slice(0, 2));
    month = Number(value.slice(2, 4));
    day = Number(value.slice(4, 6));
  } else {
    return false;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  return year >= 1900 && year <= 2100;
}

/** A 13-digit mainland mobile number, or a landline with an area code. */
export function validChinaPhone(raw) {
  const digits = digitsOf(raw);
  if (digits.length === 11) return /^1[3-9]\d{9}$/.test(digits);
  if (digits.length >= 10 && digits.length <= 12) return /^0\d{9,11}$/.test(digits);
  return false;
}

/** A JWT is only a JWT when its header really is a base64url JSON header. */
export function looksLikeJwt(raw) {
  const [header] = raw.split('.');
  if (header === undefined) return false;
  try {
    const normalized = header.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded = atob(padded);
    // The prefix regex already saw `eyJ`; a real header must decode to JSON.
    return decoded.startsWith('{') && (decoded.includes('alg') || decoded.includes('typ'));
  } catch {
    return false;
  }
}

/** Private IPv4 ranges (RFC 1918) plus loopback and link-local. */
export function privateIpv4(raw) {
  const parts = raw.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * Structural IPv6 test, so the deliberately broad match pattern can be narrowed
 * to real addresses: every group is 1-4 hex digits, and either `::` compresses
 * the middle or all eight groups are present. The bare loopback forms
 * (`::1`, `::`) are skipped because source code is full of them.
 * @param raw - the candidate address text.
 */
export function isIpv6(raw) {
  // The compressed loopback forms double as source-code spellings (`::1`, `::`).
  if (raw === '::1' || raw === '::') return false;
  if (!/^[0-9A-Fa-f:]+$/.test(raw)) return false;
  if (/^[0-9A-Fa-f]{1,2}(:[0-9A-Fa-f]{1,2}){5}$/.test(raw)) return false; // that is a MAC address
  const [head, tail, ...rest] = raw.split('::');
  if (rest.length > 0 || head === undefined) return false;
  const groups = (part) => (part === '' || part === undefined ? [] : part.split(':'));
  const parse = (part) => {
    const list = groups(part);
    return list.every((group) => /^[0-9A-Fa-f]{1,4}$/.test(group)) ? list : null;
  };
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  if (left === null || right === null) return false;
  if (tail === undefined) return left.length === 8;
  const filled = left.length + right.length;
  if (filled >= 8) return false;
  return filled > 0 || tail !== '';
}

/**
 * A connection string keeps the part that is useful context and loses the
 * secret with it: a URI keeps its scheme, and a `key=value` assignment
 * collapses to `key --> [连接串]`.
 * @param raw - the whole matched connection string.
 */
function connectionTarget(raw, strategy) {
  void strategy;
  const uri = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  if (uri !== null) return `[${uri[1]} 连接串]`;
  const assignment = /^([A-Za-z_][A-Za-z0-9_-]*)\s*[=:]/i.exec(raw);
  return assignment === null ? '[连接串]' : `${assignment[1]} --> [连接串]`;
}

/**
 * Per-field labels for the field-name rule, so `"name":"张三"` becomes
 * `"name": "姓名"` rather than a generic `[敏感字段值]`.
 *
 * The keys are the keyword alternatives of that rule's pattern, and matching is
 * longest-keyword-first so `username` wins over `name`.
 */
const FIELD_LABELS = [
  ['user_name', '用户名'],
  ['real_name', '姓名'],
  ['nick_name', '昵称'],
  ['user_name', '用户名'],
  ['work_no', '工号'],
  ['workno', '工号'],
  ['username', '用户名'],
  ['nickname', '昵称'],
  ['realname', '姓名'],
  ['id_card', '证件号'],
  ['idcard', '证件号'],
  ['id_no', '证件号'],
  ['uname', '用户名'],
  ['phone', '手机号'],
  ['mobile', '手机号'],
  ['email', '邮箱'],
  ['name', '姓名'],
  ['user', '用户'],
  ['tel', '电话'],
  ['mail', '邮箱'],
  ['idno', '证件号'],
  ['no', '编号'],
  ['account', '账号'],
];

/**
 * Replace a field's value with a label chosen from the field's own name.
 *
 * The field name, its quoting style and the original spacing are preserved so
 * the surrounding JSON stays parseable and the diff stays readable. In `partial`
 * mode this deliberately masks WHOLE (like `label`): the value was replaced
 * because of its field, and a short value would be mostly revealed by a partial
 * mask, which is the opposite of the point.
 *
 * @param raw - the whole `"field": value` match.
 * @param strategy - the resolved mask strategy (`label` / `partial` / `redact`).
 * @returns the same field with its value replaced.
 */
function fieldNameTarget(raw, strategy) {
  const parts = /^(["']?)([^"':=\s]+)\1(\s*[:=]\s*)([\s\S]*)$/.exec(raw);
  if (parts === null) return '[敏感字段值]';
  const [, quote, field, separator, value] = parts;
  const lowered = field.toLowerCase();
  const key = FIELD_LABELS
    .slice()
    .sort((left, right) => right[0].length - left[0].length)
    .find(([keyword]) => lowered.includes(keyword));
  const label = key === undefined ? '敏感字段值' : key[1];
  const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  const rendered = strategy === 'redact' ? '******' : label;
  // Keep the value's own quoting style so nothing downstream has to re-parse it.
  const masked = quote === '' && !quoted ? `[${rendered}]` : `${quoted ? value.charAt(0) : ''}${rendered}${quoted ? value.charAt(0) : ''}`;
  return `${quote}${field}${quote}${separator}${masked}`;
}

/**
 * The built-in rule table.
 *
 * `order` is the priority: the more specific a pattern, the earlier it sits, so
 * a 16-digit card is never eaten by the phone rule, a MAC address is never
 * mistaken for a one-group IPv6 address, and an API key containing digits is
 * never eaten by anything else.
 *
 * A rule deliberately does NOT pin its own `mask`: the chosen mode owns the
 * output shape (`label` / `partial` / `redact`), and a settings override may
 * pin a literal per rule when the user wants one.
 */
export const RULES = [
  {
    id: 'pem',
    label: '证书/私钥',
    hint: 'PEM 私钥或证书块',
    order: 10,
    enabled: true,
    find: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
  },
  {
    id: 'jwt',
    label: 'JWT 令牌',
    hint: '三段式 JSON Web Token',
    order: 20,
    enabled: true,
    find: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/g,
    validate: looksLikeJwt,
  },
  {
    id: 'connection',
    label: '数据库连接串',
    hint: '含账号密码的连接 URI，或 password=/api_key= 赋值',
    // Ahead of the API-key rule on purpose: `key=sk-…` is an assignment, and the
    // assignment form explains the removal better than a bare key label does.
    order: 25,
    enabled: true,
    // The whole URI goes, host and database name included; only the scheme is
    // echoed back by `maskWith`. `\w*` prefixes are deliberate: that is what
    // lets `api_key=`, `dbPassword=` and a bare `key=` share one alternative.
    find: /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>]*:[^\s"'`<>]*@[^\s"'`<>]+|\b\w*(?:pass(word|wd)?|pwd|key|token)\s*[=:]\s*["']?[^\s"',;]{6,}["']?/gi,
    maskWith: connectionTarget,
  },
  {
    id: 'fieldname',
    label: '敏感字段值',
    hint: '键名像 name/username/work_no/no/phone/id_card 时，值无条件替换',
    // Runs before every value-shaped rule: a short value such as `"name":"12312"`
    // or `"no":"1"` can never be recognized by its shape, and when a field is
    // identified the field itself is the evidence, so the value is replaced
    // whatever it looks like.
    order: 28,
    enabled: true,
    // The value is matched generously (any quoted string, or a bare number/word)
    // because the field name already decided; the replacement puts the quotes
    // back so the surrounding JSON stays valid.
    //
    // Boundaries matter here: `\w*` absorbs a prefix (`work_no` → `no`, and on
    // the label side `order_no` → `no`), while the boundary before the keyword and
    // the one after it keep `version`, `amount`, `support`, `country` and
    // `username` (matched as `user_name`/`_name`, not as `uname`) intact.
    find: /(["']?)(?:[\w-]*(?:name|username|uname|user|realname|nickname|account)|[\w-]*(?:phone|mobile|tel|email|mail|idcard|id_card|idno|id_no)\b[\w-]*|(?:[\w-]*_)?no|workno|work_no)\1\s*[:=]\s*("[^"]*"|'[^']*'|[\w.-]+)/gi,
    maskWith: fieldNameTarget,
  },
  {
    id: 'secret',
    label: 'API 密钥',
    hint: 'sk-/ghp_/AKIA 等常见密钥前缀',
    order: 30,
    enabled: true,
    find: /\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{16,}\b|\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: 'bearer',
    label: 'Authorization 头',
    hint: 'Bearer / Basic 凭据',
    order: 40,
    enabled: true,
    find: /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  },
  {
    id: 'bankcard',
    label: '银行卡号',
    hint: '13-19 位数字，需通过 Luhn 校验',
    order: 60,
    enabled: true,
    find: /(?<![\d-])(?:\d{4}[ -]){3}\d{4}(?:[ -]\d{1,3})?(?![\d-])|(?<!\d)\d{13,19}(?!\d)/g,
    validate: (raw) => luhn(raw),
  },
  {
    id: 'nationalid',
    label: '身份证号',
    hint: '18 位（含校验位）或 15 位中国身份证',
    order: 70,
    enabled: true,
    find: /(?<![\dXx])\d{17}[\dXx](?![\dXx])|(?<!\d)\d{15}(?!\d)/g,
    validate: validNationalId,
  },
  {
    id: 'email',
    label: '邮箱地址',
    hint: '常见邮箱写法',
    order: 80,
    enabled: true,
    find: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
  },
  {
    id: 'phone',
    label: '手机号/固话',
    hint: '11 位手机号，或带区号的固话',
    order: 90,
    enabled: true,
    find: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)|(?<!\d)0\d{2,3}[-\s]\d{7,8}(?!\d)/g,
    validate: validChinaPhone,
  },
  {
    id: 'mac',
    label: 'MAC 地址',
    hint: '冒号或短横线分隔的物理地址',
    order: 100,
    enabled: true,
    find: /(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f])/g,
  },
  {
    id: 'ipv4',
    label: '内网 IP 地址',
    hint: '10./192.168./172.16-31. 等私有网段',
    order: 110,
    enabled: true,
    find: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g,
    validate: privateIpv4,
  },
  {
    id: 'ipv6',
    label: 'IPv6 地址',
    hint: '真实 IPv6 地址，含 :: 压缩写法',
    order: 120,
    enabled: true,
    // A candidate is any run of hex digits and colons that contains at least one
    // colon and one hex digit; `isIpv6` then decides whether it really is one.
    find: /(?<![0-9A-Za-z:])(?=[0-9A-Fa-f:]*:)[0-9A-Fa-f:]*[0-9A-Fa-f][0-9A-Fa-f:]*(?![0-9A-Za-z:])/g,
    validate: isIpv6,
  },
  {
    id: 'qq',
    label: 'QQ 号',
    hint: '“QQ: 12345678” 这类带前缀的号码',
    order: 130,
    enabled: false,
    find: /(?<=\bQQ[：:\s]{1,3})\d{5,11}\b/gi,
  },
];

/** Fields of a rule that a user may override from the settings panel. */
const OVERRIDABLE = ['enabled', 'mode', 'mask'];

/** @returns a fresh deep copy of the built-in table. */
export function defaultRules() {
  return RULES.map((rule) => ({ ...rule }));
}

/**
 * Compile one rule coming from the persisted settings, tolerating an invalid
 * regular expression by disabling that single rule instead of throwing.
 * @param source - a rule whose `find` is either a RegExp or a `/pattern/flags` string.
 * @returns the rule with a usable `find`, or `null` when the pattern is broken.
 */
function compileRule(source) {
  if (source.find instanceof RegExp) return source.find.global ? source : { ...source, find: new RegExp(source.find.source, `${source.find.flags}g`) };
  if (typeof source.find !== 'string') return null;
  const literal = /^\/(.+)\/([a-z]*)$/s.exec(source.find);
  try {
    if (literal) return { ...source, find: new RegExp(literal[1], literal[2].includes('g') ? literal[2] : `${literal[2]}g`) };
    return { ...source, find: new RegExp(source.find, 'g') };
  } catch {
    return null;
  }
}

/**
 * Apply the built-in rule table, the user's per-rule overrides, and the user's
 * own rules to one string.
 *
 * @param text - the raw pasted text.
 * @param options - masking configuration.
 * @param options.enabled - master switch; `false` returns the input untouched.
 * @param options.mode - the mask strategy used when a rule does not pin its own.
 * @param options.ruleOverrides - `{ [ruleId]: { enabled?, mode?, mask? } }` for built-in rules.
 * @param options.customRules - user rules, applied after every built-in rule.
 * @returns the masked text plus one hit per rule that fired.
 */
export function sanitize(text, options = {}) {
  const input = typeof text === 'string' ? text : '';
  const enabled = options.enabled !== false;
  const mode = MODES.includes(options.mode) ? options.mode : 'label';
  if (!enabled || input === '') return { text: input, hits: [], total: 0 };

  const overrides = options.ruleOverrides ?? {};
  const table = [...defaultRules()];

  for (const custom of options.customRules ?? []) {
    if (custom?.enabled === false) continue;
    const compiled = compileRule({ ...custom, order: 999 });
    if (compiled !== null) table.push({ ...compiled, builtin: false });
  }

  // `claimed[i]` marks a character already owned by a higher-priority rule.
  const claimed = new Array(input.length).fill(false);
  const spans = [];
  const hits = [];

  const ordered = table
    .map((rule) => {
      const override = overrides[rule.id] ?? {};
      const merged = { ...rule };
      for (const field of OVERRIDABLE) if (override[field] !== undefined) merged[field] = override[field];
      return merged;
    })
    .sort((left, right) => (left.order ?? 500) - (right.order ?? 500));

  for (const rule of ordered) {
    if (rule.enabled === false) continue;
    const pattern = compileRule(rule);
    if (pattern === null) continue;
    const find = pattern.find;
    find.lastIndex = 0;
    let match = find.exec(input);
    let count = 0;
    while (match !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;
      if (value.length > 0 && !claimed.slice(start, end).includes(true) && (rule.validate === undefined || rule.validate(value) === true)) {
        for (let i = start; i < end; i += 1) claimed[i] = true;
        spans.push({ start, end, rule, value });
        count += 1;
      }
      if (find.lastIndex <= start) find.lastIndex = start + 1;
      match = find.exec(input);
    }
    if (count > 0) hits.push({ id: rule.id, label: rule.label, count });
  }

  spans.sort((left, right) => left.start - right.start);
  let output = '';
  let cursor = 0;
  for (const span of spans) {
    output += input.slice(cursor, span.start);
    // The global mode is the default; a rule override (`merged.mode`) outranks it.
    output += replacementFor(span.rule, span.value, span.rule.mode ?? mode);
    cursor = span.end;
  }
  output += input.slice(cursor);

  const total = hits.reduce((sum, hit) => sum + hit.count, 0);
  return { text: output, hits, total };
}

/**
 * Resolve the replacement text for one claimed span.
 *
 * Precedence: an explicit per-rule `maskWith` (a function) or `mask` (a string)
 * wins, because it was set deliberately; otherwise the strategy is the already
 * resolved `strategy` — a rule override when there is one, the global mode
 * otherwise.
 * @param rule - the rule that claimed the span.
 * @param value - the original matched text.
 * @param strategy - the resolved mask strategy.
 */
function replacementFor(rule, value, strategy) {
  if (typeof rule.maskWith === 'function') return rule.maskWith(value, strategy);
  if (typeof rule.mask === 'string' && rule.mask !== '') {
    return rule.mask.replace(/\{value\}/g, value);
  }
  if (strategy === 'redact') return '*'.repeat(Math.max(3, Math.min(value.length, 12)));
  if (strategy === 'partial') return partialFor(rule.id, value);
  return `[${rule.label}]`;
}

/**
 * Per-rule partial masking, so the kept head/tail characters stay meaningful
 * for that identifier instead of following one generic split.
 * @param id - built-in rule id.
 * @param value - the original matched text.
 */
function partialFor(id, value) {
  switch (id) {
    case 'phone':
    case 'qq':
      return keep(value, 3, 4);
    case 'nationalid':
      return keep(value, 6, 4);
    case 'bankcard':
      return keep(value, 4, 4);
    case 'email': {
      const at = value.lastIndexOf('@');
      if (at <= 0) return FALLBACK;
      const local = value.slice(0, at);
      const head = local.slice(0, Math.min(2, local.length));
      return `${head}***${value.slice(at)}`;
    }
    case 'secret':
    case 'jwt':
    case 'bearer':
      return keep(value, 4, 4);
    case 'ipv4':
    case 'ipv6':
      return keep(value, 4, 3);
    case 'mac':
      return keep(value, 5, 2);
    default:
      return FALLBACK;
  }
}

/**
 * Turn the free-form custom-rule textarea into rule objects.
 *
 * Accepted lines (blank lines and `#` comments are ignored):
 * - `/正则/flags` — matched text becomes `[自定义]`
 * - `/正则/flags => 替换文本` — replacement may contain `$1`… and `{value}`
 * - `正则 => 替换文本` — the slashes are optional
 *
 * @param text - the textarea body.
 * @returns one rule per accepted line; `bad` collects rejected lines.
 */
export function parseCustomRules(text) {
  const rules = [];
  const bad = [];
  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    const arrow = trimmed.indexOf('=>');
    const body = (arrow === -1 ? trimmed : trimmed.slice(0, arrow)).trim();
    const replacement = arrow === -1 ? '' : trimmed.slice(arrow + 2).trim();
    const literal = /^\/(.+)\/([a-z]*)$/s.exec(body);
    const source = literal ? literal[1] : body;
    const flags = literal ? literal[2] : '';
    let find;
    try {
      find = new RegExp(source, flags.includes('g') ? flags : `${flags}g`);
    } catch (error) {
      bad.push({ line: index + 1, text: trimmed, reason: String(error?.message ?? error) });
      return;
    }
    rules.push({
      id: `custom-${index + 1}`,
      label: '自定义',
      hint: trimmed,
      order: 900,
      enabled: true,
      builtin: false,
      mode: 'label',
      find,
      mask: replacement === '' ? '[自定义]' : replacement,
    });
  });
  return { rules, bad };
}

/**
 * Two-way serialization for the custom-rule textarea, so a round trip through
 * the settings panel does not rewrite the user's lines.
 * @param rules - parsed custom rules.
 */
export function formatCustomRules(rules) {
  return (rules ?? [])
    .map((rule) => {
      const find = rule.find instanceof RegExp ? rule.find : compileRule(rule)?.find;
      if (!(find instanceof RegExp)) return '';
      const flags = find.flags.replace('g', '');
      const body = `/${find.source}/${flags}`;
      const mask = typeof rule.mask === 'string' ? rule.mask : '';
      return mask === '' || mask === '[自定义]' ? body : `${body} => ${mask}`;
    })
    .filter((line) => line !== '')
    .join('\n');
}
