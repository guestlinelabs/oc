import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ConfigEnv, Plugin, UserConfig } from 'vite';
import cssInjectedByJsPlugin, {
  type CssInjectedByJsState
} from './cssInjectedByJs.js';
import cssModulesPlugin from './cssModulesPlugin.js';
import { ocDevEntryPlugin, ocDevServerPlugin } from './dev.js';
import esmOCProviderTemplate from './esmOCProviderTemplate.js';
import { ocExternalsPlugin } from './externals.js';
import initialDataPlugin from './initialData.js';
import {
  assemblePackage,
  type ComponentPackage,
  type ServerBuildInfo,
  sha1
} from './packageJson.js';
import { createOcBuildState, type OcBuildState } from './pluginState.js';
import { ocReactRuntimePlugin } from './reactRuntime.js';
import { compileServer } from './serverBuild.js';
import { ocServerRuntimePlugin } from './serverRuntime.js';

export interface OcPluginOptions {
  /**
   * Force production/dev output. Defaults to `mode !== 'development'`, so
   * `vite build` produces a minified, sourcemap-less bundle and
   * `vite build --mode development` keeps sourcemaps, console forwarding
   * and unminified output.
   */
  production?: boolean;
}

function processRelativePath(componentPath: string, relativePath: string) {
  const pathStr = path.join(componentPath, relativePath);
  if (process.platform === 'win32') {
    return pathStr.split('\\').join('\\\\');
  }
  return pathStr;
}

function readOcConfig(componentPackage: ComponentPackage) {
  const oc = componentPackage.oc;
  if (!oc?.files?.template) {
    throw new Error(
      '@guestlinelabs/oc-vite: package.json is missing "oc.files.template"'
    );
  }
  if (oc.files.template.type !== 'oc-template-esm') {
    throw new Error(
      `@guestlinelabs/oc-vite: "oc.files.template.type" must be "oc-template-esm" ` +
        `(got ${JSON.stringify(oc.files.template.type ?? null)}). ` +
        'This plugin only supports ESM components.'
    );
  }
  const viewFileName = oc.files.template.src;
  if (!viewFileName || typeof viewFileName !== 'string') {
    throw new Error(
      '@guestlinelabs/oc-vite: "oc.files.template.src" must point to the view entry'
    );
  }
  return { oc, viewFileName };
}

function parseShadowDOM(
  oc: ComponentPackage['oc']
): boolean | 'open' | 'closed' | undefined {
  const shadowDOMRaw = oc.files.template.shadowDOM as
    | boolean
    | 'open'
    | 'closed'
    | undefined;
  return shadowDOMRaw === true
    ? 'open'
    : shadowDOMRaw === 'open' || shadowDOMRaw === 'closed'
      ? shadowDOMRaw
      : undefined;
}

/**
 * The `oc()` Vite plugin: turns `vite build` into an OC component package.
 *
 * On `vite build` it:
 *  1. points the client build at a generated mount wrapper
 *     (`_package/temp/_viewWrapperEntry.*`) that imports the view entry,
 *     injects CSS via `vite-plugin-css-injected-by-js` semantics, forwards
 *     the dev console, handles `shadowDOM`, and exports `mount()`;
 *  2. after the bundle is written (`writeBundle`), hashes `template.js`,
 *     optionally compiles `oc.files.data` into `server.js`, and assembles
 *     `_package/package.json` + statics + `.env` like
 *     `oc-vite-compiler`/`oc` CLI do.
 *
 * `vite dev` serves the OC preview: `GET /` renders the preview page
 * (import map + `/oc-client/client.js` + mount block), the component data
 * endpoint (`GET /{name}/{version}`, `~preview`, `POST` variants) and the
 * action endpoint (`POST /~actions/...`) answer with the registry/oc-client
 * shapes, the data provider runs through Vite's module runner (with mocked
 * plugins from `oc.json`), and the component mounts through the
 * `oc-vite:dev-entry` virtual module so client HMR works. See
 * `./dev.ts` for the port notes.
 */
