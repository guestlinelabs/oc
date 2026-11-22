import fsp from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import type { PluginOption } from 'vite';

import { loadComponentVite } from './componentVite.js';

import { sha1 } from './packageJson.js';
import type { OcBuildState } from './pluginState.js';
import serverWrapper from './serverWrapper.js';

// Same filter as upstream `oc-vite-compiler/src/lib/viteServer.ts`.
const coreModules = builtinModules
  .filter((x) => !/^_|^(internal|v8|node-inspect)\/|\//.test(x) && x !== 'sys')
  .sort();

const nodeModuleMatcher = /^[a-z@][a-z\-/0-9.]+$/i;
const moduleWithPathMatcher = /^(?!@).*\//g;

export interface ServerCompileResult {
  type: 'node.js';
  hashKey: string;
  src: string;
  parameters?: Record<string, unknown>;
}

/**
 * Compile the component's `oc.files.data` entry into `_package/server.js`
 * (CJS). Port of `oc-vite-compiler/src/lib/viteServer.ts`, adapted to run a
 * second Vite `build()` inside the plugin's writeBundle:
 *
 * - the component's own `vite.config.*` is reused via `configFile`, so its
 *   plugins/aliases apply to the server build too (upstream relied on
 *   Vite's default config discovery; passing the resolved path is
 *   equivalent and also honors `--config`);
 * - `oc()` returns no plugins while `OC_VITE_INTERNAL_SERVER_BUILD` is set,
 *   so the config file can be loaded without recursing (upstream
 *   `isOcServerBuild`).
 *
 * The entry is wrapped by `serverWrapper` into a `data(context, cb)`
 * provider that returns `{ component: { key, src, props, esm, development } }`.
 */
export async function compileServer(
  state: OcBuildState,
  templateHashKey: string
): Promise<ServerCompileResult> {
  const { componentPackage, componentPath, publishPath, production } = state;
  if (!componentPackage) {
    throw new Error('@guestlinelabs/oc-vite: missing component package.json');
  }

  const serverFileName = componentPackage.oc.files.data;
  if (!serverFileName || typeof serverFileName !== 'string') {
    throw new Error(
      '@guestlinelabs/oc-vite: "oc.files.data" must point to the data provider entry'
    );
  }

  let serverPath = path.join(componentPath, serverFileName);
  if (process.platform === 'win32') {
    serverPath = serverPath.split('\\').join('\\\\');
  }

  const dependencies =
    (componentPackage as { dependencies?: Record<string, string> })
      .dependencies ?? {};
  const externals = [...Object.keys(dependencies), ...coreModules];

  const wrapperContent = serverWrapper({
    serverPath,
    componentName: componentPackage.name,
    componentVersion: componentPackage.version,
    bundleHashKey: templateHashKey,
    production,
    esm: componentPackage.oc.files.template.type === 'oc-template-esm'
  });

  const tempFolder = path.join(publishPath, 'temp');
  const higherOrderServerPath = path.join(
    tempFolder,
    '__oc_higherOrderServer.ts'
  );

  // Set after config merging: vite would merge it with a vite.config.ts
  // `external` array, and rolldown rejects functions inside arrays.
  const external = (id: string) => {
    // Always bundled into server.js: the registry sandbox cannot resolve
    // this package's internals at runtime.
    if (
      id === 'oc-server' ||
      id === '@guestlinelabs/oc-vite' ||
      id.startsWith('@guestlinelabs/oc-vite/')
    ) {
      return false;
    }
    if (nodeModuleMatcher.test(id)) {
      let externalId = id;
      if (moduleWithPathMatcher.test(externalId)) {
        externalId = externalId.split('/')[0];
      }
      if (!externals.includes(externalId)) {
        throw new Error(
          `Missing dependencies from package.json => ${externalId}`
        );
      }
      return true;
    }
    return false;
  };
  const serverExternal: PluginOption = {
    name: 'OcServerExternal',
    enforce: 'post',
    options(inputOptions) {
      inputOptions.external = external;
    }
  };

  try {
    await fsp.mkdir(tempFolder, { recursive: true });
    await fsp.writeFile(higherOrderServerPath, wrapperContent);

    process.env['OC_VITE_INTERNAL_SERVER_BUILD'] = '1';
    let bundle: string;
    try {
      const { build } = await loadComponentVite(componentPath);
      const result = await build({
        appType: 'custom',
        root: componentPath,
        configFile: state.configFile,
        mode: production ? 'production' : 'development',
        plugins: [serverExternal],
        logLevel: state.logLevel,
        build: {
          sourcemap: production ? false : 'inline',
          // Ensure sourcemap sources are computed relative to the component
          // root instead of Vite's default outDir.
          outDir: componentPath,
          lib: { entry: higherOrderServerPath, formats: ['cjs'] },
          write: false,
          minify: production
        }
      });
      const out = Array.isArray(result) ? result[0] : result;
      const outputs = (
        out as {
          output?: { type: string; code?: string; fileName?: string }[];
        }
      ).output;
      // CJS lib output is emitted as `*.cjs` (or `*.js` depending on the
      // component's package type); take the first JS chunk like upstream's
      // `output[0]`.
      const chunk = outputs?.find(
        (o) => o.type === 'chunk' && /\.[cm]?js$/.test(o.fileName ?? '')
      );
      if (!chunk?.code) {
        throw new Error('Server bundle produced no JS output');
      }
      bundle = chunk.code;
    } finally {
      delete process.env['OC_VITE_INTERNAL_SERVER_BUILD'];
    }

    await fsp.mkdir(publishPath, { recursive: true });
    await fsp.writeFile(path.join(publishPath, 'server.js'), bundle);
    // `.cjs` copy is required when the packaged package.json keeps
    // `"type": "module"` (a `.js` file would be ESM there).
    const serverCjsPath = path.join(publishPath, 'server.cjs');
    await fsp.writeFile(serverCjsPath, bundle);

    // Extract `server._parameters` like upstream: require the CJS bundle and
    // read the data provider's declared parameters.
    let parameters: Record<string, unknown> | undefined;
    try {
      const require = createRequire(import.meta.url);
      const { server } = require(serverCjsPath) as {
        server?: { _parameters?: Record<string, unknown> };
      };
      if (server?._parameters && Object.keys(server._parameters).length > 0) {
        if ('parameters' in componentPackage.oc) {
          console.warn(
            '\x1b[33m%s\x1b[0m',
            'Warning: parameters defined in the server file will override the parameters defined in the package.json file. Please delete the package.json file parameters to avoid this warning.'
          );
        }
        parameters = server._parameters;
      }
    } catch {
      // Upstream swallows require failures (e.g. missing runtime deps).
    } finally {
      await fsp.rm(serverCjsPath, { force: true }).catch(() => {});
    }

    return {
      type: 'node.js',
      hashKey: sha1(bundle),
      src: 'server.js',
      parameters
    };
  } finally {
    await fsp.rm(tempFolder, { recursive: true, force: true }).catch(() => {});
  }
}
