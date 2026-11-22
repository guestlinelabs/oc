import { describe, expect, test } from 'bun:test';
import cssModulesPlugin from '../src/vite/cssModulesPlugin.js';

const transform = (code: string, id = '/comp/src/view.jsx') => {
  const plugin = cssModulesPlugin() as any;
  return plugin.transform.call({}, code, id);
};

describe('cssModulesPlugin', () => {
  test('rewrites bound css imports to .module.css', () => {
    const res = transform(
      `import styles from './app.css';\nimport logo from "./logo.less";`
    );
    expect(res.code).toContain(`from './app.css?.module.css'`);
    expect(res.code).toContain(`from "./logo.less?.module.less"`);
  });

  test('leaves side-effect imports alone', () => {
    const code = `import './global.css';`;
    expect(transform(code)).toBeUndefined();
  });

  test('leaves existing .module.css imports alone', () => {
    const code = `import styles from './app.module.css';`;
    expect(transform(code)).toBeUndefined();
  });

  test('ignores non-js files and non-css imports', () => {
    expect(
      transform(`import x from './a.css';`, '/comp/src/view.css')
    ).toBeUndefined();
    const res = transform(`import x from './a.ts';`);
    expect(res).toBeUndefined();
  });

  test('appends & when query already present (upstream parity quirk)', () => {
    // Upstream computes the extension via `split('.').pop()`, so a query
    // string leaks into it — preserved intentionally for parity.
    const res = transform(`import s from './a.css?inline';`);
    expect(res.code).toContain(`'./a.css?inline&.module.css?inline'`);
  });
});
