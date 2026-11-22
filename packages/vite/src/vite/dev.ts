import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildClient } from '@guestlinelabs/oc-registry/dist/registry/domain/compile-client';
import { builtinTemplates } from '@guestlinelabs/oc-registry/dist/registry/domain/templates/index';
import { parseAcceptLanguage } from '@guestlinelabs/oc-registry/utils/accept-language';
import { parseEnvFile } from '@guestlinelabs/oc-registry/utils/env-file';
import type { Plugin, ViteDevServer } from 'vite';
import type { ComponentPackage } from './packageJson.js';
import type { OcBuildState } from './pluginState.js';

/**
 * `vite dev` support for the `oc()` plugin — the dev-server half of the
 * plugin, ported from `oc-server/src/vite/{plugin,server,oc,
 * get-mocked-plugins}.ts` (oc-server@4.0.5) without its esbuild / fastify /
 * @fastify/express / oc-client-browser dependencies:
 *
 *  - the component's server entry is loaded through Vite's module runner
 *    (`server.ssrLoadModule`) instead of being bundled with esbuild and
 *    evaluated in a `vm` context, so TypeScript, aliases and package
 *    `exports` behave exactly like the client build, and edits are picked
 *    up through Vite's module invalidation;
 *  - `/oc-client/client.js` is served from the vendored oc-client-browser
 *    bundled by `@guestlinelabs/oc-registry` (`buildClient`, the same code
 *    the registry uses for its own client bundle);
 *  - the preview page mounts the component through a virtual module
 *    (`oc-vite:dev-entry`) that reuses the production mount wrapper
 *    (`esmOCProviderTemplate`), so the client entry and its imports go
 *    through Vite's module graph and HMR works;
 *  - in addition to the upstream `GET /` + `POST /` routes, the component
 *    data endpoint (`GET /{name}/{version}` and `/{name}/{version}/~preview`)
 *    and the action endpoint (`POST /~actions/{action}/{name}/{version}`)
 *    answer with the same shapes the OC registry / oc-client-browser use,
 *    so `oc.getData`, `oc.getAction`, `serverClient` and nested
 *    `<oc-component>` rendering work unchanged.
 */

// ---------------------------------------------------------------------------
// Virtual mount-wrapper module
// ---------------------------------------------------------------------------

/** Bare specifier the preview page imports; resolved to a virtual module. */
export const OC_DEV_ENTRY_SPECIFIER = 'oc-vite:dev-entry';
const OC_DEV_ENTRY_ID = `\0${OC_DEV_ENTRY_SPECIFIER}`;
/**
 * Browser URL Vite assigns to the virtual module (`wrapId` convention:
 * `/@id/` + id with the null byte replaced by `__x00__`). Emitted as
 * `component.src` in the unrendered envelope so `oc-client`'s `renderEsm`
 * can `import()` it directly.
 */
export const OC_DEV_ENTRY_URL = `/@id/__x00__${OC_DEV_ENTRY_SPECIFIER}`;

/**
 * Plugin resolving/loading the dev mount-wrapper module. The wrapper is the
 * same `esmOCProviderTemplate` output used for `vite build` (with
 * `production: false`, so dev console forwarding is compiled in), preceded
 * by `window.__$$oc_*__` declarations: unlike the build (where
 * `initialDataPlugin` prepends `var` declarations to the single bundle
 * chunk), dev serves the wrapper as its own ESM module, so the globals the
 * wrapper assigns must exist on `window` for the bare assignments to work
 * in strict mode — and `serverClient`'s `getInitialData`/`getSettings` read
 * the same globals.
 */
export function ocDevEntryPlugin(state: OcBuildState): Plugin {
  return {
    name: 'guestlinelabs-oc-vite-dev-entry',
    resolveId(id) {
      if (id === OC_DEV_ENTRY_SPECIFIER || id === OC_DEV_ENTRY_ID) {
        return OC_DEV_ENTRY_ID;
      }
      return null;
    },
    load(id) {
      if (id !== OC_DEV_ENTRY_ID || !state.devWrapperContent) {
        return null;
      }
      return (
        'window.__$$oc_initialData__ = window.__$$oc_initialData__ ?? {};\n' +
        'window.__$$oc_Settings__ = window.__$$oc_Settings__ ?? {};\n' +
        state.devWrapperContent
      );
    }
  };
}

