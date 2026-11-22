import { describe, expect, test } from 'bun:test';
import serverWrapper from '../src/vite/serverWrapper.js';

describe('serverWrapper', () => {
  const base = {
    serverPath: '/comp/src/server.ts',
    componentName: 'my-component',
    componentVersion: '1.0.0',
    bundleHashKey: 'abc123',
    production: true,
    esm: true
  };

  test('wraps the entry in a namespace import and exports data + server', () => {
    const out = serverWrapper(base);
    expect(out).toContain(
      "import * as __oc_server_module__ from '/comp/src/server'"
    );
    expect(out).toContain('export const server = __oc_server_export__');
    expect(out).toContain('export const data =');
    expect(out).toContain('__oc_server_export__.getData()');
  });

  test('injects component identity, bundle key and esm flag', () => {
    const out = serverWrapper(base);
    expect(out).toContain('_componentName: "my-component"');
    expect(out).toContain('_componentVersion: "1.0.0"');
    expect(out).toContain('key: "abc123"');
    expect(out).toContain('esm: true');
    expect(out).toContain('src: srcPath + "template.js"');
    // production -> development is the `undefined` literal
    expect(out).toContain('development: undefined');
  });

  test('development mode passes meta through', () => {
    const out = serverWrapper({ ...base, production: false });
    expect(out).toContain('development: meta');
  });

  test('empty model short-circuits with __oc_emptyResponse', () => {
    const out = serverWrapper(base);
    expect(out).toContain('__oc_emptyResponse: true');
  });
});
