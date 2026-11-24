import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// Vite 8 (rolldown) is the package's own devDependency; `vite7` is Vite 7.3.8
// (rollup + esbuild). Components bring either, so both paths are covered.
const VITES = {
  'vite 8 (rolldown)': path.dirname(require.resolve('vite/package.json')),
  'vite 7 (rollup)': path.dirname(require.resolve('vite7/package.json'))
};

const { SourceMapConsumer } = require(
  require.resolve('source-map-js', {
    paths: [path.dirname(require.resolve('vite/package.json'))]
  })
) as typeof import('source-map-js');

const VIEW = `import './style.css';

export default {
  mount(element, props) {
    element.innerHTML = '<p>' + props.label + '</p>';
    element.dataset.marker = 'oc-minify-marker';
  },
  unmount() {},
};
`;

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

async function buildFixture(
  viteDir: string,
  mode: 'production' | 'development'
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'oc-vite-minify-'));
  fixtures.push(dir);
  const write = async (rel: string, content: string) => {
    await fsp.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fsp.writeFile(path.join(dir, rel), content);
  };
  await fsp.mkdir(path.join(dir, 'node_modules/@guestlinelabs'), {
    recursive: true
  });
  symlinkSync(viteDir, path.join(dir, 'node_modules/vite'), 'dir');
  symlinkSync(
    packageRoot,
    path.join(dir, 'node_modules/@guestlinelabs/oc-vite'),
    'dir'
  );
  await write(
    'package.json',
    JSON.stringify({
      name: 'minify-component',
      version: '1.0.0',
      oc: {
        files: { template: { type: 'oc-template-esm', src: 'src/view.js' } }
      }
    })
  );
  await write(
    'vite.config.mjs',
    `import oc from '@guestlinelabs/oc-vite/plugin';\nexport default { plugins: [oc()] };\n`
  );
  await write('src/view.js', VIEW);
  await write('src/style.css', 'p { color: red; }\n');

  const vite = (await import(
    path.join(viteDir, 'dist/node/index.js')
  )) as typeof import('vite');
  await vite.build({ root: dir, mode, logLevel: 'silent' });
  const out = path.join(dir, '_package');
  return {
    code: await fsp.readFile(path.join(out, 'template.js'), 'utf8'),
    map: JSON.parse(
      await fsp.readFile(path.join(out, 'template.js.map'), 'utf8')
    )
  };
}

function originalOf(code: string, map: unknown, needle: string) {
  const index = code.indexOf(needle);
  expect(index).toBeGreaterThan(-1);
  const before = code.slice(0, index);
  const line = before.split('\n').length;
  const column = index - before.lastIndexOf('\n') - 1;
  return new SourceMapConsumer(map as never).originalPositionFor({
    line,
    column
  });
}

describe.each(Object.entries(VITES))('%s', (_name, viteDir) => {
  test('production template.js has no indentation and a map that still points at the source', async () => {
    const { code, map } = await buildFixture(viteDir, 'production');

    expect(code).toMatch(/export\s*(\{|function mount)/);
    expect(code).toContain('oc-minify-marker');
    expect(code.split('\n').filter((line) => /^\s+\S/.test(line))).toEqual([]);

    const position = originalOf(code, map, 'oc-minify-marker');
    expect(position.source).toEndWith('src/view.js');
    expect(position.line).toBe(6);
  }, 60_000);

  test('development template.js stays readable', async () => {
    const { code, map } = await buildFixture(viteDir, 'development');

    expect(code.split('\n').some((line) => /^\s+\S/.test(line))).toBe(true);
    expect(originalOf(code, map, 'oc-minify-marker').line).toBe(6);
  }, 60_000);
});