// ---------------------------------------------------------------------------
// oc.json discovery + mocked plugins (port of get-mocked-plugins.ts /
// upstream CLI's ocConfig merge)
// ---------------------------------------------------------------------------

interface MockedPlugin {
  register: (options: unknown, dependencies: unknown, next: () => void) => void;
  execute: (...args: unknown[]) => unknown;
}

export interface PluginMock {
  name: string;
  register: {
    register: (
      options: unknown,
      dependencies: unknown,
      next: () => void
    ) => void;
    execute: (...args: unknown[]) => unknown;
  };
}

export interface OcJsonConfig {
  development?: {
    importmap?: { imports?: Record<string, string> };
    plugins?: {
      dynamic?: Record<string, string>;
      static?: Record<string, string>;
    };
  };
  mocks?: {
    plugins?: {
      dynamic?: Record<string, string>;
      static?: Record<string, string>;
    };
  };
}

const isMockValid = (
  plugin: unknown
): plugin is MockedPlugin | ((...args: unknown[]) => unknown) => {
  const isFunction = typeof plugin === 'function';
  const isValidObject =
    !!plugin &&
    typeof plugin === 'object' &&
    typeof (plugin as MockedPlugin).register === 'function' &&
    typeof (plugin as MockedPlugin).execute === 'function';

  return isFunction || isValidObject;
};

const defaultRegister = (
  _options: unknown,
  _dependencies: unknown,
  next: () => void
) => {
  next();
};

// Port of upstream's findPath: walk up from `pathToResolve` looking for
// `fileName`, stopping at the process cwd realpath.
const findPath = (
  pathToResolve: string,
  fileName: string
): string | undefined => {
  const rootDir = fs.realpathSync('.');
  const fileToResolve = path.join(pathToResolve, fileName);

  if (!fs.existsSync(fileToResolve)) {
    if (pathToResolve === rootDir) {
      return undefined;
    }
    const getParent = (p: string) => p.split('/').slice(0, -1).join('/');

    const parentDir = pathToResolve ? getParent(pathToResolve) : rootDir;

    return findPath(parentDir, fileName);
  }

  return fileToResolve;
};

/**
 * Reads the `oc.json` found from `componentsDir` upwards (the same lookup
 * upstream `oc-server/vite` performs from `process.cwd()/..`, i.e. the
 * components root in an `oc dev <dir>` layout).
 */
export function getOcJson(componentsDir: string): {
  path?: string;
  config: OcJsonConfig;
} {
  const ocJsonPath = findPath(componentsDir, 'oc.json');
  if (!ocJsonPath) {
    return { config: {} };
  }
  try {
    return {
      path: ocJsonPath,
      config: JSON.parse(fs.readFileSync(ocJsonPath, 'utf8')) as OcJsonConfig
    };
  } catch {
    return { path: ocJsonPath, config: {} };
  }
}

function mergedPluginMocks(config: OcJsonConfig) {
  // Same merge as the upstream CLI's `parseConfig`: `development.plugins`
  // wins over the deprecated `mocks.plugins` block.
  return {
    ...(config.mocks?.plugins ?? {}),
    ...(config.development?.plugins ?? {})
  };
}

async function loadMockedPlugins(ocJson: {
  path?: string;
  config: OcJsonConfig;
}): Promise<PluginMock[]> {
  if (!ocJson.path) {
    return [];
  }

  const ocJsonLocation = ocJson.path.slice(0, -'oc.json'.length);
  const mocks = mergedPluginMocks(ocJson.config);
  const plugins: PluginMock[] = [];

  for (const [pluginName, mockedValue] of Object.entries(mocks.static ?? {})) {
    plugins.push({
      name: pluginName,
      register: {
        register: defaultRegister,
        execute: () => mockedValue
      }
    });
  }

  for (const [pluginName, source] of Object.entries(mocks.dynamic ?? {})) {
    let pluginMock: unknown;
    try {
      const imported = (await import(
        pathToFileURL(path.resolve(ocJsonLocation, source)).href
      )) as Record<string, unknown>;
      // CJS mocks surface as `default`; ESM mocks as the namespace itself.
      pluginMock = imported['default'] ?? imported;
    } catch {
      continue;
    }

    if (!isMockValid(pluginMock)) {
      continue;
    }

    const register = (pluginMock as MockedPlugin).register || defaultRegister;
    const execute =
      typeof pluginMock === 'function'
        ? (pluginMock as (...args: unknown[]) => unknown)
        : ((pluginMock as MockedPlugin).execute ?? pluginMock);

    plugins.push({
      name: pluginName,
      register: { execute, register }
    });
  }

  return plugins;
}

