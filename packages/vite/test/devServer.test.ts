import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// Fixture layout mirrors an `oc dev <componentsDir>` checkout: the component
// lives in `component/` and the mocks live in the parent `oc.json`, which is
// what upstream `oc-server/vite` discovers from `process.cwd()/..`.
let fixtureRoot: string;
let componentDir: string;
let server: ViteDevServer;
let baseUrl: string;

const COMPONENT_NAME = 'dev-oc-component';
const COMPONENT_VERSION = '2.0.0';

const serverEntryV1 = `import { Server } from '@guestlinelabs/oc-vite';

export const server = new Server()
  .withParameters({
    greeting: { type: 'string', mandatory: true, example: 'hello-dev' }
  })
  .handler(async (params, ctx) => ({
    greeting: params?.greeting ?? 'fallback',
    pluginValue: ctx.plugins?.testPlugin ? ctx.plugins.testPlugin('x') : null,
    dynValue: ctx.plugins?.dynPlugin ? ctx.plugins.dynPlugin() : null,
    envName: ctx.env?.name ?? null
  }))
  .action('greet', async (params) => ({
    reply: 'yo ' + (params?.name ?? 'anon')
  }));
`;

function writeFixtureFile(rel: string, content: string) {
  const p = path.join(componentDir, rel);
  return fsp
    .mkdir(path.dirname(p), { recursive: true })
    .then(() => fsp.writeFile(p, content));
}

beforeAll(async () => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), 'oc-vite-dev-'));
  componentDir = path.join(fixtureRoot, 'component');
  await fsp.mkdir(componentDir, { recursive: true });

  // oc.json at the components root (parent of the component), like upstream.
  await fsp.mkdir(path.join(fixtureRoot, 'mocks'), { recursive: true });
  await fsp.writeFile(
    path.join(fixtureRoot, 'oc.json'),
    JSON.stringify(
      {
        mocks: {
          plugins: {
            static: { testPlugin: 'STATIC_MOCK_VALUE' },
            dynamic: { dynPlugin: './mocks/dyn-plugin.cjs' }
          }
        }
      },
      null,
      2
    )
  );
  await fsp.writeFile(
    path.join(fixtureRoot, 'mocks', 'dyn-plugin.cjs'),
    `module.exports = {
  register: (options, deps, next) => next(),
  execute: () => 'DYNAMIC_MOCK_VALUE'
};
`
  );

  // node_modules links so the fixture's vite.config.ts can resolve
  // 'vite' and '@guestlinelabs/oc-vite' like a real component.
  const nm = path.join(componentDir, 'node_modules');
  await fsp.mkdir(path.join(nm, '@guestlinelabs'), { recursive: true });
  const vitePkgJson = require.resolve('vite/package.json');
  symlinkSync(path.dirname(vitePkgJson), path.join(nm, 'vite'), 'dir');
  symlinkSync(packageRoot, path.join(nm, '@guestlinelabs', 'oc-vite'), 'dir');

  await writeFixtureFile(
    'package.json',
    JSON.stringify(
      {
        name: COMPONENT_NAME,
        version: COMPONENT_VERSION,
        type: 'module',
        oc: {
          files: {
            template: { type: 'oc-template-esm', src: 'src/view.js' },
            data: 'src/server.js'
          }
        }
      },
      null,
      2
    )
  );
  await writeFixtureFile(
    'vite.config.ts',
    `import { defineConfig } from 'vite';\nimport oc from '@guestlinelabs/oc-vite/plugin';\nexport default defineConfig({\n  plugins: [oc()],\n  resolve: {\n    alias: { 'oc-test-lib': 'https://esm.sh/oc-test-lib@1.0.0' }\n  }\n});\n`
  );
  await writeFixtureFile(
    'src/view.js',
    `export default {
  mount(element, props) {
    element.innerHTML = '<h1>' + (props.greeting ?? 'none') + '</h1>';
  },
  unmount() {},
};
`
  );
  await writeFixtureFile('src/server.js', serverEntryV1);

  server = await createServer({
    root: componentDir,
    logLevel: 'silent',
    // Own port on an explicit address: a dev server already on 5173 (or on
    // another address family) must not answer this suite's requests.
    server: { host: '127.0.0.1', port: 0, strictPort: true }
  });
  await server.listen();
  const address = server.httpServer!.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(async () => {
  await server?.close();
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});

const get = (urlPath: string, headers: Record<string, string> = {}) =>
  fetch(baseUrl + urlPath, { headers });

const unrenderedHeaders = {
  Accept: 'application/vnd.oc.unrendered+json'
};

// Vite extracts inline <script type="module"> blocks into html-proxy
// modules; return the proxy module's source so tests can assert on the
// rewritten import specifiers.
async function getHtmlProxySource(html: string): Promise<string> {
  const match = html.match(/src="([^"]*html-proxy[^"]*)"/);
  expect(match).toBeTruthy();
  const proxyUrl = match![1].replaceAll('&amp;', '&');
  const res = await get(proxyUrl);
  expect(res.status).toBe(200);
  return res.text();
}

