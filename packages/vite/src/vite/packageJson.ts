import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * sha1 hex digest — same output as `oc-hash-builder@1.0.5` `fromString`.
 */
export function sha1(content: string | Uint8Array): string {
  return createHash('sha1').update(content).digest('hex');
}

function getUnixUtcTimestamp() {
  const d1 = new Date();
  const d2 = new Date(
    d1.getUTCFullYear(),
    d1.getUTCMonth(),
    d1.getUTCDate(),
    d1.getUTCHours(),
    d1.getUTCMinutes(),
    d1.getUTCSeconds(),
    d1.getUTCMilliseconds()
  );

  return Math.floor(d2.getTime());
}

// OC protocol version stamped into packaged components (`oc.version`).
// Matches `OC_VERSION` in @guestlinelabs/oc-registry; duplicated here so this
// package keeps zero runtime dependencies.
export const OC_VERSION = '0.50.67';
// `oc-template-esm` template version + minimum registry version, matching
// `oc-template-esm-compiler`'s `getInfo()`.
export const ESM_TEMPLATE_VERSION = '0.0.1';
export const ESM_MIN_OC_VERSION = '0.50.18';

export interface OcFiles {
  imports?: Record<string, string>;
  client?: unknown;
  data?: string;
  dataProvider?: {
    type: string;
    hashKey: string;
    src: string;
    size?: number;
    parameters?: Record<string, unknown>;
  };
  env?: string;
  static?: string | string[];
  template: {
    src: string;
    type: string;
    version?: string;
    minOcVersion?: string;
    hashKey?: string;
    size?: number;
    externals?: unknown;
    shadowDOM?: unknown;
  };
}

export interface ComponentPackage {
  name: string;
  version: string;
  oc: {
    files: OcFiles;
    parameters?: Record<string, unknown>;
    version?: string;
    packaged?: boolean;
    date?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ServerBuildInfo {
  hashKey: string;
  parameters?: Record<string, unknown>;
}

/**
 * Assemble `_package/package.json` like `oc-vite-compiler`'s
 * `createCompile.ts` (+ the CLI's size stamping), plus copy `.env` and the
 * `oc.files.static` directories, and remove the `temp/` build scratch dir
 * (upstream leaves `_viewWrapperEntry` behind when there is no data
 * provider).
 */
export async function assemblePackage(options: {
  componentPackage: ComponentPackage;
  componentPath: string;
  publishPath: string;
  templateHashKey: string;
  alias?: unknown;
  serverInfo?: ServerBuildInfo;
}): Promise<void> {
  const { componentPackage, componentPath, publishPath } = options;
  const oc = componentPackage.oc;
  const files = oc.files;

  const templateHashKey = options.templateHashKey;

  files.template = {
    type: 'oc-template-esm',
    hashKey: templateHashKey,
    src: 'template.js'
  };
  files.template.version = ESM_TEMPLATE_VERSION;
  files.template.minOcVersion = ESM_MIN_OC_VERSION;
  files.imports = options.alias as Record<string, string> | undefined;
  delete files.client;

  if (options.serverInfo) {
    const dataProvider: NonNullable<OcFiles['dataProvider']> = {
      type: 'node.js',
      hashKey: options.serverInfo.hashKey,
      src: 'server.js'
    };
    if (options.serverInfo.parameters) {
      if ('parameters' in oc) {
        console.warn(
          '\x1b[33m%s\x1b[0m',
          'Warning: parameters defined in the server file will override the parameters defined in the package.json file. Please delete the package.json file parameters to avoid this warning.'
        );
      }
      oc.parameters = options.serverInfo.parameters;
    }
    files.dataProvider = dataProvider;
    delete files.data;
  }

  oc.version = OC_VERSION;
  oc.packaged = true;
  oc.date = getUnixUtcTimestamp();

  if (!files.static) {
    files.static = [];
  }
  if (!Array.isArray(files.static)) {
    files.static = [files.static];
  }

  // Sizes, matching the CLI's `checkSizes`/`addSizes`: every top-level .js
  // except server.js counts as client; server.js counts as the data
  // provider.
  const topLevel = await fsp.readdir(publishPath);
  let clientSize = 0;
  let serverSize: number | undefined;
  for (const file of topLevel) {
    if (!file.endsWith('.js')) continue;
    const size = (await fsp.stat(path.join(publishPath, file))).size;
    if (file === 'server.js') {
      serverSize = size;
    } else {
      clientSize += size;
    }
  }
  files.template.size = clientSize;
  if (serverSize != null && files.dataProvider) {
    files.dataProvider.size = serverSize;
  }

  // Statics: copy each `oc.files.static` directory into `_package/`
  // preserving its name. Upstream minifies .js/.css when `minify` is set;
  // intentionally not done here.
  for (const directoryName of files.static) {
    const directoryPath = path.join(componentPath, directoryName);
    const stats = await fsp.lstat(directoryPath).catch(() => null);
    if (!stats) {
      throw new Error(`Static folder not found: ${directoryPath}`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`Static path is not a directory: ${directoryPath}`);
    }
    await fsp.cp(directoryPath, path.join(publishPath, directoryName), {
      recursive: true
    });
  }

  // Copy .env if available
  const env = files.env;
  if (env) {
    await fsp.copyFile(
      path.join(componentPath, env),
      path.join(publishPath, '.env')
    );
  }

  // The fork CLI appends a trailing newline (fs-extra writeJsonSync parity).
  await fsp.writeFile(
    path.join(publishPath, 'package.json'),
    JSON.stringify(componentPackage, null, 2) + '\n'
  );

  // Remove wrapper/temp scratch files so they are never published.
  await fsp
    .rm(path.join(publishPath, 'temp'), { recursive: true, force: true })
    .catch(() => {});
}
