/**
 * Client half of the data-mask bundle.
 *
 * Three pieces, one purpose:
 *
 * 1. A capture-phase `paste` listener on `window`. It runs before the
 *    composer's own Lexical root listener, so a pasted string can be rewritten
 *    before the editor ever sees it. When something was masked, a fresh
 *    `ClipboardEvent` carrying the masked text is dispatched at the same
 *    editable element, so the composer's normal paste path — undo boundary,
 *    reference-chip sanitizing and all — still runs.
 * 2. A notice under the composer card that names what was masked and offers
 *    **按住查看原文** (the original is shown only while the button is held, like
 *    a password field's reveal) and **撤销** (puts the original text back).
 * 3. A settings page inside the shell's own Settings panel (`settings.section`),
 *    reached from the sidebar foot: master switch, mask style, per-rule toggles,
 *    a custom-rule editor, and a live preview.
 *
 * Failure containment is deliberate. This bundle runs at web boot, and the boot
 * gate refuses to start the GUI when an entry does not reach `active`, so:
 * `inject` names only `slots`, every `ctx` call is wrapped, every optional
 * module is feature detected, and React children sit behind an error boundary.
 *
 * The masking engine below is generated from `engine.js` by
 * `scripts/build-client.mjs` and inlined on purpose: the browser module table
 * cannot resolve a package subpath, and a failed `require` here rejects the
 * whole import, which fails the boot gate.
 *
 * The original text of a masked paste is kept in memory only, is dropped after
 * 10 minutes, and is never written to storage or sent anywhere.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-data-mask',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const {
      useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
    } = React;

    /**
     * Shell primitives (`Switch`, `Checkbox`, `SegmentedControl`, …), so the
     * settings page uses the same controls as a built-in section. Optional: the
     * page falls back to native controls when the module is unavailable.
     */
    let Field = null;
    try {
      Field = require('@deepseek-ai/dsh-client-ui-primitives');
    } catch (error) {
      console.warn('[data-mask] shell primitives are unavailable, falling back to native controls:', error);
    }

    // #region generated engine (scripts/build-client.mjs)
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

    function connectionTarget(raw, strategy) {
      void strategy;
      const uri = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
      if (uri !== null) return `[${uri[1]} 连接串]`;
      const assignment = /^([A-Za-z_][A-Za-z0-9_-]*)\s*[=:]/i.exec(raw);
      return assignment === null ? '[连接串]' : `${assignment[1]} --> [连接串]`;
    }

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
      if (typeof rule.maskWith === 'function') return rule.maskWith(value, strategy);
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
    // #endregion generated engine

    /** localStorage key holding the persisted configuration. */
    const STORAGE_KEY = 'dsh.data-mask.settings.v1';
    /** Locale namespace for every visible string in this plugin. */
    const NS = 'data-mask';
    /** How long a masked paste stays undoable (and its original in memory). */
    const RECORD_TTL_MS = 10 * 60 * 1000;
    /** The editable selector used to recognize a composer field. */
    const EDITABLE_SELECTOR = '[contenteditable=""],[contenteditable="true"],textarea,input';
    /** Placeholder editors carry, which must not be mistaken for draft text. */
    const ZERO_WIDTH = /\u200b/g;

    const DICTIONARIES = {
      zh: {
        'nav.label': '数据脱敏',
        'page.description': '粘贴到输入框时先替换敏感信息，再把脱敏文本放进草稿；原文不会被发送给模型。',
        'enabled.label': '启用粘贴脱敏',
        'enabled.description': '关闭后粘贴不再改写，已经进入草稿的文本不受影响。',
        'mode.label': '替换方式',
        'mode.description': '决定命中敏感信息后写入草稿的形态。',
        'mode.option.label': '整体替换',
        'mode.option.partial': '部分掩码',
        'mode.option.redact': '星号覆盖',
        'mode.hint.label': '写成 [手机号/固话] 这样的类型标签，最安全。',
        'mode.hint.partial': '保留头尾便于辨认，例如 138****5678；隐藏部分定长，不泄露原长度。',
        'mode.hint.redact': '用定长星号覆盖，连长度也不暴露。',
        'rules.label': '识别规则',
        'rules.description': '关闭的规则不参与替换，其余规则不受影响。',
        'rules.on': '已启用 {count} 条规则',
        'custom.label': '自定义规则',
        'custom.description': '每行一条：/正则/标志 => 替换文本，例如 /EMP-\\d{6}/ => [工号]；# 开头的行会被忽略。',
        'custom.placeholder': '/EMP-\\d{6}/ => [工号]',
        'custom.count': '已生效 {count} 条',
        'custom.invalid': '第 {line} 行正则无效：{reason}',
        'test.label': '试一下',
        'test.description': '输入或粘贴样例，立即查看替换结果。',
        'test.placeholder': '粘贴一段含敏感信息的文本',
        'test.output': '替换结果',
        'test.empty': '未命中任何敏感信息',
        'test.hits': '命中 {count} 处：{list}',
        'last.label': '最近一次粘贴：脱敏 {count} 处',
        'last.none': '还没有拦截到粘贴记录',
        'notice.title': '已脱敏 {count} 处',
        'notice.titleWithPreview': '已脱敏 {count} 处：{preview}',
        'notice.view': '按住查看原文',
        'notice.revealed': '输入框已切到原文（共 {total} 处敏感信息），松开即恢复脱敏文本',
        'notice.viewHint': '按住时输入框临时显示原文，松开立即恢复脱敏文本',
        'notice.undo': '撤销脱敏',
        'notice.undoHint': '把原文放回输入框（仅当草稿未被改动且仍在 10 分钟内可用）',
        'notice.undone': '已撤销，原文已放回输入框',
        'notice.failed': '无法撤销：草稿已被修改，或输入框不可编辑',
        'notice.diverged': '草稿已被修改，撤销已停用（原文仍在剪贴板）',
        'notice.notApplied': '未能写入输入框，可手动粘贴下面的脱敏文本',
        'notice.copy': '复制脱敏文本',
        'notice.copied': '已复制脱敏文本',
        'notice.autoHide': '{minutes} 分钟后自动清除记录',
        'notice.close': '关闭提示',
      },
      en: {
        'nav.label': 'Data mask',
        'page.description': 'Replaces sensitive values before a paste reaches the composer. The original never reaches the model.',
        'enabled.label': 'Mask on paste',
        'enabled.description': 'When off, pasting is left untouched; text already in the draft is unaffected.',
        'mode.label': 'Replacement style',
        'mode.description': 'What a matched value turns into in the draft.',
        'mode.option.label': 'Type label',
        'mode.option.partial': 'Partial mask',
        'mode.option.redact': 'Redact',
        'mode.hint.label': 'Writes a label such as [phone]; safest.',
        'mode.hint.partial': 'Keeps a readable head and tail, e.g. 138****5678; the hidden run is fixed width, so the original length never leaks.',
        'mode.hint.redact': 'A fixed-width asterisk run: even the length stays hidden.',
        'rules.label': 'Detection rules',
        'rules.description': 'A disabled rule never replaces anything; the others are unaffected.',
        'rules.on': '{count} rules enabled',
        'custom.label': 'Custom rules',
        'custom.description': 'One rule per line: /pattern/flags => replacement, e.g. /EMP-\\d{6}/ => [staff id]. Lines starting with # are ignored.',
        'custom.placeholder': '/EMP-\\d{6}/ => [staff id]',
        'custom.count': '{count} active',
        'custom.invalid': 'Line {line} is not a valid pattern: {reason}',
        'test.label': 'Try it',
        'test.description': 'Type or paste a sample to see the result immediately.',
        'test.placeholder': 'Paste text containing sensitive values',
        'test.output': 'Result',
        'test.empty': 'No sensitive value matched',
        'test.hits': '{count} matched: {list}',
        'last.label': 'Last paste: {count} masked',
        'last.none': 'No paste intercepted yet',
        'notice.title': 'Masked {count} value(s)',
        'notice.titleWithPreview': 'Masked {count}: {preview}',
        'notice.view': 'Hold to reveal',
        'notice.revealed': 'The composer shows the original ({total} sensitive value(s)); release to mask again',
        'notice.viewHint': 'The composer shows the original while held, and masks again on release',
        'notice.undo': 'Undo masking',
        'notice.undoHint': 'Puts the original back into the composer (only while the draft is untouched and within 10 minutes)',
        'notice.undone': 'Undone — the original is back in the composer',
        'notice.failed': 'Cannot undo: the draft changed, or the editor is not editable',
        'notice.diverged': 'The draft changed, so undo is off (the original is still on your clipboard)',
        'notice.notApplied': 'The composer did not accept it — copy the masked text instead',
        'notice.copy': 'Copy masked text',
        'notice.copied': 'Masked text copied',
        'notice.autoHide': 'The record clears in {minutes} min',
        'notice.close': 'Dismiss',
      },
    };

    const DEFAULT_SETTINGS = Object.freeze({ enabled: true, mode: 'label', rules: {}, custom: '' });

    /**
     * Dictionary lookup that does not depend on the locale service.
     *
     * The locale service is read opportunistically in `apply`; this fallback
     * keeps every visible string working (and localized) even when that service
     * is absent or its registration failed, so the feature never disappears.
     * @param key - dictionary key.
     * @param params - `{name}` placeholders to substitute.
     */
    function t(key, params) {
      const dictionary = activeDictionary();
      const template = dictionary[key] ?? DICTIONARIES.zh[key] ?? key;
      if (params === undefined) return template;
      return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
    }

    /**
     * The language the shell is showing.
     *
     * `document.documentElement.lang` is the shell-owned signal (the locale
     * plugin keeps it in sync) and works without the locale service; a stored
     * preference is only a fallback.
     * @returns the dictionary for that language.
     */
    function activeDictionary() {
      try {
        if (typeof document.documentElement.lang === 'string' && /^en\b/i.test(document.documentElement.lang)) {
          return DICTIONARIES.en;
        }
      } catch {
        // A missing document means a non-browser context; Chinese is the default.
      }
      return DICTIONARIES.zh;
    }

    // #region settings store

    /** @returns the persisted settings, or the defaults when storage is unusable. */
    function readSettings() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS };
        return {
          enabled: parsed.enabled !== false,
          mode: MODES.includes(parsed.mode) ? parsed.mode : DEFAULT_SETTINGS.mode,
          rules: parsed.rules !== null && typeof parsed.rules === 'object' ? parsed.rules : {},
          custom: typeof parsed.custom === 'string' ? parsed.custom : '',
        };
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    }

    /** @param settings - the settings to persist; storage failures are non-fatal. */
    function writeSettings(settings) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        // A full or blocked storage only costs persistence, never the feature.
      }
    }

    /**
     * One tiny observable store shared by the paste listener and the React
     * components, so both always read the same state object.
     */
    const store = (() => {
      let settings = readSettings();
      let record = null;
      let customRules = parseCustomRules(settings.custom).rules;
      let expiresAt = 0;
      const listeners = new Set();
      const emit = () => {
        for (const listener of listeners) listener();
      };
      return {
        getSettings: () => settings,
        getRecord: () => record,
        getCustomRules: () => customRules,
        setRecord(next) {
          record = next;
          expiresAt = next === null ? 0 : Date.now() + RECORD_TTL_MS;
          emit();
        },
        /** Drop the record once its undo window has passed. */
        sweep() {
          if (record === null || Date.now() < expiresAt) return;
          record = null;
          expiresAt = 0;
          emit();
        },
        getExpiresAt: () => expiresAt,
        update(patch) {
          const next = { ...settings, ...patch };
          if (patch.rules !== undefined) next.rules = { ...settings.rules, ...patch.rules };
          settings = next;
          customRules = parseCustomRules(settings.custom).rules;
          writeSettings(settings);
          emit();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
    })();

    // #endregion

    // #region paste interception

    /**
     * The effective options for the current settings.
     * @param settings - the live settings snapshot.
     * @param customRules - parsed custom rules.
     */
    function optionsFor(settings, customRules) {
      return {
        enabled: settings.enabled,
        mode: settings.mode,
        ruleOverrides: settings.rules,
        customRules,
      };
    }

    /** @returns the value bounded by the given text node and offset. */
    function boundaryValue(node, offset) {
      if (node === null || node === undefined) return null;
      if (node.nodeType === 3) return { node, offset: Math.max(0, Math.min(offset, node.nodeValue?.length ?? 0)) };
      const child = node.childNodes[Math.max(0, Math.min(offset, node.childNodes.length - 1))];
      return child === undefined ? null : boundaryValue(child, 0);
    }

    /**
     * Whether this paste lands in an editable field.
     * @param event - the paste event.
     */
    function isEditablePaste(event) {
      if (event.target instanceof Element && event.target.closest(EDITABLE_SELECTOR) !== null) return true;
      const ranges = typeof event.getTargetRanges === 'function' ? event.getTargetRanges() : [];
      const [range] = ranges;
      if (range === undefined) return false;
      const bounded = boundaryValue(range.startContainer, range.startOffset);
      return bounded !== null && bounded.node.parentElement?.closest('[contenteditable=""],[contenteditable="true"]') !== null;
    }

    /**
     * Marks a `ClipboardEvent` this plugin dispatched itself, so the interceptor
     * can tell its own writes from a real paste. The masked re-issue and the undo
     * both set it; without it, the undo would be masked straight back.
     */
    const OWN_WRITE = Symbol.for('dsh.data-mask.own-write');

    /**
     * Dispatch one paste carrying `text` at `target`, marked as this plugin's own
     * write so the interceptor ignores it.
     * @param target - the editable element to paste into.
     * @param text - the text to deliver.
     * @returns whether the event reached a listener without throwing.
     */
    function dispatchPaste(target, text) {
      try {
        const data = new DataTransfer();
        data.setData('text/plain', text);
        const event = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        });
        event[OWN_WRITE] = true;
        target.dispatchEvent(event);
        return true;
      } catch {
        // A browser that refuses a synthetic ClipboardEvent reports false; the
        // caller then falls back to the notice's copy button.
        return false;
      }
    }

    /**
     * Install the capture-phase paste listener.
     *
     * Capture on `window` is what makes this work: the listener runs before the
     * composer's own root-element listener, so `preventDefault` there really
     * stops the unmasked text from being inserted.
     *
     * @returns the listener cleanup.
     */
    function attachPasteInterceptor() {
      const onPaste = (event) => {
        const settings = store.getSettings();
        if (!settings.enabled) return;
        if (!(event instanceof ClipboardEvent) || event.clipboardData === null) return;
        // This plugin's own writes (the masked re-issue and the undo) carry a
        // marker; masking them again would fight the undo path.
        if (event[OWN_WRITE] === true) return;
        if (!isEditablePaste(event)) return;

        const original = event.clipboardData.getData('text/plain');
        if (original === '') return;
        const result = sanitize(original, optionsFor(settings, store.getCustomRules()));
        if (result.total === 0) return;

        // Swallow the original paste and re-issue it with the masked text.
        event.preventDefault();
        event.stopImmediatePropagation();

        const target = event.target;
        const editorBefore = target instanceof Element ? target.closest(EDITABLE_SELECTOR) : null;
        const textBefore = editorBefore === null ? null : editorText(editorBefore);

        // NOTE: neither `dispatchEvent`'s return value nor the editor's text is
        // usable here. The composer always prevents the paste default (so the
        // return value is always false), and Lexical applies the insertion
        // *after* this handler returns. Whether the text landed is therefore
        // decided later, by the deferred probe below.
        dispatchPaste(target, result.text);

        store.setRecord({
          at: Date.now(),
          original,
          draft: result.text,
          hits: result.hits,
          total: result.total,
          editor: editorBefore,
          // Whose conversation this is: the sidebar's selected row at paste time.
          sessionKey: currentSessionKey(),
          applied: null,
          swapped: false,
          draftState: 'unknown',
          undone: false,
        });
        pendingProbe = { record: store.getRecord(), before: textBefore };
        scheduleProbe();
      };

      window.addEventListener('paste', onPaste, true);
      return () => {
        window.removeEventListener('paste', onPaste, true);
      };
    }

    // #endregion

    // #region editor access (undo)

    /** The recorded editor, when it is still attached to the page. */
    function liveEditor(record) {
      const recorded = record?.editor;
      if (recorded instanceof HTMLElement && recorded.isConnected) return recorded;
      return null;
    }

    /** The record whose paste success is still being measured, if any. */
    let pendingProbe = null;

    /**
     * Whether the notice still describes anything.
     *
     * Both cases read the composer LIVE rather than trusting a state flag, because
     * `draftState: 'diverged'` also covers the plugin's own reveal: a hold writes
     * the original, which IS "the draft changed" but is emphatically NOT the user
     * discarding the notice.
     *
     * @param record - the masked-paste record.
     * @returns `true` when the composer no longer holds anything this notice is
     * about (deleted, or replaced by text the plugin never wrote).
     */
    function recordStillApplies(record) {
      // An undone record keeps its confirmation whatever the composer holds.
      if (record?.undone === true) return true;
      const editor = liveEditor(record);
      if (editor === null) return false;
      const current = editorText(editor);
      if (current === '') return false;
      return current === record.draft || current === record.original;
    }

    /**
     * The Session the sidebar currently has selected.
     *
     * Switching conversations reuses the composer node — the composer's whole
     * ancestor chain is byte-identical before and after a switch (verified) — so
     * the DOM carries NO conversation identity at the composer. The sidebar's
     * selected row is the one authoritative signal, read from its `data-row-key`.
     *
     * @returns `session:<id>` for a selected row, or null when none is selected
     * (the start screen, or a brand-new Session that has no row yet).
     */
    function currentSessionKey() {
      try {
        const row = document.querySelector('[data-row-key^="session:"][class*="selected"]')
          ?? document.querySelector('[data-row-key^="session:"][aria-selected="true"]');
        return row === null ? null : row.getAttribute('data-row-key');
      } catch {
        return null;
      }
    }

    /**
     * Whether the notice still belongs to the conversation on screen.
     *
     * Identity, not connectivity: the composer outlives a conversation switch, so
     * "the node is still mounted" proves nothing — that was the defect, and the
     * notice followed the user into other conversations. A record made on the
     * start screen carries no key and stays visible until a Session is selected.
     *
     * @param record - the masked-paste record.
     * @returns whether the notice should be shown.
     */
    function recordBelongsToView(record) {
      const now = currentSessionKey();
      const owner = record?.sessionKey ?? null;
      if (owner === null) return now === null;
      return now === owner;
    }

    /**
     * The composer card: the element the shell itself marks.
     *
     * The shell stamps `data-composer-card` on the card, which is the only
     * deterministic anchor here. Geometry does not work: the card is only ~27%
     * narrower than the viewport in the start-screen layout, and in a session it
     * is ~68% narrower, so no single width or height rule identifies it. The
     * ancestor walk remains as a fallback for a shell that stops marking it.
     *
     * @param element - the editable field.
     * @returns the card element, or the field when no card can be identified.
     */
    function composerCardOf(element) {
      const marked = element.closest?.('[data-composer-card]');
      if (marked !== null && marked !== undefined) return marked;
      for (let node = element.parentElement; node !== null && node !== document.body; node = node.parentElement) {
        if (node.hasAttribute('data-slot') && node.getBoundingClientRect().height === 0) break;
        if (node.getAttribute('data-composer-card') !== null) return node;
      }
      return element;
    }

    /**
     * Where the notice belongs: just ABOVE the composer card, never over it, and
     * exactly as wide as the card so the two read as one column.
     *
     * The notice is an annotation about the draft, so it sits outside the input
     * area; overlapping the field would also steal clicks from the text.
     * @returns inline positioning for the overlay, or a fixed fallback.
     */
    function noticePlacement() {
      try {
        const field = document.querySelector('[data-composer-input]')
          ?? document.querySelector('[contenteditable=""],[contenteditable="true"]');
        if (field === null) return { bottom: '18px' };
        const rect = composerCardOf(field).getBoundingClientRect();
        // Anchored by the card's own edges, NOT by centring the overlay in the
        // viewport: the composer column sits beside the sidebar, so a centred
        // overlay is offset from the card by half the sidebar's width.
        return {
          left: `${String(Math.round(rect.left))}px`,
          bottom: `${String(Math.round(Math.max(12, window.innerHeight - rect.top + 8)))}px`,
          width: `${String(Math.round(rect.width))}px`,
        };
      } catch {
        return { bottom: '18px' };
      }
    }

    /** @returns the comparable draft text of a contenteditable / textarea / input. */
    function editorText(element) {
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value;
      return (element.textContent ?? '').replace(ZERO_WIDTH, '');
    }

    /**
     * Whether an element still accepts text.
     *
     * The `contenteditable` attribute is checked directly instead of
     * `HTMLElement.isEditable`: the property is absent in some engines, which
     * would make every undo look impossible.
     *
     * @param element - the editable element.
     */
    function isContentEditable(element) {
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        return !element.disabled && !element.readOnly;
      }
      const value = element.getAttribute('contenteditable');
      return value === '' || value === 'true' || value === 'plaintext-only';
    }

    /**
     * How a record's masked draft relates to what the composer holds now.
     *
     * `swapped` is the state this plugin creates itself while 按住查看原文 is
     * held: the composer briefly carries the original so the user reads it in
     * place. The state is carried on the record (`record.swapped`) because the
     * masked text cannot be derived from the original.
     *
     * @param record - the masked-paste record.
     * @returns `'none'` without an editor, otherwise `'masked'`, `'original'`,
     * `'swapped'`, or `'diverged'` when the user edited the draft since.
     */
    function probeDraft(record) {
      const editor = liveEditor(record);
      if (editor === null) return 'none';
      const current = editorText(editor);
      if (current === record.draft) return 'masked';
      if (current === record.original) return record.swapped === true ? 'swapped' : 'original';
      return 'diverged';
    }

    /**
     * Decide, a tick after a paste or an undo, what the composer actually holds.
     *
     * The composer applies both writes asynchronously and `dispatchEvent` gives
     * no usable verdict, so the verdict is measured afterwards — and a record
     * whose text never arrived is marked `applied: false` rather than claiming
     * an undo that cannot work.
     *
     * @param delay - how long to let the composer settle before measuring.
     */
    function scheduleProbe(delay = 400) {
      window.setTimeout(() => {
        const pending = pendingProbe;
        pendingProbe = null;
        if (pending === null) return;
        const record = store.getRecord();
        if (record !== pending.record) return;
        const draftState = probeDraft(record);
        store.setRecord({
          ...record,
          draftState,
          applied: record.applied === null ? draftState !== 'none' : record.applied,
        });
      }, delay);
    }

    /**
     * Show the original in the COMPOSER while 按住查看原文 is held, and put the
     * masked draft back on release.
     *
     * The reveal is an in-place read: the point is to check what the model will
     * actually receive, in the field it will be sent from. The release restore is
     * skipped when the draft diverged, so a reveal can never clobber an edit the
     * user made while holding.
     *
     * @param record - the masked-paste record.
     * @param reveal - `true` to write the original, `false` to put the mask back.
     * @returns whether the composer now holds the requested variant.
     */
    function swapDraft(record, reveal) {
      const editor = liveEditor(record);
      if (editor === null || !isContentEditable(editor)) return false;
      const target = reveal ? record.original : record.draft;
      const current = editorText(editor);
      if (current === target) return true;
      const expected = reveal ? record.draft : record.original;
      if (current !== expected) return false;
      try {
        editor.focus({ preventScroll: true });
        if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
          editor.setSelectionRange(0, current.length);
        } else {
          const range = document.createRange();
          range.selectNodeContents(editor);
          const selection = window.getSelection();
          if (selection === null) return false;
          selection.removeAllRanges();
          selection.addRange(range);
          // The editor keeps its own selection model and learns about a DOM
          // range through `selectionchange`; without this the composer pastes at
          // its own caret (appending) instead of over the draft.
          document.dispatchEvent(new Event('selectionchange'));
        }
      } catch {
        return false;
      }
      const dispatched = dispatchPaste(editor, target);
      pendingProbe = { record: store.getRecord(), before: current };
      scheduleProbe();
      return dispatched;
    }

    /**
     * Put the original text back over the masked draft.
     *
     * The whole draft is rewritten, and only when the draft still equals the
     * masked text that was inserted — so a reference chip or an edit the user
     * made since is never clobbered, and the undo is refused instead.
     *
     * The write reuses the composer's own paste path (the same one the masked
     * insertion uses) rather than `document.execCommand('insertText')`, which is
     * deprecated and does not reliably reach a Lexical editor.
     *
     * @param record - the masked paste to undo.
     * @returns whether the write was dispatched; the notice re-checks what landed.
     */
    function restoreOriginal(record) {
      const editor = liveEditor(record);
      if (editor === null) return false;
      if (!isContentEditable(editor)) return false;
      if (editorText(editor) !== record.draft) return false;
      try {
        editor.focus({ preventScroll: true });
        if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
          editor.setSelectionRange(0, record.draft.length);
        } else {
          const range = document.createRange();
          range.selectNodeContents(editor);
          const selection = window.getSelection();
          if (selection === null) return false;
          selection.removeAllRanges();
          selection.addRange(range);
          // The editor keeps its own selection model and learns about a DOM
          // range through `selectionchange`; without this the composer pastes at
          // its own caret (appending) instead of over the masked draft.
          document.dispatchEvent(new Event('selectionchange'));
        }
      } catch {
        return false;
      }
      const dispatched = dispatchPaste(editor, record.original);
      pendingProbe = { record: store.getRecord(), before: record.draft };
      scheduleProbe();
      return dispatched;
    }

    // #endregion

    // #region styles

    const STYLE_ID = 'dsh-data-mask-style';

    /**
     * The plugin's own stylesheet.
     *
     * The settings page is expressed with the shell's theme tokens and its
     * settings type scale (14/20 titles, 12/18 descriptions, 16px row padding,
     * a half-pixel divider between rows), so it reads as a built-in section
     * instead of a foreign panel. Controls come from the shell's primitives.
     */
    const STYLE_TEXT = `
.dsh-data-mask-section { display: flex; flex-direction: column; width: 100%; }
.dsh-data-mask-row {
  display: flex; align-items: center; justify-content: space-between; gap: 24px;
  padding: 16px 0; border-bottom: .5px solid var(--dsw-alias-border-l2);
}
.dsh-data-mask-row:last-child { border-bottom: none; }
.dsh-data-mask-row[data-stacked="true"] { flex-direction: column; align-items: stretch; gap: 10px; }
.dsh-data-mask-title { font-size: 14px; line-height: 20px; color: var(--dsw-alias-label-primary); }
.dsh-data-mask-description { margin-top: 4px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-data-mask-value { margin-top: 6px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-data-mask-note { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-data-mask-rules { display: flex; flex-direction: column; }
.dsh-data-mask-rule { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 0; }
.dsh-data-mask-rule-name { font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-primary); }
.dsh-data-mask-rule-hint { margin-top: 2px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-data-mask-input {
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 64px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 8px 10px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font-family: inherit; font-size: 13px; line-height: 20px;
}
.dsh-data-mask-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dsh-data-mask-input::placeholder { color: var(--dsw-alias-label-secondary); }
.dsh-data-mask-input[data-mono="true"] { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.dsh-data-mask-preview {
  margin: 0; padding: 8px 10px; border-radius: 8px; min-height: 36px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px; line-height: 20px; white-space: pre-wrap; word-break: break-word;
}
.dsh-data-mask-fallback { width: 16px; height: 16px; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }
.dsh-data-mask-invalid { margin: 6px 0 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.dsh-data-mask-notice {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  margin: 2px 2px 0; padding: 6px 10px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px;
}
.dsh-data-mask-notice[data-tone="warn"] { border-color: var(--dsw-alias-state-warn-primary); }
.dsh-data-mask-notice-preview {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--dsw-alias-label-secondary);
  max-width: 42ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-data-mask-notice-preview[data-revealed="true"] { color: var(--dsw-alias-state-warn-primary); }
.dsh-data-mask-notice button {
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; cursor: pointer;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font-family: inherit; padding: 2px 9px; font-size: 12px; line-height: 18px;
}
.dsh-data-mask-notice button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-data-mask-notice small { color: var(--dsw-alias-label-secondary); }
.dsh-data-mask-notice-spacer { flex: 1 1 auto; }
.dsh-data-mask-overlay {
  position: fixed; left: 50%; transform: translateX(-50%);
  z-index: 40; display: flex; flex-direction: column; align-items: stretch; gap: 8px;
  /* The width is measured from the composer card so the two line up; this is the
     first-frame fallback for when no measurement has happened yet. */
  width: min(680px, calc(100vw - 32px)); pointer-events: none;
}
.dsh-data-mask-overlay:empty { display: none; }
.dsh-data-mask-overlay > * { pointer-events: auto; max-width: 100%; }
`;

    /**
     * Insert the plugin's stylesheet and return the cleanup that takes it out.
     *
     * NOTE the shape: the cleanup is RETURNED, never invoked. `ctx.effect`
     * interprets a callback's return value as the disposer, so calling this
     * function for its side effect inside `ctx.effect` would install the sheet
     * and immediately remove it again.
     *
     * Never throws: a stylesheet failure must not reach the boot gate.
     * @returns the cleanup that removes the stylesheet.
     */
    function installStyles() {
      try {
        if (document.getElementById(STYLE_ID) !== null) return () => {};
        const element = document.createElement('style');
        element.id = STYLE_ID;
        element.textContent = STYLE_TEXT;
        document.head.append(element);
        return () => {
          element.remove();
        };
      } catch (error) {
        console.warn('[data-mask] stylesheet could not be installed:', error);
        return () => {};
      }
    }

    // #endregion

    // #region components

    /**
     * Swallow a render error from one subtree.
     *
     * A plugin that only decorates the composer must not be able to take the
     * conversation down with it, so every contribution is wrapped here.
     */
    class Boundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }

      static getDerivedStateFromError(error) {
        return { error };
      }

      componentDidCatch(error) {
        console.warn('[data-mask] component failed:', error);
      }

      render() {
        return this.state.error === null ? this.props.children : null;
      }
    }

    /**
     * Native checkbox standing in for a shell primitive when the primitives
     * module is unavailable, so the page still works without it.
     * @param props - checked state, label, and the change callback.
     */
    function NativeCheckbox({ checked, onChange, label, disabled }) {
      return h('input', {
        type: 'checkbox',
        className: 'dsh-data-mask-fallback',
        checked,
        disabled,
        'aria-label': label,
        onChange: (event) => onChange(event.target.checked),
      });
    }

    /** @returns the shell `Switch`, or the native fallback. */
    function Toggle(props) {
      const Component = Field?.Switch ?? NativeCheckbox;
      return h(Component, props);
    }

    /**
     * One rule's on/off control.
     *
     * The shell's `Checkbox` always renders its `label` text beside the box,
     * which would repeat the rule name already shown on the left; the shell uses
     * `Switch` for exactly this kind of labelled preference row, so rules use it
     * too.
     * @param props - checked state, accessible label, and the change callback.
     */
    function RuleToggle(props) {
      const Component = Field?.Switch ?? NativeCheckbox;
      return h(Component, props);
    }

    /**
     * One settings row: the label column on the left, the control on the right.
     * @param props - row content.
     */
    function Row({ title, description, children }) {
      return h(
        'div',
        { className: 'dsh-data-mask-row' },
        h(
          'div',
          null,
          h('div', { className: 'dsh-data-mask-title' }, title),
          description === undefined ? null : h('div', { className: 'dsh-data-mask-description' }, description),
        ),
        children,
      );
    }

    /**
     * The settings page registered into the shell's Settings panel.
     *
     * It follows the shipped sections: a full-width column of divided rows, with
     * the shell's own controls, and its own copy for the values it owns.
     */
    function SettingsPage() {
      const settings = useSyncExternalStore(store.subscribe, store.getSettings, store.getSettings);
      const record = useSyncExternalStore(store.subscribe, store.getRecord, store.getRecord);
      const [sample, setSample] = useState('张三 13812345678 zhangsan@example.com 卡号 4111111111111111');
      const parsed = useMemo(() => parseCustomRules(settings.custom), [settings.custom]);
      const preview = useMemo(
        () => sanitize(sample, {
          enabled: true,
          mode: settings.mode,
          ruleOverrides: settings.rules,
          customRules: parsed.rules,
        }),
        [sample, settings.mode, settings.rules, parsed.rules],
      );
      const enabledRules = RULES.filter((rule) => settings.rules[rule.id]?.enabled ?? rule.enabled !== false).length;
      const ModeControl = Field?.SegmentedControl;
      const modeOptions = MODES.map((mode) => ({ value: mode, label: t(`mode.option.${mode}`) }));

      /**
       * Merge one built-in rule override.
       * @param id - the rule id.
       * @param patch - the fields to change.
       */
      const setRule = (id, patch) => {
        store.update({ rules: { [id]: { ...(settings.rules[id] ?? {}), ...patch } } });
      };

      return h(
        'div',
        { className: 'dsh-data-mask-section' },
        h(Row, {
          title: t('enabled.label'),
          description: t('enabled.description'),
          children: h(Toggle, {
            checked: settings.enabled,
            label: t('enabled.label'),
            onChange: (next) => store.update({ enabled: next }),
          }),
        }),
        h(Row, {
          title: t('mode.label'),
          description: t(`mode.hint.${settings.mode}`),
          children: ModeControl === undefined
            ? h(
              'select',
              {
                value: settings.mode,
                'aria-label': t('mode.label'),
                onChange: (event) => store.update({ mode: event.target.value }),
                style: { font: 'inherit', fontSize: 13, padding: '4px 8px' },
              },
              modeOptions.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
            )
            : h(ModeControl, {
              id: 'data-mask-mode',
              value: settings.mode,
              options: modeOptions,
              label: t('mode.label'),
              onChange: (next) => store.update({ mode: next }),
            }),
        }),
        h(
          'div',
          { className: 'dsh-data-mask-row', 'data-stacked': 'true' },
          h(
            'div',
            null,
            h('div', { className: 'dsh-data-mask-title' }, t('rules.label')),
            h('div', { className: 'dsh-data-mask-description' }, t('rules.description')),
            h('div', { className: 'dsh-data-mask-value' }, t('rules.on', { count: enabledRules })),
          ),
          h(
            'div',
            { className: 'dsh-data-mask-rules' },
            RULES.map((rule) => {
              const ruleEnabled = settings.rules[rule.id]?.enabled ?? rule.enabled !== false;
              return h(
                'div',
                { key: rule.id, className: 'dsh-data-mask-rule' },
                h(
                  'div',
                  null,
                  h('div', { className: 'dsh-data-mask-rule-name' }, rule.label),
                  h('div', { className: 'dsh-data-mask-rule-hint' }, rule.hint),
                ),
                h(RuleToggle, {
                  checked: ruleEnabled,
                  label: rule.label,
                  onChange: (next) => setRule(rule.id, { enabled: next }),
                }),
              );
            }),
          ),
        ),
        h(
          'div',
          { className: 'dsh-data-mask-row', 'data-stacked': 'true' },
          h(
            'div',
            null,
            h('div', { className: 'dsh-data-mask-title' }, t('custom.label')),
            h('div', { className: 'dsh-data-mask-description' }, t('custom.description')),
            parsed.bad.length === 0
              ? null
              : parsed.bad.map((problem) => h(
                'p',
                { key: problem.line, className: 'dsh-data-mask-invalid' },
                t('custom.invalid', { line: problem.line, reason: problem.reason }),
              )),
          ),
          h('textarea', {
            className: 'dsh-data-mask-input',
            'data-mono': 'true',
            spellCheck: false,
            value: settings.custom,
            placeholder: t('custom.placeholder'),
            'aria-label': t('custom.label'),
            onChange: (event) => store.update({ custom: event.target.value }),
          }),
          h('div', { className: 'dsh-data-mask-note' }, t('custom.count', { count: parsed.rules.length })),
        ),
        h(
          'div',
          { className: 'dsh-data-mask-row', 'data-stacked': 'true' },
          h(
            'div',
            null,
            h('div', { className: 'dsh-data-mask-title' }, t('test.label')),
            h('div', { className: 'dsh-data-mask-description' }, t('test.description')),
          ),
          h('textarea', {
            className: 'dsh-data-mask-input',
            spellCheck: false,
            value: sample,
            placeholder: t('test.placeholder'),
            'aria-label': t('test.label'),
            onChange: (event) => setSample(event.target.value),
          }),
          h('div', { className: 'dsh-data-mask-note' }, t('test.output')),
          h('p', { className: 'dsh-data-mask-preview' }, preview.text === '' ? ' ' : preview.text),
          preview.total === 0
            ? h('div', { className: 'dsh-data-mask-note' }, t('test.empty'))
            : h('div', { className: 'dsh-data-mask-value' }, t('test.hits', {
              count: preview.total,
              list: preview.hits.map((hit) => `${hit.label}×${hit.count}`).join('、'),
            })),
          h('div', { className: 'dsh-data-mask-note' }, record === null
            ? t('last.none')
            : t('last.label', { count: record.total })),
        ),
      );
    }

    /**
     * The notice under the composer card: what was masked, hold-to-reveal, undo.
     * @param props - notice inputs.
     * @param props.record - the masked-paste record.
     * @param props.onUndone - marks the record as undone.
     * @param props.onDismiss - drops the record.
     */
    /**
     * Hold-to-reveal, owned by the surface so the composer write and the record
     * stay in step.
     *
     * Both the request and the state are derived from the draft every time
     * (`probeDraft`) instead of a remembered flag: a cached flag goes stale on a
     * fast press/release and then sticks, which is what made the reveal work once
     * and then silently disable itself and the undo. `swapDraft` is idempotent, so
     * a repeated report is a no-op and a release always puts the mask back.
     *
     * @param record - the masked-paste record.
     * @param reveal - whether the composer should show the original.
     */
    function revealDraft(record, reveal) {
      const live = probeDraft(record);
      // Already in the requested shape: nothing to write.
      if (reveal ? live === 'swapped' : live === 'masked') return;
      const swapped = swapDraft(record, reveal);
      const draftState = swapped ? (reveal ? 'swapped' : 'masked') : 'diverged';
      store.setRecord({
        ...record,
        swapped: swapped ? reveal : false,
        draftState,
        // A successful swap also proves the masked text did reach the composer.
        applied: swapped ? true : record.applied,
      });
    }

    /**
     * The notice under the composer card: what was masked, hold-to-reveal, undo.
     * @param props - notice inputs.
     * @param props.record - the masked-paste record.
     * @param props.onUndone - marks the record as undone.
     * @param props.onReveal - writes the original into the composer, or the mask back.
     * @param props.onDismiss - drops the record.
     */
    function MaskNotice({ record, onUndone, onReveal, onDismiss }) {
      const [failure, setFailure] = useState(false);
      const [copied, setCopied] = useState(false);
      const [expiresIn, setExpiresIn] = useState(() => Math.max(0, store.getExpiresAt() - Date.now()));

      // Every decision below is taken from what the composer ACTUALLY holds right
      // now (`probeDraft`), not from a cached flag: a cached flag goes stale on a
      // fast press/release and then sticks, which is what made the reveal work
      // once and then disable both the reveal and the undo.
      const live = probeDraft(record);
      const revealing = live === 'swapped';
      useEffect(() => {
        // A held reveal is an active read: no countdown churn while it is held.
        if (record.undone || revealing) return undefined;
        const timer = window.setInterval(() => setExpiresIn(Math.max(0, store.getExpiresAt() - Date.now())), 1000);
        return () => window.clearInterval(timer);
      }, [record.undone, revealing]);

      const preview = record.hits.map((hit) => `${hit.label}×${hit.count}`).join('、');
      // `applied === null` means the paste verdict has not settled yet.
      const unwritten = record.applied === false;
      const diverged = live === 'diverged' && !unwritten;

      /**
       * Put the original back.
       *
       * A held reveal already left the original in place, so this only has to
       * settle the record — refusing here would be wrong while the draft is
       * demonstrably the text we wrote.
       */
      const undo = () => {
        if (live === 'original' || live === 'swapped') {
          setFailure(false);
          onUndone();
          return;
        }
        if (restoreOriginal(record)) {
          setFailure(false);
          onUndone();
          return;
        }
        setFailure(true);
      };

      /**
       * Report the held state to the surface, which owns the composer write.
       * @param next - whether the composer should show the original.
       */
      const heldRef = useRef(false);
      const setRevealed = (next) => {
        // Idempotent by construction: several release paths may report the same
        // end (button and document both see a pointerup over the button), and a
        // second restore is what used to APPEND the text instead of replacing it.
        if (heldRef.current === next) return;
        heldRef.current = next;
        onReveal(next);
      };

      // A hold must never stick, and it must never be cut short. So the release is
      // listened for in BOTH places — the document (release anywhere, including
      // off the button) and the button itself (a mouse released over it) — and
      // `setRevealed` above absorbs the duplicate. There is deliberately no timer
      // here: an earlier attempt polled a release and cancelled every hold before
      // the user could see anything.
      useEffect(() => {
        const release = () => setRevealed(false);
        document.addEventListener('pointerup', release, true);
        document.addEventListener('pointercancel', release, true);
        document.addEventListener('visibilitychange', release);
        window.addEventListener('blur', release);
        return () => {
          document.removeEventListener('pointerup', release, true);
          document.removeEventListener('pointercancel', release, true);
          document.removeEventListener('visibilitychange', release);
          window.removeEventListener('blur', release);
        };
        // `setRevealed` is recreated every render but only touches a ref and the
        // surface's handler, so the listeners installed once stay correct.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      /** Fallback path when the composer refused the re-issued paste. */
      const copyMasked = () => {
        try {
          navigator.clipboard?.writeText(record.draft).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        } catch {
          setCopied(false);
        }
      };

      return h(
        'div',
        { className: 'dsh-data-mask-notice', 'data-tone': failure || unwritten || diverged ? 'warn' : 'info' },
        h(
          'span',
          { className: 'dsh-data-mask-notice-preview', 'data-revealed': revealing ? 'true' : 'false' },
          revealing
            ? t('notice.revealed', { total: record.total })
            : t('notice.titleWithPreview', { count: record.total, preview }),
        ),
        record.undone
          ? h('small', null, t('notice.undone'))
          : h(
            React.Fragment,
            null,
            h(
              'button',
              {
                type: 'button',
                title: t('notice.viewHint'),
                // Press-and-hold, not click: the composer carries the original
                // only between pointerdown and release, like a revealed password.
                // `onPointerUp` is the mouse path (released over the button) and
                // the document listener above covers releasing anywhere else; the
                // duplicate is absorbed by `setRevealed`, which is why this pair no
                // longer appends a second copy the way it did before.
                onPointerDown: () => setRevealed(true),
                onPointerUp: () => setRevealed(false),
                onPointerCancel: () => setRevealed(false),
                onKeyDown: (event) => {
                  if (event.repeat) return;
                  setRevealed(true);
                },
                onKeyUp: () => setRevealed(false),
                onBlur: () => setRevealed(false),
              },
              t('notice.view'),
            ),
            unwritten
              ? h('button', { type: 'button', onClick: copyMasked }, copied ? t('notice.copied') : t('notice.copy'))
              : h('button', { type: 'button', title: t('notice.undoHint'), onClick: undo }, t('notice.undo')),
          ),
        failure ? h('small', null, t('notice.failed')) : null,
        unwritten && !record.undone ? h('small', null, t('notice.notApplied')) : null,
        diverged && !record.undone ? h('small', null, t('notice.diverged')) : null,
        !unwritten && !diverged && !record.undone && !revealing
          ? h('small', null, t('notice.autoHide', { minutes: Math.max(1, Math.ceil(expiresIn / 60000)) }))
          : null,
        h('span', { className: 'dsh-data-mask-notice-spacer' }),
        h('button', { type: 'button', onClick: onDismiss, 'aria-label': t('notice.close') }, '✕'),
      );
    }

    /**
     * Keep the overlay just above the composer card, and as wide as it.
     *
     * Measured against the live card instead of being computed at render time:
     * the card appears and moves after the notice mounts, and a stale measurement
     * is what left the notice sitting over the input field. A `ResizeObserver`
     * follows the card as the draft grows.
     *
     * @param ref - the overlay element.
     */
    function useComposerAnchor(ref) {
      useEffect(() => {
        const place = () => {
          const element = ref.current;
          if (element === null) return;
          const placement = noticePlacement();
          element.style.bottom = placement.bottom;
          if (placement.width !== undefined) element.style.width = placement.width;
          if (placement.left !== undefined) {
            // Left is anchored to the card, so the centring transform is dropped.
            element.style.left = placement.left;
            element.style.transform = 'none';
          }
        };
        place();
        let observer = null;
        try {
          const field = document.querySelector('[data-composer-input]')
            ?? document.querySelector('[contenteditable=""],[contenteditable="true"]');
          if (field !== null && typeof ResizeObserver === 'function') {
            observer = new ResizeObserver(place);
            observer.observe(composerCardOf(field));
          }
        } catch {
          // Without an observer the notice still follows resize, scroll and the tick.
        }
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        const timer = window.setInterval(place, 1200);
        return () => {
          observer?.disconnect();
          window.removeEventListener('resize', place);
          window.removeEventListener('scroll', place, true);
          window.clearInterval(timer);
        };
      }, [ref]);
    }

    /**
     * Root-scoped surface: the masked-paste notice.
     *
     * The composer dock is session-scoped, so on the start screen this overlay is
     * the only place the notice — and therefore 按住查看原文 / 撤销 — can appear.
     * Configuration lives in the shell's Settings panel, not here.
     *
     * The notice belongs to the Session the paste happened in: it is hidden while
     * another Session is on screen, and comes back when that Session returns.
     */
    function MaskNoticeSurface() {
      const record = useSyncExternalStore(store.subscribe, store.getRecord, store.getRecord);
      const [, setTick] = useState(0);
      const ref = useRef(null);

      useComposerAnchor(ref);

      // Expire the undo window, and re-read the current Session. The sidebar is
      // also WATCHED: a session switch is a DOM change there, so the notice hides
      // at once instead of lingering until the next tick.
      useEffect(() => {
        const tick = () => {
          store.sweep();
          setTick((value) => value + 1);
        };
        const timer = window.setInterval(tick, 1000);
        let observer = null;
        try {
          const sidebar = document.querySelector('[data-row-key^="session:"]')?.closest('[role="tree"],[class*="sidebar"],[class*="Sidebar"]');
          if (sidebar !== null && sidebar !== undefined && typeof MutationObserver === 'function') {
            observer = new MutationObserver(tick);
            observer.observe(sidebar, { attributes: true, attributeFilter: ['class', 'data-row-key', 'aria-selected'], subtree: true });
          }
        } catch {
          // Without the observer the 1s tick still settles it.
        }
        return () => {
          window.clearInterval(timer);
          observer?.disconnect();
        };
      }, []);

      if (record === null) return null;
      // Identity, not connectivity: the composer survives a conversation switch,
      // so ownership comes from the Session the paste happened in.
      if (!recordBelongsToView(record)) return null;
      // Nothing left to describe: the user deleted the draft, or replaced it.
      if (!recordStillApplies(record)) {
        if (record.undone !== true) {
          // Drop the record instead of hiding it forever: nothing left to undo.
          window.setTimeout(() => {
            if (store.getRecord() === record) store.setRecord(null);
          }, 0);
        }
        return null;
      }

      return h(
        'div',
        { className: 'dsh-data-mask-overlay', ref },
        h(Boundary, null, h(MaskNotice, {
          record,
          onUndone: () => store.setRecord({ ...record, undone: true, swapped: false }),
          onReveal: (reveal) => revealDraft(record, reveal),
          onDismiss: () => store.setRecord(null),
        })),
      );
    }

    // #endregion

    return {
      // Only `slots` is required. A required-but-missing service parks the fiber
      // and the boot gate then refuses to start the GUI, so the locale service
      // is read through `ctx.get`, which needs no declaration.
      inject: ['slots'],
      /**
       * Client plugin body: styles, dictionaries, the paste interceptor, the
       * notice surface, and the Settings page. Every step is isolated so a
       * failure degrades the feature instead of failing activation.
       * @param ctx - Client cordis context.
       */
      apply(ctx) {
        // `ctx.effect(callback)` registers the callback's RETURN VALUE as the
        // disposer, so the callback must hand back the cleanup rather than run
        // the side effect itself.
        try {
          ctx.effect(installStyles, 'data-mask: stylesheet');
        } catch (error) {
          console.warn('[data-mask] stylesheet effect failed:', error);
        }

        // A required service that is missing parks the fiber, which fails the
        // boot gate, so the locale service is read through `ctx.get`: the same
        // service with no requirement, costing nothing when it is absent.
        try {
          const locale = ctx.get('locale');
          if (locale?.register !== undefined) {
            ctx.effect(() => locale.register(NS, DICTIONARIES), 'data-mask: dictionaries');
          }
        } catch (error) {
          console.warn('[data-mask] locale registration unavailable, using the built-in dictionaries:', error);
        }

        try {
          ctx.effect(() => attachPasteInterceptor(), 'data-mask: paste interceptor');
        } catch (error) {
          console.warn('[data-mask] paste interceptor could not be installed:', error);
        }

        // Root-scoped notice: a dock-scoped one would be invisible on the start
        // screen, where no Session (and so no dock) exists yet.
        try {
          ctx.slots.inject('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay',
            id: 'data-mask-notice',
            order: 40,
          }, MaskNoticeSurface));
        } catch (error) {
          console.warn('[data-mask] notice surface could not be registered:', error);
        }

        // The plugin's settings are a section of the shell's own Settings panel,
        // reached from the sidebar foot — not a floating panel of its own design.
        try {
          ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: 'data-mask',
            order: 40,
            // A thunk is re-read on every projection, so the nav row follows the
            // active language without re-registering.
            label: () => t('nav.label'),
          }, SettingsPage));
        } catch (error) {
          console.warn('[data-mask] settings section could not be registered:', error);
        }
      },
    };
  },
});