describe('oc() vite dev server', () => {
  test('GET / serves the preview page with import map, client and mount block', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();

    expect(html).toContain('<script type="importmap">');
    expect(html).toContain('oc-test-lib');
    expect(html).toContain('/oc-client/client.js');
    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain('__INITIAL_DATA__');

    // The inline mount script went through Vite's html-proxy pipeline: its
    // bare specifier was rewritten to the virtual module's /@id/ URL and
    // __INITIAL_DATA__ was replaced with the provider result (which
    // includes the mocked plugin output and the parameter example).
    const proxy = await getHtmlProxySource(html);
    expect(proxy).toContain('/@id/__x00__oc-vite:dev-entry');
    expect(proxy).toContain('mount(container');
    expect(proxy).toContain('STATIC_MOCK_VALUE');
    expect(proxy).toContain('DYNAMIC_MOCK_VALUE');
    expect(proxy).toContain('hello-dev');
    expect(proxy).not.toContain('__INITIAL_DATA__');
  }, 30_000);

  test('GET /oc-client/client.js serves the vendored oc-client bundle', async () => {
    const res = await get('/oc-client/client.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    const js = await res.text();
    expect(js).toContain('oc-client');
    expect(js.length).toBeGreaterThan(1000);
  });

  test('GET /{name}/{version} returns the unrendered envelope', async () => {
    const res = await get(
      `/${COMPONENT_NAME}/${COMPONENT_VERSION}`,
      unrenderedHeaders
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.type).toBe('oc-component');
    expect(body.name).toBe(COMPONENT_NAME);
    expect(body.version).toBe(COMPONENT_VERSION);
    expect(body.renderMode).toBe('unrendered');
    expect(body.data.component.esm).toBe(true);
    expect(body.data.component.src).toContain('/@id/');
    expect(body.data.component.development).toEqual({ console: false });

    const props = body.data.component.props;
    // Mandatory parameter example fills in the default.
    expect(props.greeting).toBe('hello-dev');
    // Mocked plugins from the parent oc.json (static + dynamic).
    expect(props.pluginValue).toBe('STATIC_MOCK_VALUE');
    expect(props.dynValue).toBe('DYNAMIC_MOCK_VALUE');
    expect(props.envName).toBe('local');
    // `_`-prefixed keys are injected for non-action calls.
    expect(props._componentName).toBe(COMPONENT_NAME);
    expect(props._componentVersion).toBe(COMPONENT_VERSION);
    expect(props._staticPath).toBe('/');
    expect(props._baseUrl).toBe('/');
  });

  test('GET /{name}/{version} merges query params over defaults', async () => {
    const res = await get(
      `/${COMPONENT_NAME}/${COMPONENT_VERSION}?greeting=hola`,
      unrenderedHeaders
    );
    const body = (await res.json()) as any;
    expect(body.data.component.props.greeting).toBe('hola');
  });

  test('GET /{name}/{version}~preview serves the preview page', async () => {
    const res = await get(`/${COMPONENT_NAME}/${COMPONENT_VERSION}/~preview`, {
      Accept: 'text/html'
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('/oc-client/client.js');
  });

  test('POST /~actions/:action/:name/:version runs the action', async () => {
    const res = await fetch(
      `${baseUrl}/~actions/greet/${COMPONENT_NAME}/${COMPONENT_VERSION}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/vnd.oc.unrendered+json'
        },
        body: JSON.stringify({ name: 'bob' })
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.component.props).toEqual({ reply: 'yo bob' });
  });

  test('POST / handles the upstream {components:[...]} batch shape', async () => {
    const res = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        components: [
          {
            action: 'greet',
            parameters: { name: 'batch' }
          },
          {
            parameters: { greeting: 'batchdata' }
          }
        ]
      })
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body).toHaveLength(2);
    expect(body[0].response.data.component.props).toEqual({
      reply: 'yo batch'
    });
    expect(body[1].response.data.component.props.greeting).toBe('batchdata');
  });

  test('the dev entry module is served through the Vite module graph', async () => {
    const res = await get('/@id/__x00__oc-vite:dev-entry');
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain('export function mount');
    expect(js).toContain('window.__$$oc_initialData__');
    // The wrapper's view import was rewritten to a served module URL.
    expect(js).toMatch(/from\s+['"]\/(src|@fs)\//);
  });

  test('a component index.html gets the client + mount block injected', async () => {
    const indexHtml = `<!DOCTYPE html>
<html><head><title>custom</title></head>
<body><div id="custom-root">keep me</div></body></html>`;
    await writeFixtureFile('index.html', indexHtml);
    try {
      const res = await get('/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('keep me');
      expect(html).toContain('/oc-client/client.js');
      expect(html).toContain('<div id="root"></div>');
      const proxy = await getHtmlProxySource(html);
      expect(proxy).toContain('/@id/__x00__oc-vite:dev-entry');
    } finally {
      await fsp.rm(path.join(componentDir, 'index.html'), { force: true });
    }
  });

  test('editing the server entry changes subsequent responses', async () => {
    const before = await get(
      `/${COMPONENT_NAME}/${COMPONENT_VERSION}`,
      unrenderedHeaders
    );
    expect(((await before.json()) as any).data.component.props.greeting).toBe(
      'hello-dev'
    );

    await writeFixtureFile(
      'src/server.js',
      serverEntryV1.replace('hello-dev', 'reloaded')
    );

    // Vite's watcher invalidates the SSR module; poll until the new module
    // is picked up.
    const deadline = Date.now() + 15_000;
    let greeting = '';
    while (Date.now() < deadline) {
      const res = await get(
        `/${COMPONENT_NAME}/${COMPONENT_VERSION}`,
        unrenderedHeaders
      );
      greeting = ((await res.json()) as any).data.component.props.greeting;
      if (greeting === 'reloaded') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(greeting).toBe('reloaded');
  }, 30_000);
});
