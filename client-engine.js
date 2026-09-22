/**
 * GENERATED FILE — do not edit.
 *
 * Browser module-table form of `engine.js`, produced by `npm run build`.
 * The rules, validators and masking logic are the ones in `engine.js`; read
 * that file, and run `npm test` to verify the behavior.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-data-mask/engine',
  factory() {
    const MODES = ['label', 'partial', 'redact'];
    
    const FALLBACK = '***';
    
    function keep(raw, head, tail, width = 4) {
      const size = raw.length;
      const h = Math.max(0, Math.min(head, size));
      const t = Math.max(0, Math.min(tail, Math.max(0, size - h)));
      const lead = raw.slice(0, h);
      const trail = t > 0 ? raw.slice(size - t) : '';
      return `${lead}${'*'.repeat(width)}${trail}`;
    }
    
    function digitsOf(raw) {
      return raw.replace(/\D+/g, '');
    }
    
    function luhn(raw) {
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
    
    function validNationalId(raw) {
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
    
    function validChinaPhone(raw) {
      const digits = digitsOf(raw);
      if (digits.length === 11) return /^1[3-9]\d{9}$/.test(digits);
      if (digits.length >= 10 && digits.length <= 12) return /^0\d{9,11}$/.test(digits);
      return false;
    }
    
    function looksLikeJwt(raw) {
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
    
    function privateIpv4(raw) {
      const parts = raw.split('.').map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
      const [a, b] = parts;
      if (a === 10 || a === 127) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 169 && b === 254) return true;
      return false;
    }
    
    function isIpv6(raw) {
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
    
    function connectionTarget(raw) {
      const uri = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
      if (uri !== null) return `[${uri[1]} 连接串]`;
      const assignment = /^([A-Za-z_][A-Za-z0-9_-]*)\s*[=:]/i.exec(raw);
      return assignment === null ? '[连接串]' : `${assignment[1]} --> [连接串]`;
    }
    
    const RULES = [
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
    
    const OVERRIDABLE = ['enabled', 'mode', 'mask'];
    
    function defaultRules() {
      return RULES.map((rule) => ({ ...rule }));
    }
    
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
    
    function sanitize(text, options = {}) {
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
    
    function replacementFor(rule, value, strategy) {
      if (typeof rule.maskWith === 'function') return rule.maskWith(value);
      if (typeof rule.mask === 'string' && rule.mask !== '') {
        return rule.mask.replace(/\{value\}/g, value);
      }
      if (strategy === 'redact') return '*'.repeat(Math.max(3, Math.min(value.length, 12)));
      if (strategy === 'partial') return partialFor(rule.id, value);
      return `[${rule.label}]`;
    }
    
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
    
    function parseCustomRules(text) {
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
    
    function formatCustomRules(rules) {
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
    return { MODES, RULES, sanitize, parseCustomRules, formatCustomRules, defaultRules, luhn, validNationalId, validChinaPhone, looksLikeJwt, privateIpv4, isIpv6 };
  },
});
