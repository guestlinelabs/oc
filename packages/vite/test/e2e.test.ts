import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

let fixtureDir: string;

function writeFixtureFile(rel: string, content: string) {
  const p = path.join(fixtureDir, rel);
  return fsp
    .mkdir(path.dirname(p), { recursive: true })
    .then(() => fsp.writeFile(p, content));
}

beforeAll(async () => {
  fixtureDir = mkdtempSync(path.join(tmpdir(), 'oc-vite-e2e-'));

  // node_modules links so the fixture's vite.config.ts can resolve
  // 'vite' and '@guestlinelabs/oc-vite/plugin' like a real component.
  const nm = path.join(fixtureDir, 'node_modules');
  await fsp.mkdir(path.join(nm, '@guestlinelabs'), { recursive: true });
  const vitePkgJson = require.resolve('vite/package.json');
  symlinkSync(path.dirname(vitePkgJson), path.join(nm, 'vite'), 'dir');
  symlinkSync(packageRoot, path.join(nm, '@guestlinelabs', 'oc-vite'), 'dir');

  await writeFixtureFile(
    'package.json',
    JSON.stringify(
      {
        name: 'e2e-oc-component',
        version: '1.2.3',
        type: 'module',
        oc: {
          files: {
            template: { type: 'oc-template-esm', src: 'src/view.jsx' },
            data: 'src/server.js',
            static: ['public'],
            env: '.env'
          }
        }
      },
      null,
      2
    )
  );
  await writeFixtureFile(
    'vite.config.ts',
    `import { defineConfig } from 'vite';\nimport oc from '@guestlinelabs/oc-vite/plugin';\nexport default defineConfig({ plugins: [oc()] });\n`
  );
  await writeFixtureFile(
    'src/view.jsx',
    `import './style.css';\nimport styles from './mod.module.css';\n\nexport default {\n  mount(element, props) {\n    element.innerHTML = '<div class="' + styles.box + '">Hello</div>';\n  },\n  unmount() {},\n};\n`
  );
  await writeFixtureFile('src/style.css', 'body { margin: 0; }\n');
  await writeFixtureFile('src/mod.module.css', '.box { color: red; }\n');
  await writeFixtureFile(
    'src/server.js',
    `import { Server } from '@guestlinelabs/oc-vite';\n\nexport const server = new Server()\n  .withParameters({\n    foo: { type: 'string', mandatory: true },\n  })\n  .handler(async (params) => ({ greeting: 'hi ' + (params?.foo ?? 'anon') }));\n`
  );
  await writeFixtureFile('public/asset.txt', 'static-asset\n');
  await writeFixtureFile('.env', 'SECRET=abc\n');
});

