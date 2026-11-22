import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

const VIRTUAL_ID = '\0oc-vite:react-jsx-runtime';
const JSX_RUNTIMES = new Set(['react/jsx-runtime', 'react/jsx-dev-runtime']);

/** Whether `react` is left to the page (the registry import map). */
export function isReactExternal(external: unknown): boolean {
  const list = Array.isArray(external) ? external : [external];
  return list.some((entry) =>
    typeof entry === 'string'
      ? entry === 'react'
      : entry instanceof RegExp
        ? entry.test('react')
        : typeof entry === 'function'
          ? entry('react', undefined, false) === true
          : false
  );
}

/**
 * When `react` is external, the page supplies it from the registry import
 * map, which serves React's production build. The JSX runtime is still
 * bundled from the component's node_modules, and its development build
 * (picked for `NODE_ENV=development`, or `jsxDEV` emitted by
 * @vitejs/plugin-react in dev builds such as `oc dev`) calls dev-only React
 * internals (`dispatcher.getOwner`) and crashes against production React.
 * Pin both JSX runtimes to React's production runtime instead, mapping
 * `jsxDEV` onto `jsx`/`jsxs`.
 */
export function ocReactRuntimePlugin(): Plugin {
  let productionRuntime: string | undefined;

  return {
    name: 'OcReactJsxRuntime',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      productionRuntime = undefined;
      if (!isReactExternal(config.build.rollupOptions?.external)) return;
      try {
        const require = createRequire(path.join(config.root, 'package.json'));
        const reactDir = path.dirname(require.resolve('react/package.json'));
        productionRuntime = [
          'cjs/react-jsx-runtime.production.js', // React 19
          'cjs/react-jsx-runtime.production.min.js' // React 17/18
        ]
          .map((file) => path.join(reactDir, file))
          .find((file) => fs.existsSync(file));
      } catch {
        productionRuntime = undefined;
      }
    },
    resolveId(id) {
      return productionRuntime && JSX_RUNTIMES.has(id) ? VIRTUAL_ID : null;
    },
    load(id) {
      if (id !== VIRTUAL_ID || !productionRuntime) return null;
      return `import runtime from ${JSON.stringify(productionRuntime)};
export const Fragment = runtime.Fragment;
export const jsx = runtime.jsx;
export const jsxs = runtime.jsxs;
export function jsxDEV(type, props, key, isStaticChildren) {
  return (isStaticChildren ? runtime.jsxs : runtime.jsx)(type, props, key);
}
`;
    }
  };
}
