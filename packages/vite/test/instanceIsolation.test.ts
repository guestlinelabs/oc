import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const VITES = {
  'vite 8 (rolldown)': path.dirname(require.resolve('vite/package.json')),
  'vite 7 (rollup)': path.dirname(require.resolve('vite7/package.json'))
};

// Reads initial data after mount returns, like a React render or an effect
// does, and keeps module-level state to show it is per instance.
const VIEW = `import { getInitialData, getSettings } from '@guestlinelabs/oc-vite/client';

let mounts = 0;

export default {
  mount(element) {
    mounts++;
    queueMicrotask(() => {
      element.result = {
        label: getInitialData().label,
        id: getSettings().id,
        mounts
      };
    });
  },
  unmount() {}
};
`;

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

async function buildFixture(
  viteDir: string,
  mode: 'production' | 'development',
  pluginOptions = ''
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'oc-vite-isolation-'));
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
      name: 'isolation-component',
      version: '1.0.0',
      oc: {
        files: { template: { type: 'oc-template-esm', src: 'src/view.js' } }
      }
    })
  );
  await write(
    'vite.config.mjs',
    `import oc from '@guestlinelabs/oc-vite/plugin';\nexport default { plugins: [oc(${pluginOptions})] };\n`
  );
  await write('src/view.js', VIEW);

  const vite = (await import(
    path.join(viteDir, 'dist/node/index.js')
  )) as typeof import('vite');
  await vite.build({ root: dir, mode, logLevel: 'silent' });
  return path.join(dir, '_package/template.js');
}

type Result = { label: string; id: string; mounts: number };

async function mountTwice(templatePath: string) {
  (globalThis as { document?: unknown }).document ??= {
    getElementById: () => null
  };
  const { mount } = (await import(pathToFileURL(templatePath).href)) as {
    mount: (element: unknown, props: Record<string, unknown>) => void;
  };
  const element = (id: string) => ({
    result: undefined as Result | undefined,
    getAttribute: (name: string) => (name === 'id' ? id : null)
  });
  const first = element('first');
  const second = element('second');
  mount(first, { label: 'one', _componentName: 'isolation-component' });
  mount(second, { label: 'two', _componentName: 'isolation-component' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return [first.result, second.result];
}

describe.each(Object.entries(VITES))('%s', (_name, viteDir) => {
  test.each(['production', 'development'] as const)(
    '%s: each mounted instance keeps its own initial data and settings',
    async (mode) => {
      const [first, second] = await mountTwice(
        await buildFixture(viteDir, mode)
      );
      expect(first).toEqual({ label: 'one', id: 'first', mounts: 1 });
      expect(second).toEqual({ label: 'two', id: 'second', mounts: 1 });
    },
    60_000
  );

  test('isolateInstances: false shares one module scope', async () => {
    const [first, second] = await mountTwice(
      await buildFixture(viteDir, 'production', '{ isolateInstances: false }')
    );
    expect(first).toEqual({ label: 'two', id: 'second', mounts: 2 });
    expect(second).toEqual({ label: 'two', id: 'second', mounts: 2 });
  }, 60_000);
});
