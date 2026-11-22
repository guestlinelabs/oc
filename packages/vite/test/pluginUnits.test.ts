import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import esmOCProviderTemplate from '../src/vite/esmOCProviderTemplate.js';
import { ocExternalsPlugin } from '../src/vite/externals.js';
import initialDataPlugin from '../src/vite/initialData.js';
import { ocServerRuntimePlugin } from '../src/vite/serverRuntime.js';

describe('initialDataPlugin', () => {
  test('prepends __$$oc_initialData__/__$$oc_Settings__ declarations to js chunks', () => {
    const plugin = initialDataPlugin() as any;
    const bundle: any = {
      'template.js': { type: 'chunk', code: 'CODE' },
      'style.css': { type: 'asset', source: 'x' }
    };
    plugin.generateBundle.call({}, {}, bundle);
    expect(bundle['template.js'].code).toContain('var __$$oc_initialData__;');
    expect(bundle['template.js'].code).toContain('var __$$oc_Settings__;');
    expect(bundle['template.js'].code).toContain('CODE');
    expect(bundle['style.css'].source).toBe('x');
  });
});

describe('ocServerRuntimePlugin', () => {
  const plugin = () =>
    ocServerRuntimePlugin({
      componentName: 'comp',
      componentVersion: '2.0.0'
    }) as any;

  test('rewrites placeholders in our serverClient module', () => {
    const p = plugin();
    const res = p.transform.call(
      {},
      `const a = 'COMPONENT_NAME'; const b = 'COMPONENT_VERSION';`,
      '/x/node_modules/@guestlinelabs/oc-vite/dist/serverClient.js'
    );
    expect(res.code).toContain('"comp"');
    expect(res.code).toContain('"2.0.0"');
  });

  test('matches the plugin-relative path (workspace/link installs)', () => {
    const p = plugin();
    // ownServerClientPath resolves '../serverClient.js' relative to
    // src/vite/serverRuntime.ts, i.e. src/serverClient.js under bun test.
    const ownPath = fileURLToPath(
      new URL('../src/serverClient.js', import.meta.url)
    );
    const res = p.transform.call({}, `'COMPONENT_NAME'`, ownPath);
    expect(res?.code ?? '').toContain('"comp"');
  });

  test('ignores other modules and unconfigured state', () => {
    const p = plugin();
    expect(
      p.transform.call({}, `'COMPONENT_NAME'`, '/x/other.js')
    ).toBeUndefined();
    const unconfigured = ocServerRuntimePlugin({}) as any;
    const id = new URL('../dist/serverClient.js', import.meta.url).pathname;
    expect(
      unconfigured.transform.call({}, `'COMPONENT_NAME'`, id)
    ).toBeUndefined();
  });
});

describe('ocExternalsPlugin', () => {
  const root = new URL('..', import.meta.url).pathname;
  const rolldown = { meta: { rolldownVersion: '1.0.0' } };
  const rollup = { meta: { rollupVersion: '4.0.0' } };

  test('hands string/regex externals to esmExternalRequirePlugin on rolldown', async () => {
    const plugin = ocExternalsPlugin(() => root) as any;
    const inputOptions: any = {
      external: ['react', /node:/],
      plugins: ['existing']
    };
    await plugin.options.call(rolldown, inputOptions);
    expect(inputOptions.external).toEqual([]);
    expect(inputOptions.plugins).toHaveLength(2);
    expect(inputOptions.plugins[0]).toBe('existing');
    expect(inputOptions.plugins[1]).toBeDefined();
  });

  test('keeps externals on rollup-based vite even when a rolldown vite is importable', async () => {
    const plugin = ocExternalsPlugin(() => root) as any;
    const inputOptions: any = { external: ['react', 'react-dom/client'] };
    await plugin.options.call(rollup, inputOptions);
    expect(inputOptions.external).toEqual(['react', 'react-dom/client']);
    expect(inputOptions.plugins).toBeUndefined();
  });

  test('leaves function externals untouched', async () => {
    const plugin = ocExternalsPlugin(() => root) as any;
    const fn = (id: string) => id === 'x';
    const inputOptions: any = { external: fn };
    await plugin.options.call(rolldown, inputOptions);
    expect(inputOptions.external).toBe(fn);
    expect(inputOptions.plugins).toBeUndefined();
  });
});

describe('esmOCProviderTemplate', () => {
  const base = {
    viewPath: '/comp/src/view.jsx',
    production: true,
    styleId: 'style-1'
  };

  test('imports the view and renderer, exports mount', () => {
    const out = esmOCProviderTemplate(base);
    expect(out).toContain("import Component from '/comp/src/view'");
    expect(out).toContain(
      "import { getShadowRoot } from '@guestlinelabs/oc-vite/renderer'"
    );
    expect(out).toContain('export function mount(element, props, ctx = {})');
    expect(out).toContain('__$$oc_initialData__ = rest;');
    expect(out).toContain('__$$oc_Settings__ = {id, element');
  });

  test('production omits console forwarding, dev includes it', () => {
    expect(esmOCProviderTemplate(base)).not.toContain('getAction');
    const dev = esmOCProviderTemplate({ ...base, production: false });
    expect(dev).toContain('$$__oc__server___console__$$');
    expect(dev).toContain('ctx.development?.console');
  });

  test('shadowDOM open/closed attach a shadow root and clone the style', () => {
    const out = esmOCProviderTemplate({ ...base, shadowDOM: 'closed' });
    expect(out).toContain("const mode = 'closed'");
    expect(out).toContain('element.attachShadow({ mode })');
    expect(out).toContain("clone.removeAttribute('type')");
    expect(out).toContain('shadowRoot.appendChild(container)');
  });

  test('shadowDOM true maps to open mode', () => {
    const out = esmOCProviderTemplate({ ...base, shadowDOM: true });
    expect(out).toContain("const mode = 'open'");
    expect(out).toContain('if (true)');
  });

  test('no shadowDOM emits a dead branch and resolves the page-owned root', () => {
    const out = esmOCProviderTemplate(base);
    expect(out).toContain('if (false)');
    expect(out).toContain("const mode = 'undefined'");
    expect(out).toContain('const shadowRoot = getShadowRoot(element);');
  });
});