/**
 * Port of upstream `getMockedPlugins(componentsDir)`: finds `oc.json`
 * walking up from `componentsDir` and returns the mocked plugins declared
 * in `mocks.plugins` / `development.plugins`.
 */
export async function getMockedPlugins(
  componentsDir: string
): Promise<PluginMock[]> {
  return loadMockedPlugins(getOcJson(componentsDir));
}

// ---------------------------------------------------------------------------
// Parameters / context (port of oc.ts getDefaultParams / getContext,
// registry-flavoured)
// ---------------------------------------------------------------------------

interface OcParameter {
  mandatory?: boolean;
  example?: unknown;
  [key: string]: unknown;
}

export function getDefaultParams(
  parameters: Record<string, OcParameter> | undefined
): Record<string, unknown> {
  if (!parameters) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(parameters)
      .filter(([, param]) => !!param?.mandatory && 'example' in param)
      .map(([paramName, param]) => [paramName, param.example])
  );
}

type DataProviderFn = (
  context: Record<string, unknown>,
  callback: (error: unknown, data?: unknown, meta?: unknown) => void
) => unknown;

interface ProviderResult {
  data: unknown;
  meta: unknown;
  responseHeaders: Record<string, string>;
  cookies: Array<{ name: string; value: unknown; options?: unknown }>;
}

const STREAM_SYMBOL = Symbol('oc-dev-stream');
const EMPTY_RESPONSE = { __oc_emptyResponse: true };

const templatesInfo = builtinTemplates.map((template) => template.getInfo());

function serializeCookie(
  name: string,
  value: unknown,
  options?: Record<string, unknown>
): string {
  const opts = options ?? {};
  let cookie = `${name}=${encodeURIComponent(String(value))}`;
  cookie += `; Path=${(opts['path'] as string) ?? '/'}`;
  if (opts['maxAge'] != null) {
    cookie += `; Max-Age=${Math.floor(Number(opts['maxAge']) / 1000)}`;
  }
  if (opts['expires'] instanceof Date) {
    cookie += `; Expires=${(opts['expires'] as Date).toUTCString()}`;
  }
  if (opts['domain']) cookie += `; Domain=${opts['domain']}`;
  if (opts['httpOnly']) cookie += '; HttpOnly';
  if (opts['secure']) cookie += '; Secure';
  if (opts['sameSite']) cookie += `; SameSite=${opts['sameSite']}`;
  if (opts['priority']) cookie += `; Priority=${opts['priority']}`;
  return cookie;
}

/**
 * Runs the component's data provider with a context shaped like the one the
 * registry passes to `server.js` (`get-component.ts`): params, plugins,
 * env, staticPath, baseUrl, requestHeaders, requestIp, acceptLanguage,
 * setHeader, setCookie, setEmptyResponse, templates and streamSymbol.
 * Callback-style providers are supported, plus promise-style ones (first
 * settlement wins, like the registry's `callDataProvider`).
 */
