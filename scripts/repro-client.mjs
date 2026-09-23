/**
 * Reproduce the Client half in Node.
 *
 * The boot error the GUI showed ("import failed") happens while the browser
 * module table resolves this bundle, so this harness rebuilds the same table —
 * the seed words the web shell installs, plus the package's own `client.js` and
 * `client-engine.js` factories — and then runs `apply` against a minimal DOM.
 * Any throw here is the same throw the browser reported.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Stand-in for the table's `react` seed. The point of this harness is the
 * bundle wiring — which specifiers resolve, and what the factory throws while
 * it runs — not React's own behavior, so the hooks are recorded no-ops and a
 * component render is attempted separately with `react-dom/server` semantics
 * left out of scope.
 */
const hookCalls = [];
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: Symbol('Fragment'),
  Component: class Component {
    constructor(props) {
      this.props = props;
    }
  },
  useCallback: (fn) => {
    hookCalls.push('useCallback');
    return fn;
  },
  useEffect: (fn) => {
    hookCalls.push('useEffect');
    void fn;
  },
  useMemo: (fn) => {
    hookCalls.push('useMemo');
    return fn();
  },
  useRef: (value) => {
    hookCalls.push('useRef');
    return { current: value };
  },
  useState: (value) => {
    hookCalls.push('useState');
    return [typeof value === 'function' ? value() : value, () => {}];
  },
  useSyncExternalStore: (subscribe, getSnapshot) => {
    hookCalls.push('useSyncExternalStore');
    void subscribe;
    return getSnapshot();
  },
};

/** Stand-in for the table's `react-dom` seed. */
const reactDomStub = {
  createPortal: (node, container) => ({ portal: node, container }),
};

/**
 * Stand-in for `@deepseek-ai/dsh-client-ui-primitives`. Only the components the
 * Client half reaches for are needed; the plugin falls back to native controls
 * when this module is absent, which is asserted separately.
 */
const primitivesStub = {
  Switch: (props) => reactStub.createElement('button', { role: 'switch', 'aria-checked': props.checked }, props.label),
  Checkbox: (props) => reactStub.createElement('input', { type: 'checkbox', checked: props.checked }, props.label),
  SegmentedControl: (props) => reactStub.createElement('div', { role: 'radiogroup' }, props.label),
  Input: (props) => reactStub.createElement('input', props),
  Button: (props) => reactStub.createElement('button', props, props.children),
};

/** Seed words the web shell publishes into the module table. */
const SEED = {
  react: reactStub,
  'react-dom': reactDomStub,
  '@deepseek-ai/dsh-client-ui-primitives': primitivesStub,
};

// ---------------------------------------------------------------- DOM shims

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.textContent = '';
    this.isConnected = true;
    this.nodeType = 1;
    this.childNodes = [];
    this.listeners = new Map();
  }

  append(...nodes) {
    for (const node of nodes) {
      this.children.push(node);
      if (node && typeof node === 'object') node.parentElement = this;
    }
  }

  remove() {
    this.isConnected = false;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }

  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }

  closest() {
    return null;
  }

  getBoundingClientRect() {
    return { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
  }
}

const head = new FakeElement('head');
const body = new FakeElement('body');
const document = {
  head,
  body,
  getElementById: () => null,
  createElement: (tag) => new FakeElement(tag),
  addEventListener() {},
  removeEventListener() {},
  execCommand: () => true,
};
const window = {
  innerWidth: 1200,
  innerHeight: 800,
  localStorage: {
    store: new Map(),
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null;
    },
    setItem(key, value) {
      this.store.set(key, String(value));
    },
  },
  addEventListener() {},
  removeEventListener() {},
  setInterval: () => 0,
  clearInterval: () => {},
  getSelection: () => null,
};
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'ClipboardEvent', 'DataTransfer', 'React']) {
  // Provided per-test below; `React` is a placeholder for nothing.
  void name;
}
globalThis.window = window;
globalThis.document = document;
// Node 26 exposes `navigator` as a getter; the Client half only reaches for
// `navigator.clipboard`, so adding that property is enough.
Object.defineProperty(globalThis.navigator, 'clipboard', {
  value: { writeText: async () => {} },
  configurable: true,
});
globalThis.HTMLElement = FakeElement;
globalThis.HTMLInputElement = class extends FakeElement {};
globalThis.HTMLTextAreaElement = class extends FakeElement {};
globalThis.Element = FakeElement;
globalThis.ClipboardEvent = class ClipboardEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.clipboardData = init.clipboardData ?? null;
  }
};
globalThis.DataTransfer = class DataTransfer {
  constructor() {
    this.data = new Map();
  }

  setData(type, value) {
    this.data.set(type, value);
  }

  getData(type) {
    return this.data.get(type) ?? '';
  }
};

