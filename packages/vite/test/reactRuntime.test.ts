import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  isReactExternal,
  ocReactRuntimePlugin
} from '../src/vite/reactRuntime';

const makeComponent = (runtimeFile: string) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-react-runtime-'));
  const reactDir = path.join(root, 'node_modules/react');
  fs.mkdirSync(path.join(reactDir, 'cjs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"c"}');
  fs.writeFileSync(
    path.join(reactDir, 'package.json'),
    '{"name":"react","version":"19.2.0"}'
  );
  fs.writeFileSync(path.join(reactDir, 'cjs', runtimeFile), '');
  return { root, runtime: path.join(reactDir, 'cjs', runtimeFile) };
};

const importedFile = (code: string) =>
  fs.realpathSync(JSON.parse(code.match(/^import runtime from (\S+);/)![1]));

const resolved = (root: string, external: unknown) => {
  const plugin = ocReactRuntimePlugin() as any;
  plugin.configResolved({ root, build: { rollupOptions: { external } } });
  return plugin;
};

describe('isReactExternal', () => {
  test('matches strings, regexes and functions', () => {
    expect(isReactExternal(['react', 'react-dom/client'])).toBe(true);
    expect(isReactExternal([/^react$/])).toBe(true);
    expect(isReactExternal((id: string) => id === 'react')).toBe(true);
    expect(isReactExternal(['react-dom/client'])).toBe(false);
    expect(isReactExternal(undefined)).toBe(false);
  });
});

describe('ocReactRuntimePlugin', () => {
  test('pins both JSX runtimes to the production runtime when react is external', () => {
    const { root, runtime } = makeComponent('react-jsx-runtime.production.js');
    const plugin = resolved(root, ['react']);

    const id = plugin.resolveId('react/jsx-dev-runtime');
    expect(id).toBe(plugin.resolveId('react/jsx-runtime'));
    const code = plugin.load(id);
    expect(importedFile(code)).toBe(fs.realpathSync(runtime));
    expect(code).toContain('export function jsxDEV');
  });

  test('supports the React 17/18 minified production runtime', () => {
    const { root, runtime } = makeComponent(
      'react-jsx-runtime.production.min.js'
    );
    const plugin = resolved(root, ['react']);

    expect(
      importedFile(plugin.load(plugin.resolveId('react/jsx-runtime')))
    ).toBe(fs.realpathSync(runtime));
  });

  test('leaves the runtime alone when react is bundled', () => {
    const { root } = makeComponent('react-jsx-runtime.production.js');
    const plugin = resolved(root, ['react-dom/client']);

    expect(plugin.resolveId('react/jsx-dev-runtime')).toBeNull();
  });
});