function invokeDataProvider(
  dataProvider: DataProviderFn,
  options: {
    req: IncomingMessage;
    params: Record<string, unknown>;
    action?: string;
    env: Record<string, string>;
    plugins: PluginMock[];
  }
): Promise<ProviderResult> {
  const { req, params, action, env, plugins } = options;
  const responseHeaders: Record<string, string> = {};
  const cookies: ProviderResult['cookies'] = [];

  return new Promise<ProviderResult>((resolve, reject) => {
    let settled = false;
    const settle = (error: unknown, data?: unknown, meta?: unknown): void => {
      if (settled) return;
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve({ data, meta, responseHeaders, cookies });
      }
    };

    const context = {
      action,
      acceptLanguage: parseAcceptLanguage(
        req.headers['accept-language'] as string | undefined
      ),
      baseUrl: '/',
      // Upstream oc-server also exposed `easeUrl`; kept for compatibility.
      easeUrl: '/',
      env: { name: 'local', ...env },
      params,
      plugins: Object.fromEntries(
        plugins.map((plugin) => [plugin.name, plugin.register.execute])
      ),
      renderComponent: () => {
        throw new Error(
          'renderComponent is not implemented in the server context'
        );
      },
      renderComponents: () => {
        throw new Error(
          'renderComponents is not implemented in the server context'
        );
      },
      requestHeaders: req.headers as Record<string, string>,
      requestIp: req.socket?.remoteAddress ?? '',
      // Mirrors the registry's empty-response handler: settles the request
      // with the `__oc_emptyResponse` marker regardless of the provider's
      // own callback.
      setEmptyResponse: () => settle(null, { ...EMPTY_RESPONSE }),
      staticPath: '/',
      setHeader: (header: string, value: string) => {
        if (!(typeof header === 'string' && typeof value === 'string')) {
          throw new Error('context.setHeader parameters must be strings');
        }
        if (header && value) {
          responseHeaders[header.toLowerCase()] = value;
        }
      },
      setCookie: (name: string, value: unknown, cookieOptions?: unknown) => {
        if (typeof name !== 'string') {
          throw new Error('context.setCookie parameters must be strings');
        }
        cookies.push({ name, value, options: cookieOptions });
      },
      templates: templatesInfo,
      streamSymbol: STREAM_SYMBOL
    };

    try {
      const result = dataProvider(context, (error, data, meta) =>
        settle(error, data, meta)
      );
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then(
          (value) => settle(null, value),
          (error) => settle(error)
        );
      }
    } catch (error) {
      settle(error);
    }
  });
}

// ---------------------------------------------------------------------------
// Envelope (port of serverWrapper.ts semantics for dev)
// ---------------------------------------------------------------------------

function buildEnvelopeData(
  model: unknown,
  meta: unknown,
  options: {
    action?: string;
    componentName: string;
    componentVersion: string;
  }
): Record<string, unknown> {
  if (model == null) {
    return { ...EMPTY_RESPONSE };
  }

  const props = options.action
    ? model
    : Object.assign({}, model, {
        _staticPath: '/',
        _baseUrl: '/',
        _componentName: options.componentName,
        _componentVersion: options.componentVersion
      });

  return {
    component: {
      key: '',
      src: OC_DEV_ENTRY_URL,
      props,
      esm: true,
      development: meta
    }
  };
}

// ---------------------------------------------------------------------------
// HTML templates (port of plugin.ts getBaseTemplate/getHtmlTemplate +
// oc-template-esm-compiler hmr.ts appBlock)
// ---------------------------------------------------------------------------