// ------------------------------------------------------- module table

const factories = new Map();
const cache = new Map();
const materializing = new Set();

globalThis.window.__ModuleLoader__ = {
  load({ id, factory }) {
    factories.set(id, factory);
  },
};

/** The `require` a bundle receives: seed first, then registered factories. */
function makeRequire() {
  return (spec) => {
    if (Object.hasOwn(SEED, spec)) return SEED[spec];
    if (cache.has(spec)) return cache.get(spec);
    const factory = factories.get(spec);
    if (factory === undefined) {
      throw new Error(`require("${spec}") missed the module table — registered: ${[...factories.keys()].join(', ') || '(none)'}`);
    }
    if (materializing.has(spec)) throw new Error(`require cycle through "${spec}"`);
    materializing.add(spec);
    try {
      const exports = factory(makeRequire());
      cache.set(spec, exports);
      return exports;
    } finally {
      materializing.delete(spec);
    }
  };
}

/**
 * Load one bundle file the way the browser module table does.
 * @param file - bundle file name inside the package root.
 */
function loadBundle(file) {
  const source = readFileSync(join(root, file), 'utf8');
  // eslint-disable-next-line no-new-func -- the harness intentionally evaluates the bundle
  new Function('window', 'document', source)(window, document);
}

const steps = [];
function step(name, fn) {
  try {
    const value = fn();
    steps.push(`PASS  ${name}`);
    return value;
  } catch (error) {
    steps.push(`FAIL  ${name}\n        ${error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n        ') : String(error)}`);
    return undefined;
  }
}

step('load client.js', () => loadBundle('client.js'));

const engine = step('inlined engine works', () => {
  const mod = makeRequire()('@local/dsh-plugin-data-mask');
  if (mod === undefined) throw new Error('client module did not register');
  return mod;
});

const client = engine;
if (client !== undefined) {
  step('apply() runs', () => {
    const registered = [];
    const localeService = {
      register: () => () => {},
      bind: () => (key) => key,
      getSnapshot: () => ({ active: 'zh', locales: [], revision: 0 }),
      subscribe: () => () => {},
    };
    const ctx = {
      effect: (fn) => {
        const cleanup = fn();
        return () => cleanup?.();
      },
      on: () => () => {},
      // Cordis exposes `ctx.get(name)` for an inject-free service read.
      get: (name) => (name === 'locale' ? localeService : undefined),
      locale: { register: () => () => {}, bind: () => (key) => key, getSnapshot: () => ({ active: 'zh', locales: [], revision: 0 }), subscribe: () => () => {} },
      slots: {
        inject: (key, callback) => {
          registered.push({ key, effect: callback() });
          return () => {};
        },
        register: (options, component) => {
          registered.push({ options, component });
          return () => {};
        },
      },
    };
    client.apply(ctx);
    // The plugin registers the masked-paste notice (root scope) and its Settings
    // page (the shell's panel), and installs the paste interceptor.
    const slots = registered.filter((entry) => entry.options !== undefined).map((entry) => entry.options.name);
    for (const expected of ['shell.overlay', 'settings.section']) {
      if (!slots.includes(expected)) throw new Error(`${expected} was not registered (got ${slots.join(', ') || 'nothing'})`);
    }
    const notice = registered.find((entry) => entry.options?.name === 'shell.overlay');
    if (typeof notice.component !== 'function') throw new Error('notice component is not a function');
    const page = registered.find((entry) => entry.options?.name === 'settings.section');
    if (typeof page.component !== 'function') throw new Error('settings component is not a function');
    if (typeof page.options.label !== 'function') throw new Error('settings nav label must be a thunk');
  });
}

console.log(steps.join('\n'));
const failed = steps.some((line) => line.startsWith('FAIL'));
console.log(failed ? '\nRESULT: reproduction found an error' : '\nRESULT: no error reproduced');
process.exit(failed ? 1 : 0);
