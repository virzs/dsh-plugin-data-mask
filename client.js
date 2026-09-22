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
 * 3. A chip that opens the settings panel: master switch, mask style, per-rule
 *    toggles, custom-rule editor, and a live preview.
 *
 * The original text of a masked paste is kept in memory only, is dropped after
 * {@link RECORD_TTL_MS}, and is never written to storage or sent anywhere.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-data-mask',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
    const { sanitize, parseCustomRules, RULES, MODES } = require('@local/dsh-plugin-data-mask/engine');

    /** localStorage key holding the persisted configuration. */
    const STORAGE_KEY = 'dsh.data-mask.settings.v1';
    /** Locale namespace for every visible string in this plugin. */
    const NS = 'data-mask';
    /** How long a masked paste stays undoable (and its original in memory). */
    const RECORD_TTL_MS = 10 * 60 * 1000;
    /** Panel geometry. */
    const PANEL_WIDTH = 372;
    const PANEL_GAP = 10;
    /** The editable selector used to recognize a composer field. */
    const EDITABLE_SELECTOR = '[contenteditable=""],[contenteditable="true"],textarea,input';
    /** Placeholder editors carry, which must not be mistaken for draft text. */
    const ZERO_WIDTH = /\u200b/g;

    const DICTIONARIES = {
      zh: {
        'chip.on': '脱敏中',
        'chip.off': '脱敏已关',
        'chip.last': '脱敏 {count} 处',
        'panel.title': '粘贴脱敏',
        'panel.subtitle': '拦截粘贴到输入框的内容，先替换敏感信息再放入草稿，原文不会发送给模型。',
        'panel.enabled': '启用粘贴脱敏',
        'panel.mode': '替换方式',
        'mode.label': '整体替换（最安全）',
        'mode.partial': '部分掩码（保留可读）',
        'mode.redact': '星号覆盖',
        'panel.rules': '识别规则',
        'panel.rulesHint': '关闭的规则不参与替换。',
        'panel.custom': '自定义规则',
        'panel.customHint': '每行一条：/正则/标志 => 替换文本，例如 /EMP-\\d{6}/ => [工号]；# 开头的行会被忽略。',
        'panel.test': '试一下',
        'panel.testHint': '输入或粘贴样例，立即查看替换结果。',
        'panel.testEmpty': '未命中任何敏感信息',
        'panel.testHits': '命中 {count} 处：{list}',
        'panel.clear': '关闭',
        'panel.invalid': '第 {line} 行正则无效：{reason}',
        'panel.lastNone': '还没有拦截到粘贴记录。',
        'panel.last': '最近一次：脱敏 {count} 处（{list}）',
        'notice.title': '已脱敏 {count} 处',
        'notice.titleWithPreview': '已脱敏 {count} 处：{preview}',
        'notice.view': '按住查看原文',
        'notice.viewHint': '按住不放才显示原文，松开即恢复脱敏文本',
        'notice.undo': '撤销脱敏',
        'notice.undoHint': '把原文放回输入框（仅当草稿未被改动且仍在 10 分钟内可用）',
        'notice.undone': '已撤销，原文已放回输入框',
        'notice.failed': '无法撤销：草稿已被修改，或输入框不可编辑',
        'notice.notApplied': '未能写入输入框，可手动粘贴下面的脱敏文本',
        'notice.copy': '复制脱敏文本',
        'notice.copied': '已复制脱敏文本',
        'notice.autoHide': '{minutes} 分钟后自动清除记录',
        'notice.close': '关闭提示',
      },
      en: {
        'chip.on': 'Masking on',
        'chip.off': 'Masking off',
        'chip.last': 'Masked {count}',
        'panel.title': 'Paste masking',
        'panel.subtitle': 'Intercepts what you paste into the composer, replaces sensitive values, and only then puts the draft in place. The original never reaches the model.',
        'panel.enabled': 'Enable paste masking',
        'panel.mode': 'Replacement style',
        'mode.label': 'Whole value label (safest)',
        'mode.partial': 'Partial mask (stays readable)',
        'mode.redact': 'Asterisks',
        'panel.rules': 'Detection rules',
        'panel.rulesHint': 'A disabled rule never replaces anything.',
        'panel.custom': 'Custom rules',
        'panel.customHint': 'One rule per line: /pattern/flags => replacement, e.g. /EMP-\\d{6}/ => [staff id]. Lines starting with # are ignored.',
        'panel.test': 'Try it',
        'panel.testHint': 'Type or paste a sample to see the result immediately.',
        'panel.testEmpty': 'No sensitive value matched',
        'panel.testHits': '{count} matched: {list}',
        'panel.clear': 'Close',
        'panel.invalid': 'Line {line} is not a valid pattern: {reason}',
        'panel.lastNone': 'No paste intercepted yet.',
        'panel.last': 'Last paste: {count} masked ({list})',
        'notice.title': 'Masked {count} value(s)',
        'notice.titleWithPreview': 'Masked {count}: {preview}',
        'notice.view': 'Hold to reveal',
        'notice.viewHint': 'The original shows only while held; releasing restores the masked text',
        'notice.undo': 'Undo masking',
        'notice.undoHint': 'Puts the original back into the composer (only while the draft is untouched and within 10 minutes)',
        'notice.undone': 'Undone — the original is back in the composer',
        'notice.failed': 'Cannot undo: the draft changed, or the editor is not editable',
        'notice.notApplied': 'The composer did not accept it — copy the masked text instead',
        'notice.copy': 'Copy masked text',
        'notice.copied': 'Masked text copied',
        'notice.autoHide': 'The record clears in {minutes} min',
        'notice.close': 'Dismiss',
      },
    };

    const DEFAULT_SETTINGS = Object.freeze({ enabled: true, mode: 'label', rules: {}, custom: '' });

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
        if (!isEditablePaste(event)) return;

        const original = event.clipboardData.getData('text/plain');
        if (original === '') return;
        const result = sanitize(original, optionsFor(settings, store.getCustomRules()));
        if (result.total === 0) return;

        // Swallow the original paste and re-issue it with the masked text.
        event.preventDefault();
        event.stopImmediatePropagation();

        const target = event.target;
        let applied = false;
        try {
          const data = new DataTransfer();
          data.setData('text/plain', result.text);
          const forwarded = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: data,
          });
          applied = target === null || target.dispatchEvent(forwarded);
        } catch {
          // A browser that refuses a synthetic ClipboardEvent still gets the
          // notice below; the composer simply keeps its own copy of the text.
          applied = false;
        }

        store.setRecord({
          at: Date.now(),
          original,
          draft: result.text,
          hits: result.hits,
          total: result.total,
          editor: target instanceof Element ? target.closest(EDITABLE_SELECTOR) : null,
          applied,
          undone: false,
        });
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

    /** @returns the comparable draft text of a contenteditable / textarea / input. */
    function editorText(element) {
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value;
      return (element.textContent ?? '').replace(ZERO_WIDTH, '');
    }

    /**
     * Put the original text back over the masked draft.
     *
     * The whole draft is rewritten, and only when the draft still equals the
     * masked text that was inserted — so a chip or an edit the user made since is
     * never clobbered, and the undo is refused instead.
     *
     * @param record - the masked paste to undo.
     * @returns whether the original reached the editor.
     */
    function restoreOriginal(record) {
      const editor = liveEditor(record);
      if (editor === null) return false;
      if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
        if (editor.disabled || editor.readOnly) return false;
      } else if (editor.isEditable !== true) {
        return false;
      }
      const current = editorText(editor);
      if (current !== record.draft) return false;
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
        }
        // `insertText` leaves no `paste` event behind, so the interceptor cannot
        // re-mask the text we are deliberately restoring.
        return document.execCommand('insertText', false, record.original);
      } catch {
        return false;
      }
    }

    // #endregion

    // #region styles

    const STYLE_ID = 'dsh-data-mask-style';
    const STYLE_TEXT = `
.dsh-data-mask-dock {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  width: 100%; min-width: 0;
}
.dsh-data-mask-chip {
  display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
  border: 1px solid transparent; border-radius: 999px; padding: 1px 8px;
  background: none; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.7;
}
.dsh-data-mask-chip:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
.dsh-data-mask-chip[data-state="hot"] { color: var(--dsw-alias-state-success-primary); }
.dsh-data-mask-chip[data-state="off"] { color: var(--dsw-alias-state-idle-primary); }
.dsh-data-mask-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.dsh-data-mask-notice {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  margin: 2px 2px 0; padding: 5px 9px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 11.5px;
}
.dsh-data-mask-notice[data-tone="warn"] { border-color: var(--dsw-alias-state-warn-primary); }
.dsh-data-mask-notice[data-tone="done"] { color: var(--dsw-alias-label-secondary); }
.dsh-data-mask-notice-preview {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--dsw-alias-label-secondary);
  max-width: 42ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-data-mask-notice-preview[data-revealed="true"] { color: var(--dsw-alias-state-warn-primary); }
.dsh-data-mask-notice button {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; cursor: pointer;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  padding: 1px 8px; font-size: 11.5px; line-height: 1.7;
}
.dsh-data-mask-notice button:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }
.dsh-data-mask-notice button:disabled { opacity: 0.5; cursor: not-allowed; }
.dsh-data-mask-notice small { color: var(--dsw-alias-label-secondary); }
.dsh-data-mask-notice-spacer { flex: 1 1 auto; }
.dsh-data-mask-panel {
  position: fixed; z-index: 40; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 12px; padding: 14px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-overlay); box-shadow: 0 12px 32px rgb(0 0 0 / 24%);
  color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1.5;
}
.dsh-data-mask-panel * { box-sizing: border-box; }
.dsh-data-mask-panel h3 { margin: 0; font-size: 13px; font-weight: 600; }
.dsh-data-mask-panel p { margin: 0; color: var(--dsw-alias-label-secondary); }
.dsh-data-mask-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.dsh-data-mask-close {
  border: 0; background: none; cursor: pointer; padding: 0 2px;
  color: var(--dsw-alias-label-secondary); font-size: 15px; line-height: 1;
}
.dsh-data-mask-close:hover { color: var(--dsw-alias-label-primary); }
.dsh-data-mask-switch { display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 500; }
.dsh-data-mask-switch input { width: 15px; height: 15px; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }
.dsh-data-mask-modes { display: flex; flex-direction: column; gap: 4px; }
.dsh-data-mask-modes label { display: flex; align-items: center; gap: 7px; cursor: pointer; }
.dsh-data-mask-modes input { accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }
.dsh-data-mask-rules {
  display: flex; flex-direction: column; gap: 3px;
  max-height: 168px; overflow-y: auto;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 7px 8px;
}
.dsh-data-mask-rule { display: flex; align-items: baseline; gap: 7px; cursor: pointer; }
.dsh-data-mask-rule input { accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }
.dsh-data-mask-rule small { color: var(--dsw-alias-label-secondary); }
.dsh-data-mask-panel textarea {
  width: 100%; min-height: 62px; resize: vertical;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 7px 8px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px;
}
.dsh-data-mask-panel input[type="text"] {
  width: 100%; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
  padding: 7px 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px;
}
.dsh-data-mask-output {
  margin: 0; padding: 7px 8px; border-radius: 8px; min-height: 34px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap; word-break: break-word;
}
.dsh-data-mask-hits { color: var(--dsw-alias-state-success-primary); }
.dsh-data-mask-empty { color: var(--dsw-alias-label-secondary); }
.dsh-data-mask-bad { color: var(--dsw-alias-state-error-primary); }
.dsh-data-mask-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--dsw-alias-label-secondary); }
.dsh-data-mask-foot button {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; cursor: pointer;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  padding: 3px 9px; font-size: 12px;
}
`;

    /**
     * The plugin's stylesheet, inserted once and removed with the plugin.
     * @returns the cleanup that takes it out again.
     */
    function installStyles() {
      const existing = document.getElementById(STYLE_ID);
      if (existing !== null) return () => {};
      const element = document.createElement('style');
      element.id = STYLE_ID;
      element.textContent = STYLE_TEXT;
      document.head.append(element);
      return () => {
        element.remove();
      };
    }

    // #endregion

    // #region components

    /**
     * The settings panel.
     * @param props - panel inputs.
     * @param props.settings - live settings.
     * @param props.record - the current masked-paste record, when there is one.
     * @param props.onChange - applies a settings patch.
     * @param props.onClose - closes the panel.
     * @param props.t - locale translator for the data-mask namespace.
     */
    function MaskPanel({ settings, record, onChange, onClose, t }) {
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

      /**
       * Merge one built-in rule override.
       * @param id - the rule id.
       * @param patch - the fields to change.
       */
      const setRule = (id, patch) => {
        onChange({ rules: { [id]: { ...(settings.rules[id] ?? {}), ...patch } } });
      };

      return h(
        'div',
        { className: 'dsh-data-mask-panel', style: { width: PANEL_WIDTH }, role: 'dialog', 'aria-label': t('panel.title') },
        h(
          'div',
          { className: 'dsh-data-mask-head' },
          h('div', null, h('h3', null, t('panel.title')), h('p', null, t('panel.subtitle'))),
          h('button', { type: 'button', className: 'dsh-data-mask-close', onClick: onClose, 'aria-label': t('panel.clear') }, '✕'),
        ),
        h(
          'label',
          { className: 'dsh-data-mask-switch' },
          h('input', {
            type: 'checkbox',
            checked: settings.enabled,
            onChange: (event) => onChange({ enabled: event.target.checked }),
          }),
          t('panel.enabled'),
        ),
        h(
          'div',
          null,
          h('p', null, t('panel.mode')),
          h(
            'div',
            { className: 'dsh-data-mask-modes' },
            MODES.map((mode) => h(
              'label',
              { key: mode },
              h('input', {
                type: 'radio',
                name: 'dsh-data-mask-mode',
                checked: settings.mode === mode,
                onChange: () => onChange({ mode }),
              }),
              t(`mode.${mode}`),
            )),
          ),
        ),
        h(
          'div',
          null,
          h('p', null, t('panel.rules'), ' · ', h('small', null, t('panel.rulesHint'))),
          h(
            'div',
            { className: 'dsh-data-mask-rules' },
            RULES.map((rule) => {
              const enabled = settings.rules[rule.id]?.enabled ?? rule.enabled !== false;
              return h(
                'label',
                { key: rule.id, className: 'dsh-data-mask-rule' },
                h('input', {
                  type: 'checkbox',
                  checked: enabled,
                  onChange: (event) => setRule(rule.id, { enabled: event.target.checked }),
                }),
                h('span', null, rule.label),
                h('small', null, rule.hint),
              );
            }),
          ),
        ),
        h(
          'div',
          null,
          h('p', null, t('panel.custom')),
          h('textarea', {
            value: settings.custom,
            spellCheck: false,
            'aria-label': t('panel.custom'),
            onChange: (event) => onChange({ custom: event.target.value }),
          }),
          h('p', null, h('small', null, t('panel.customHint'))),
          parsed.bad.map((problem) => h(
            'p',
            { key: problem.line, className: 'dsh-data-mask-bad' },
            t('panel.invalid', { line: problem.line, reason: problem.reason }),
          )),
        ),
        h(
          'div',
          null,
          h('p', null, t('panel.test'), ' · ', h('small', null, t('panel.testHint'))),
          h('input', {
            type: 'text',
            value: sample,
            spellCheck: false,
            'aria-label': t('panel.test'),
            onChange: (event) => setSample(event.target.value),
          }),
          h('p', { className: 'dsh-data-mask-output' }, preview.text === '' ? ' ' : preview.text),
          preview.total === 0
            ? h('p', { className: 'dsh-data-mask-empty' }, t('panel.testEmpty'))
            : h('p', { className: 'dsh-data-mask-hits' }, t('panel.testHits', {
              count: preview.total,
              list: preview.hits.map((hit) => `${hit.label}×${hit.count}`).join('、'),
            })),
        ),
        h(
          'div',
          { className: 'dsh-data-mask-foot' },
          record === null
            ? h('span', null, t('panel.lastNone'))
            : h('span', null, t('panel.last', {
              count: record.total,
              list: record.hits.map((hit) => `${hit.label}×${hit.count}`).join('、'),
            })),
        ),
      );
    }

    /**
     * The notice under the composer card: what was masked, hold-to-reveal, undo.
     * @param props - notice inputs.
     * @param props.record - the masked-paste record.
     * @param props.onUndone - marks the record as undone.
     * @param props.onDismiss - drops the record.
     * @param props.t - locale translator for the data-mask namespace.
     */
    function MaskNotice({ record, onUndone, onDismiss, t }) {
      const [revealed, setRevealed] = useState(false);
      const [failure, setFailure] = useState(false);
      const [copied, setCopied] = useState(false);
      const [expiresIn, setExpiresIn] = useState(() => Math.max(0, store.getExpiresAt() - Date.now()));

      useEffect(() => {
        if (record.undone) return undefined;
        const timer = window.setInterval(() => setExpiresIn(Math.max(0, store.getExpiresAt() - Date.now())), 1000);
        return () => window.clearInterval(timer);
      }, [record.undone]);

      const preview = record.total > 0
        ? record.hits.map((hit) => `${hit.label}×${hit.count}`).join('、')
        : '';

      const undo = () => {
        if (restoreOriginal(record)) {
          setFailure(false);
          onUndone();
          return;
        }
        setFailure(true);
      };

      /** Fallback path when the composer refused the re-issued paste. */
      const copyMasked = () => {
        navigator.clipboard?.writeText(record.draft).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      };

      return h(
        'div',
        { className: 'dsh-data-mask-notice', 'data-tone': failure || !record.applied ? 'warn' : 'info' },
        h(
          'span',
          { className: 'dsh-data-mask-notice-preview', 'data-revealed': revealed ? 'true' : 'false' },
          revealed ? record.original : t('notice.titleWithPreview', { count: record.total, preview }),
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
                // Press-and-hold, not click: the original exists only between
                // pointerdown and release, like a revealed password field.
                onPointerDown: (event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  setRevealed(true);
                },
                onPointerUp: () => setRevealed(false),
                onPointerCancel: () => setRevealed(false),
                onPointerLeave: () => setRevealed(false),
                onKeyDown: (event) => {
                  if (event.repeat) return;
                  setRevealed(true);
                },
                onKeyUp: () => setRevealed(false),
                onBlur: () => setRevealed(false),
              },
              t('notice.view'),
            ),
            record.applied
              ? h('button', { type: 'button', title: t('notice.undoHint'), onClick: undo }, t('notice.undo'))
              : h('button', { type: 'button', onClick: copyMasked }, copied ? t('notice.copied') : t('notice.copy')),
          ),
        failure ? h('small', null, t('notice.failed')) : null,
        !record.applied && !record.undone ? h('small', null, t('notice.notApplied')) : null,
        record.applied && !record.undone
          ? h('small', null, t('notice.autoHide', { minutes: Math.max(1, Math.ceil(expiresIn / 60000)) }))
          : null,
        h('span', { className: 'dsh-data-mask-notice-spacer' }),
        h('button', { type: 'button', onClick: onDismiss, 'aria-label': t('notice.close') }, '✕'),
      );
    }

    /**
     * The dock entry: the chip, the notice, and the anchored settings panel.
     * @param props - dock entry props.
     * @param props.t - locale translator for the data-mask namespace.
     */
    function MaskDock({ t }) {
      const settings = useSyncExternalStore(store.subscribe, store.getSettings, store.getSettings);
      const record = useSyncExternalStore(store.subscribe, store.getRecord, store.getRecord);
      const [placement, setPlacement] = useState(null);
      const chipRef = useRef(null);

      const close = useCallback(() => setPlacement(null), []);

      useEffect(() => {
        const timer = window.setInterval(() => store.sweep(), 30000);
        return () => window.clearInterval(timer);
      }, []);

      const place = useCallback(() => {
        const element = chipRef.current;
        if (element === null) return null;
        const rect = element.getBoundingClientRect();
        return {
          left: Math.max(PANEL_GAP, Math.min(rect.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - PANEL_GAP)),
          bottom: Math.max(PANEL_GAP, window.innerHeight - rect.top + PANEL_GAP),
        };
      }, []);

      useEffect(() => {
        if (placement === null) return undefined;
        const reposition = () => setPlacement((current) => (current === null ? current : place()));
        const onKeyDown = (event) => {
          if (event.key === 'Escape') close();
        };
        const onPointerDown = (event) => {
          if (chipRef.current !== null && !chipRef.current.contains(event.target) && event.target.closest('.dsh-data-mask-panel') === null) close();
        };
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => {
          window.removeEventListener('resize', reposition);
          window.removeEventListener('scroll', reposition, true);
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('pointerdown', onPointerDown, true);
        };
      }, [placement !== null, close, place]);

      const openPanel = () => setPlacement(placement === null ? place() : null);
      const masked = record?.total ?? 0;
      const state = !settings.enabled ? 'off' : masked > 0 ? 'hot' : 'idle';
      const label = !settings.enabled
        ? t('chip.off')
        : masked > 0 ? t('chip.last', { count: masked }) : t('chip.on');

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'dsh-data-mask-dock' },
          record === null
            ? null
            : h(MaskNotice, {
              record,
              onUndone: () => store.setRecord({ ...record, undone: true }),
              onDismiss: () => store.setRecord(null),
              t,
            }),
          h(
            'button',
            {
              type: 'button',
              ref: chipRef,
              className: 'dsh-data-mask-chip',
              'data-state': state,
              title: t('panel.title'),
              onClick: openPanel,
            },
            h('span', { className: 'dsh-data-mask-dot', 'aria-hidden': true }),
            label,
          ),
        ),
        placement === null
          ? null
          : ReactDOM.createPortal(
            h(
              'div',
              { style: { position: 'fixed', left: placement.left, bottom: placement.bottom } },
              h(MaskPanel, {
                settings,
                record,
                onChange: store.update,
                onClose: close,
                t,
              }),
            ),
            document.body,
          ),
      );
    }

    // #endregion

    return {
      inject: ['slots', 'locale'],
      /**
       * Client plugin body: styles, dictionaries, the paste interceptor, and the
       * composer-dock entry.
       * @param ctx - Client cordis context.
       */
      apply(ctx) {
        ctx.effect(() => installStyles(), 'data-mask: stylesheet');
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'data-mask: dictionaries');
        ctx.effect(() => attachPasteInterceptor(), 'data-mask: paste interceptor');
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'data-mask',
          order: 20,
          locale: NS,
        }, MaskDock));
      },
    };
  },
});