function jsonForScript(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function getAppBlock(name: string, version: string): string {
  // Port of `oc-template-esm-compiler/src/lib/hmr.ts` `appBlock`, adapted to
  // mount through the dev wrapper module (`oc-vite:dev-entry`) so props get
  // the `_staticPath`/`_baseUrl`/`_componentName`/`_componentVersion`
  // treatment and `ctx.development` console forwarding of the production
  // wrapper, while `__INITIAL_DATA__`/`__INITIAL_DEVELOPMENT__` are replaced
  // per request.
  return `
<div id="root"></div>
<script type="module">
  window.oc = window.oc || {};
  window.oc.cmd = window.oc.cmd || [];

  import { mount } from '${OC_DEV_ENTRY_SPECIFIER}';

  const container = document.getElementById('root');
  mount(container, __INITIAL_DATA__, { development: __INITIAL_DEVELOPMENT__ });

  window.oc.cmd.push(() => {
    window.oc.events.fire('oc:rendered', { baseUrl: '/', id: 'root', name: '${name}', staticPath: '/', version: '${version}', element: container });
  });
</script>
`;
}

function getBaseTemplate(
  appBlock: string,
  imports: Record<string, string>
): string {
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta name="robots" content="index, follow" />
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
    }
    </style>
    ${
      imports && Object.keys(imports).length
        ? `<script type="importmap">{"imports": ${JSON.stringify(
            imports
          )}}</script>`
        : ''
    }
  </head>
  <body>
    <script src="/oc-client/client.js"></script>
    ${appBlock}
  </body>
</html>
  `;
}

function getHtmlTemplate(
  appBlock: string,
  imports: Record<string, string>,
  componentPath: string
): string {
  const filePath = path.join(componentPath, 'index.html');
  let htmlTemplate: string;
  try {
    htmlTemplate = fs.readFileSync(filePath, 'utf-8');
    if (!htmlTemplate.includes('</body>')) {
      throw new Error(
        'If you use a custom html entry it has to have a closing body tag'
      );
    }
    htmlTemplate = htmlTemplate.replace(
      '</body>',
      `<script>
        if (!window.oc?.status) {
          const script = document.createElement('script');
          script.src = '/oc-client/client.js';
          document.body.appendChild(script);
        }
      </script>
      ${appBlock}</body>`
    );
  } catch {
    htmlTemplate = getBaseTemplate(appBlock, imports);
  }

  return htmlTemplate;
}

// ---------------------------------------------------------------------------
// Dev server plugin
// ---------------------------------------------------------------------------

interface LoadedProvider {
  dataProvider: DataProviderFn;
  parametersSchema?: Record<string, OcParameter>;
}

/**
 * `configureServer` implementation — registers the OC dev routes on the
 * Vite dev server. Port of `oc-server/src/vite/plugin.ts`
 * `configureServer` plus the component data/action endpoints the registry
 * exposes (`GET /{name}/{version}`, `~preview`, `POST ~actions/...`).
 */
export function ocDevServerPlugin(state: OcBuildState): Plugin {
  return {
    name: 'guestlinelabs-oc-vite-dev-server',
    async configureServer(server: ViteDevServer) {
      const componentPackage = state.componentPackage as
        | ComponentPackage
        | undefined;
      if (!componentPackage) {
        throw new Error(
          '@guestlinelabs/oc-vite: dev server started without config hook'
        );
      }
      const componentPath = state.componentPath;
      const name = componentPackage.name;
      const version = componentPackage.version;
      const oc = componentPackage.oc;
      const serverEntry = oc.files.data;

      // The vendored oc-client bundle is compiled with `Bun.build` (via the
      // registry's `buildClient`), so the dev server requires the Bun
      // runtime — `bunx vite` may fall back to Node for the vite bin.
      if (typeof Bun === 'undefined') {
        throw new Error(
          '@guestlinelabs/oc-vite: `vite dev` requires the Bun runtime ' +
            '(the oc-client bundle is compiled with Bun.build). ' +
            'Run vite through Bun, e.g. `bunx --bun vite` or `bun vite`.'
        );
      }

      // oc-client dev bundle, compiled once from the vendored sources by the
      // registry package (replaces `oc-client-browser.compileSync()`).
      const clientJs = (await buildClient({})).dev;

      // Component .env (oc.files.env), like the registry's env lookup.
      let env: Record<string, string> = {};
      if (oc.files.env) {
        try {
          env = parseEnvFile(
            fs.readFileSync(path.join(componentPath, oc.files.env), 'utf-8')
          );
        } catch {
          env = {};
        }
      }

      // Mocked plugins from oc.json. Upstream `oc-server/vite` searches from
      // `process.cwd()/..` (the components root in an `oc dev <dir>` layout).
      // The un-normalised `..` makes findPath check the components root
      // first and then the component dir itself, so a component-local
      // oc.json is discovered as well.
      const plugins = await getMockedPlugins(path.join(componentPath, '..'));
      for (const plugin of plugins) {
        try {
          plugin.register.register(null, null, () => {});
        } catch {
          // A failing register() must not prevent the dev server from
          // starting; the mock simply won't be usable.
        }
      }

      // Data provider, loaded through Vite's module runner on every request
      // so edits to server files are picked up via module invalidation.
      // Upstream bundled with esbuild + ran the bundle in a `vm` context.
      const loadProvider = async (): Promise<LoadedProvider> => {
        if (!serverEntry) {
          return {
            dataProvider: ((context: { params?: unknown }) =>
              Promise.resolve({
                ...(context.params as object)
              })) as DataProviderFn
          };
        }

        const entryUrl = serverEntry.startsWith('/')
          ? serverEntry
          : `/${serverEntry.replace(/^\.\//, '')}`;
        const mod = (await server.ssrLoadModule(entryUrl)) as Record<
          string,
          unknown
        >;
        const modDefault = mod['default'];
        const defaultExport =
          modDefault && typeof modDefault === 'object'
            ? (modDefault as Record<string, unknown>)
            : undefined;

        interface ServerLike {
          getData?: () => DataProviderFn;
          _parameters?: Record<string, OcParameter>;
        }
        const serverExport = [
          mod['server'],
          defaultExport?.['server'],
          modDefault
        ].find(
          (candidate): candidate is ServerLike =>
            !!candidate &&
            typeof (candidate as ServerLike).getData === 'function'
        );
        const dataExport = [
          mod['data'],
          defaultExport?.['data'],
          typeof modDefault === 'function' ? modDefault : undefined
        ].find((candidate) => typeof candidate === 'function') as
          | DataProviderFn
          | undefined;

        // Same precedence as the packaged server.js wrapper: `server` wins
        // over a raw `data` export.
        const dataProvider = serverExport
          ? serverExport.getData!()
          : dataExport;
        if (typeof dataProvider !== 'function') {
          throw new Error(
            `@guestlinelabs/oc-vite: no data provider found in ${serverEntry} ` +
              '(expected a `server` export with getData() or a `data` export)'
          );
        }

        return {
          dataProvider,
          parametersSchema: serverExport?._parameters
        };
      };

      // Prime the provider once so a broken server entry surfaces early —
      // but don't keep the dev server from starting; requests retry.
      try {
        await loadProvider();
      } catch (error) {
        server.config.logger.warn(
          `@guestlinelabs/oc-vite: failed to load the data provider ` +
            `(${serverEntry}): ${(error as Error)?.message ?? error}`
        );
      }

      const defaultParams = (parametersSchema?: Record<string, OcParameter>) =>
        getDefaultParams(
          (oc.parameters as Record<string, OcParameter> | undefined) ??
            parametersSchema
        );

      const runProvider = async (options: {
        req: IncomingMessage;
        params: Record<string, unknown>;
        action?: string;
        provider?: LoadedProvider;
      }): Promise<ProviderResult> => {
        const loaded = options.provider ?? (await loadProvider());
        return invokeDataProvider(loaded.dataProvider, {
          req: options.req,
          params: options.params,
          action: options.action,
          env,
          plugins
        });
      };

      const applyResultHeaders = (
        res: ServerResponse,
        result: ProviderResult
      ) => {
        for (const [key, value] of Object.entries(result.responseHeaders)) {
          res.setHeader(key, value);
        }
        if (result.cookies.length) {
          res.setHeader(
            'Set-Cookie',
            result.cookies.map((cookie) =>
              serializeCookie(
                cookie.name,
                cookie.value,
                cookie.options as Record<string, unknown> | undefined
              )
            )
          );
        }
      };

      const sendJson = (res: ServerResponse, status: number, body: unknown) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      };

      const sendError = (res: ServerResponse, error: unknown) => {
        if (error instanceof Error) {
          server.ssrFixStacktrace(error);
        }
        const err = error as {
          status?: number;
          statusCode?: number;
          message?: string;
        };
        const status = Number(err?.status ?? err?.statusCode) || 500;
        sendJson(res, status, {
          error: err?.message ?? String(error),
          details: {
            message: err?.message ?? String(error),
            stack: error instanceof Error ? error.stack : undefined
          }
        });
      };

      // Import map: upstream injected the raw `resolve.alias` entries from
      // the user's vite config; the resolved dev-server config carries the
      // same information normalised to `{find, replacement}` pairs.
      const importMap: Record<string, string> = {};
      const alias = server.config.resolve.alias;
      if (Array.isArray(alias)) {
        for (const entry of alias) {
          if (typeof entry.find === 'string') {
            importMap[entry.find] = entry.replacement;
          }
        }
      } else if (alias && typeof alias === 'object') {
        Object.assign(importMap, alias);
      }

      const appBlock = getAppBlock(name, version);

      const parseRequest = (req: IncomingMessage) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        return {
          pathname: url.pathname,
          query: Object.fromEntries(url.searchParams.entries()) as Record<
            string,
            string
          >,
          search: url.search
        };
      };

      const readBody = (req: IncomingMessage): Promise<string> =>
        new Promise((resolve, reject) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk.toString();
          });
          req.on('end', () => resolve(body));
          req.on('error', reject);
        });

      const parseJsonBody = async (
        req: IncomingMessage
      ): Promise<Record<string, unknown>> => {
        const rawBody = await readBody(req);
        if (!rawBody) {
          return {};
        }
        const parsed = JSON.parse(rawBody) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
        return {};
      };

      const renderPreviewPage = async (
        req: IncomingMessage,
        res: ServerResponse,
        params: Record<string, unknown>,
        provider?: LoadedProvider
      ) => {
        const result = await runProvider({ req, params, provider });
        const model = result.data;
        // Page props get the same `_`-prefixed injections the packaged
        // server.js wrapper adds for non-action calls; the mount wrapper
        // strips them again before handing props to the component.
        const props =
          model == null
            ? {}
            : Object.assign({}, model, {
                _staticPath: '/',
                _baseUrl: '/',
                _componentName: name,
                _componentVersion: version
              });

        let htmlTemplate = getHtmlTemplate(appBlock, importMap, componentPath);
        htmlTemplate = htmlTemplate
          .replace('__INITIAL_DATA__', jsonForScript(props))
          .replace('__INITIAL_DEVELOPMENT__', jsonForScript(result.meta));

        const transformedHtml = await server.transformIndexHtml(
          req.url ?? '/',
          htmlTemplate
        );

        applyResultHeaders(res, result);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end(transformedHtml);
      };

      const unrenderedResponse = (
        result: ProviderResult,
        options: { requestVersion: string; search: string }
      ) => ({
        baseUrl: '/',
        type: 'oc-component',
        version,
        requestVersion: options.requestVersion,
        name,
        renderMode: 'unrendered',
        href: `/${name}/${options.requestVersion || version}${options.search}`,
        data: buildEnvelopeData(result.data, result.meta, {
          componentName: name,
          componentVersion: version
        }),
        template: {
          src: OC_DEV_ENTRY_URL,
          type: 'oc-template-esm',
          key: ''
        }
      });

      // Routes mirror the upstream dev server plus the registry component
      // endpoints the oc-client needs:
      //   GET  /oc-client/client.js
      //   POST /                         batch {components:[...]} (upstream)
      //   POST /~actions/:action/:name(/:version)   action endpoint
      //   GET  /:name(/:version)                   data endpoint / preview
      //   GET  /:name(/:version)/~preview          preview page
      //   POST /:name(/:version)                   data endpoint (body params)
      //   GET  /                                  preview page (upstream)
      server.middlewares.use('/oc-client/client.js', (_req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/javascript');
        res.end(clientJs);
      });

      server.middlewares.use(async (req, res, next) => {
        const { pathname, query, search } = parseRequest(req);

        // POST / — upstream batch shape: {components: [{action, parameters}]}
        if (req.method === 'POST' && pathname === '/') {
          try {
            const body = (await parseJsonBody(req)) as {
              components?: Array<{
                action?: string;
                parameters?: Record<string, unknown>;
              }>;
            };
            const components = Array.isArray(body.components)
              ? body.components
              : [];
            const response = await Promise.all(
              components.map(async (component) => {
                try {
                  const result = await runProvider({
                    req,
                    params: component.parameters ?? {},
                    action: component.action
                  });
                  return {
                    status: 200,
                    response: {
                      data: {
                        component: {
                          props: result.data
                        }
                      }
                    }
                  };
                } catch (error) {
                  const err = error as {
                    status?: number;
                    statusCode?: number;
                    message?: string;
                  };
                  return {
                    status: Number(err?.status ?? err?.statusCode) || 500,
                    response: {
                      code: 'GENERIC_ERROR',
                      error: err?.message ?? String(error)
                    }
                  };
                }
              })
            );

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(response));
          } catch (error) {
            if (error instanceof Error) {
              server.ssrFixStacktrace(error);
            }
            res.statusCode = 500;
            res.end(
              JSON.stringify({ error: (error as Error)?.message ?? error })
            );
          }
          return;
        }

        // POST /~actions/:action/:name(/:version) — registry action route.
        // oc-client's `getAction`/`serverClient` POSTs the raw parameters
        // object here and reads `data.component.props` from the response.
        const actionMatch = pathname.match(
          /^\/~actions\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/
        );
        if (req.method === 'POST' && actionMatch) {
          const [, action, componentName] = actionMatch;
          if (decodeURIComponent(componentName) !== name) {
            return next();
          }
          try {
            const params = await parseJsonBody(req);
            const result = await runProvider({
              req,
              params,
              action: decodeURIComponent(action)
            });
            applyResultHeaders(res, result);
            sendJson(res, 200, {
              baseUrl: '/',
              name,
              version,
              renderMode: 'unrendered',
              data: buildEnvelopeData(result.data, result.meta, {
                action: decodeURIComponent(action),
                componentName: name,
                componentVersion: version
              })
            });
          } catch (error) {
            sendError(res, error);
          }
          return;
        }

        // GET/POST /:name, /:name/:version, /:name(/:version)/~preview
        const segments = pathname.split('/').filter(Boolean);
        const isPreview = segments[segments.length - 1] === '~preview';
        const nameMatches =
          segments.length >= 1 &&
          decodeURIComponent(segments[0]) === name &&
          (segments.length === 1 ||
            (segments.length === 2 &&
              (isPreview || segments[1] !== '~preview')) ||
            (segments.length === 3 && isPreview && segments[1] !== '~preview'));

        if (
          nameMatches &&
          (req.method === 'GET' || (req.method === 'POST' && !isPreview))
        ) {
          const requestedVersion =
            segments.length >= 2 && segments[1] !== '~preview'
              ? segments[1]
              : '';

          try {
            if (req.method === 'POST') {
              // Component POST: parameters come from query + JSON body.
              const bodyParams = await parseJsonBody(req);
              const params = { ...query, ...bodyParams };
              const result = await runProvider({ req, params });
              applyResultHeaders(res, result);
              sendJson(
                res,
                200,
                unrenderedResponse(result, {
                  requestVersion: requestedVersion,
                  search
                })
              );
              return;
            }

            // GET: `~preview` and browser-ish requests get the preview
            // page; `Accept: application/vnd.oc.*+json` gets the
            // unrendered envelope oc-client consumes.
            const accept = String(req.headers.accept ?? '');
            const renderMode = query['renderMode'];
            const wantsJson =
              !isPreview &&
              renderMode !== 'rendered' &&
              accept.includes('application/vnd.oc');

            const loaded = await loadProvider();
            const params = {
              ...defaultParams(loaded.parametersSchema),
              ...query
            };

            if (wantsJson) {
              const result = await runProvider({
                req,
                params,
                provider: loaded
              });
              applyResultHeaders(res, result);
              sendJson(
                res,
                200,
                unrenderedResponse(result, {
                  requestVersion: requestedVersion,
                  search
                })
              );
            } else {
              await renderPreviewPage(req, res, params, loaded);
            }
          } catch (error) {
            sendError(res, error);
          }
          return;
        }

        next();
      });

      // GET / — upstream preview page.
      server.middlewares.use(async (req, res, next) => {
        if (req.method === 'GET' && parseRequest(req).pathname === '/') {
          try {
            const loaded = await loadProvider();
            await renderPreviewPage(
              req,
              res,
              defaultParams(loaded.parametersSchema),
              loaded
            );
          } catch (error) {
            if (error instanceof Error) {
              server.ssrFixStacktrace(error);
            }
            next(error);
          }
        } else {
          next();
        }
      });
    }
  };
}