afterAll(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

const pkgJson = async () =>
  JSON.parse(
    await fsp.readFile(
      path.join(fixtureDir, '_package', 'package.json'),
      'utf8'
    )
  );

describe('oc() end-to-end build', () => {
  test('vite build produces a complete _package', async () => {
    await build({
      root: fixtureDir,
      logLevel: 'silent'
    });

    const files = await fsp.readdir(path.join(fixtureDir, '_package'));
    expect(files).toContain('template.js');
    expect(files).toContain('server.js');
    expect(files).toContain('package.json');
    expect(files).toContain('.env');
    expect(files).not.toContain('temp');

    const pkg = await pkgJson();
    expect(pkg.name).toBe('e2e-oc-component');
    expect(pkg.oc.files.template.type).toBe('oc-template-esm');
    expect(pkg.oc.files.template.src).toBe('template.js');
    expect(pkg.oc.files.template.version).toBe('0.0.1');
    expect(pkg.oc.files.template.minOcVersion).toBe('0.50.18');
    expect(pkg.oc.files.template.hashKey).toMatch(/^[0-9a-f]{40}$/);
    expect(pkg.oc.files.template.size).toBeGreaterThan(0);
    expect(pkg.oc.files.dataProvider.type).toBe('node.js');
    expect(pkg.oc.files.dataProvider.src).toBe('server.js');
    expect(pkg.oc.files.dataProvider.hashKey).toMatch(/^[0-9a-f]{40}$/);
    expect(pkg.oc.files.data).toBeUndefined();
    expect(pkg.oc.files.client).toBeUndefined();
    expect(pkg.oc.parameters.foo).toEqual({
      type: 'string',
      mandatory: true
    });
    expect(pkg.oc.version).toBe('0.50.67');
    expect(pkg.oc.packaged).toBe(true);
    expect(typeof pkg.oc.date).toBe('number');
    expect(pkg.oc.files.static).toEqual(['public']);

    // statics copied
    expect(
      await fsp.readFile(
        path.join(fixtureDir, '_package', 'public', 'asset.txt'),
        'utf8'
      )
    ).toBe('static-asset\n');
    // .env copied
    expect(
      await fsp.readFile(path.join(fixtureDir, '_package', '.env'), 'utf8')
    ).toBe('SECRET=abc\n');

    // template.js: mount export, css injection, hashed css modules
    const template = await fsp.readFile(
      path.join(fixtureDir, '_package', 'template.js'),
      'utf8'
    );
    expect(template).toMatch(/export\s*(\{|function mount)/);
    expect(template).toContain('mount');
    expect(template).toContain('__$$oc_initialData__');
    expect(template).toContain('__$$oc_Settings__');
    expect(template).toContain('document.createElement'); // css injection
    expect(template).toContain('getRootNode'); // renderer bundled (minified)
    // Upstream `viteEsmView` always emits a sourcemap, even in production.
    expect(template).toContain('sourceMappingURL');
    expect(files).toContain('template.js.map');

    // server.js: executable CJS data provider
    const serverBundle = await fsp.readFile(
      path.join(fixtureDir, '_package', 'server.js'),
      'utf8'
    );
    expect(serverBundle).toContain('exports.data');
    const cjsPath = path.join(fixtureDir, '_package', 'server.test.cjs');
    await fsp.writeFile(cjsPath, serverBundle);
    try {
      const { data, server } = require(cjsPath);
      expect(typeof data).toBe('function');
      expect(server._parameters.foo.type).toBe('string');
      const res: any = await new Promise((resolve, reject) =>
        data(
          {
            staticPath: 'https://cdn.example.com/pkg/',
            baseUrl: '/oc/',
            params: { foo: 'bar' }
          },
          (err: any, r: any) => (err ? reject(err) : resolve(r))
        )
      );
      expect(res.component.esm).toBe(true);
      expect(res.component.src).toBe('https://cdn.example.com/pkg/template.js');
      expect(res.component.key).toBe(pkg.oc.files.template.hashKey);
      expect(res.component.props.greeting).toBe('hi bar');
      expect(res.component.props._componentName).toBe('e2e-oc-component');
    } finally {
      await fsp.rm(cjsPath, { force: true });
    }
  }, 60_000);

  test('rebuild is idempotent and cleans temp', async () => {
    await build({ root: fixtureDir, logLevel: 'silent' });
    const pkg = await pkgJson();
    expect(pkg.oc.packaged).toBe(true);
    expect(existsSync(path.join(fixtureDir, '_package', 'temp'))).toBe(false);
  }, 60_000);

  test('emits template.js when the component package.json is not type module', async () => {
    const pkgPath = path.join(fixtureDir, 'package.json');
    const original = await fsp.readFile(pkgPath, 'utf8');
    const { type: _type, ...commonJs } = JSON.parse(original);
    await fsp.writeFile(pkgPath, JSON.stringify(commonJs, null, 2));
    try {
      await build({ root: fixtureDir, logLevel: 'silent' });
      const files = await fsp.readdir(path.join(fixtureDir, '_package'));
      expect(files).toContain('template.js');
      expect(files).toContain('template.js.map');
      expect(files.some((file) => file.endsWith('.mjs'))).toBe(false);
      expect((await pkgJson()).oc.files.template.src).toBe('template.js');
    } finally {
      await fsp.writeFile(pkgPath, original);
    }
  }, 60_000);
});