function ocMainPlugin(
  state: OcBuildState,
  options: OcPluginOptions,
  cssState: CssInjectedByJsState,
  runtimeState: { componentName?: string; componentVersion?: string }
): Plugin {
  return {
    name: 'guestlinelabs-oc-vite',
    async config(config: UserConfig, env: ConfigEnv) {
      if (env.command !== 'build') {
        // `vite dev`: record what the dev-server plugins need. The actual
        // routes are registered by `ocDevServerPlugin.configureServer`;
        // the preview page mounts the component through the
        // `oc-vite:dev-entry` virtual module served by
        // `ocDevEntryPlugin`.
        const componentPath = path.resolve(config.root ?? process.cwd());
        const componentPackage = JSON.parse(
          await fsp.readFile(path.join(componentPath, 'package.json'), 'utf8')
        ) as ComponentPackage;
        const { oc, viewFileName } = readOcConfig(componentPackage);
        const shadowDOM = parseShadowDOM(oc);
        const appEntry = viewFileName.startsWith('/')
          ? viewFileName
          : `/${viewFileName}`;

        state.componentPackage = componentPackage;
        state.componentPath = componentPath;
        state.viewFileName = viewFileName;
        state.shadowDOM = shadowDOM;
        // Root-relative specifier (`/src/entry.client`) — the wrapper
        // template strips the extension and Vite resolves it like any
        // other served module, so the view entry goes through the module
        // graph and HMR.
        state.devWrapperContent = esmOCProviderTemplate({
          styleId: undefined,
          viewPath: appEntry,
          production: false,
          shadowDOM
        });
        runtimeState.componentName = componentPackage.name;
        runtimeState.componentVersion = componentPackage.version;
        return undefined;
      }

      const componentPath = path.resolve(config.root ?? process.cwd());
      const packageJsonPath = path.join(componentPath, 'package.json');
      const componentPackage = JSON.parse(
        await fsp.readFile(packageJsonPath, 'utf8')
      ) as ComponentPackage;
      const { oc, viewFileName } = readOcConfig(componentPackage);

      const publishPath = path.join(componentPath, '_package');
      const viewExtension = viewFileName.match(/\.(jsx?|tsx?)$/)?.[0] ?? '.js';
      const viewPath = processRelativePath(componentPath, viewFileName);
      const styleId = randomUUID();
      const shadowDOM = parseShadowDOM(oc);

      const production = options.production ?? env.mode !== 'development';

      state.componentPackage = componentPackage;
      state.componentName = componentPackage.name;
      state.componentVersion = componentPackage.version;
      state.componentPath = componentPath;
      state.publishPath = publishPath;
      state.viewFileName = viewFileName;
      state.viewPath = viewPath;
      state.viewExtension = viewExtension;
      state.shadowDOM = shadowDOM;
      state.styleId = styleId;
      state.production = production;
      state.wrapperPath = path.join(
        publishPath,
        'temp',
        `_viewWrapperEntry${viewExtension}`
      );
      state.alias = config.resolve?.alias;

      state.wrapperContent = esmOCProviderTemplate({
        styleId,
        viewPath,
        production,
        shadowDOM
      });
      cssState.styleId = styleId;
      cssState.injectCode = (cssCode: string) => `try {
            if (typeof document != 'undefined') {
              var elementStyle = document.createElement('style');
              elementStyle.appendChild(document.createTextNode(${cssCode}));
              if (${shadowDOM ? 'true' : 'false'}) {
                elementStyle.setAttribute('type', 'oc/css');
              }
              elementStyle.setAttribute('id', '${styleId}');
              document.head.appendChild(elementStyle);
            }
          } catch (e) {
            console.error('vite-plugin-css-injected-by-js', e);
          }`;
      runtimeState.componentName = componentPackage.name;
      runtimeState.componentVersion = componentPackage.version;

      await fsp.mkdir(path.dirname(state.wrapperPath), { recursive: true });
      await fsp.writeFile(state.wrapperPath, state.wrapperContent);

      return {
        appType: 'custom',
        // Upstream ran `vite-plugin-environment` with `['NODE_ENV']`, which
        // statically defines `process.env.NODE_ENV` (Vite itself only defines
        // `import.meta.env.*` and resolve conditions). Without this, CJS deps
        // keep runtime `process.env.NODE_ENV` checks and bundle both dev and
        // prod branches. Upstream always resolved to 'production' because the
        // compiler ran `vite.build`; we follow the `production` flag so
        // `--mode development` gets a real development build.
        define: {
          'process.env.NODE_ENV': JSON.stringify(
            production ? 'production' : 'development'
          )
        },
        experimental: {
          renderBuiltUrl(filename, { hostType }) {
            if (hostType === 'js') {
              const { name, version } = componentPackage;
              return {
                runtime: `window.oc._esm['${name}@${version}'](${JSON.stringify(
                  filename
                )})`
              };
            }
            return { relative: true };
          }
        },
        build: {
          // Upstream `viteEsmView` always emits `template.js.map`, even for
          // production builds.
          sourcemap: true,
          outDir: publishPath,
          minify: production,
          lib: {
            entry: state.wrapperPath,
            formats: ['es'],
            name: 'template',
            fileName: 'template'
          }
        }
      };
    },

    configResolved(config) {
      state.mode = config.mode;
      state.logLevel = config.logLevel;
      state.configFile = config.configFile;
    },

    // Vite empties `outDir` (`_package`) before every (re)build, which would
    // delete the wrapper written in `config`; recreate it before modules
    // are (re)loaded so `vite build --watch` keeps working.
    buildStart() {
      if (state.wrapperContent && state.wrapperPath) {
        return fsp
          .mkdir(path.dirname(state.wrapperPath), { recursive: true })
          .then(() => fsp.writeFile(state.wrapperPath, state.wrapperContent!));
      }
      return undefined;
    },

    async writeBundle(_options, bundle) {
      if (state.packaged) return;
      // Only package once the client environment emitted template.js —
      // guards against extra environments (e.g. ssr) also writing bundles.
      const templateEntry = bundle['template.js'];
      if (templateEntry?.type !== 'chunk' || !templateEntry.isEntry) {
        return;
      }
      state.packaged = true;

      const componentPackage = state.componentPackage;
      if (!componentPackage) {
        throw new Error(
          '@guestlinelabs/oc-vite: build ran without config hook'
        );
      }

      const templateHashKey = sha1(
        await fsp.readFile(path.join(state.publishPath, 'template.js'), 'utf8')
      );

      let serverInfo: ServerBuildInfo | undefined;
      if (componentPackage.oc.files.data) {
        const compiled = await compileServer(state, templateHashKey);
        serverInfo = {
          hashKey: compiled.hashKey,
          parameters: compiled.parameters
        };
      }

      await assemblePackage({
        componentPackage,
        componentPath: state.componentPath,
        publishPath: state.publishPath,
        templateHashKey,
        alias: state.alias,
        serverInfo
      });
    }
  };
}

/**
 * Vite plugin entry point. Returns the plugin list `oc(options?)` — also
 * the module's default export.
 *
 * While `OC_VITE_INTERNAL_SERVER_BUILD` is set (the plugin's own server
 * bundle build re-loads the component's vite.config), returns no plugins so
 * the server build is a plain Vite lib build plus `OcServerExternal`.
 */
export function oc(options: OcPluginOptions = {}) {
  if (process.env['OC_VITE_INTERNAL_SERVER_BUILD'] === '1') {
    return [];
  }
  const state = createOcBuildState(options);
  const cssState: CssInjectedByJsState = {};
  const runtimeState: { componentName?: string; componentVersion?: string } =
    {};
  return [
    ocMainPlugin(state, options, cssState, runtimeState),
    cssModulesPlugin(),
    ...cssInjectedByJsPlugin(cssState),
    ocServerRuntimePlugin(runtimeState),
    initialDataPlugin(),
    ocExternalsPlugin(() => state.componentPath),
    ocReactRuntimePlugin(),
    ocDevEntryPlugin(state),
    ocDevServerPlugin(state)
  ];
}

export default oc;
