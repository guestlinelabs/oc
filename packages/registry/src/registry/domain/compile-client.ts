import { readFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { Config, Template } from '../../types';
import registerTemplates from './register-templates';
import { builtinTemplates } from './templates';

/**
 * Startup-time replacement for `oc-client-browser`'s `compileSync`.
 *
 * Upstream bundled `src/vendor/oc-client-browser/src/index.js` with esbuild
 * and minified the result with uglify-js (see the vendored
 * `tasks/compile.js` for the reference implementation). This module performs
 * the same compilation with `Bun.build`, which is asynchronous, so it runs
 * when the registry starts instead of synchronously while sanitising
 * options.
 */

const clientDir = path.join(
  __dirname,
  '..',
  '..',
  'vendor',
  'oc-client-browser'
);
const clientEntryPoint = path.join(clientDir, 'src', 'index.js');

const clientPackage = JSON.parse(
  readFileSync(path.join(clientDir, 'package.json'), 'utf8')
) as { version: string };

const clientVersion = clientPackage.version;
const licenseLink =
  'https://github.com/opencomponents/oc-client-browser/tree/master/LICENSES';
const licenseBanner = `/*! OpenComponents client v${clientVersion} | (c) 2015-${new Date().getFullYear()} OpenComponents community | ${licenseLink} */`;

export interface External {
  global?: string | string[];
  url: string;
}

interface ExtendedExternal extends External {
  name?: string;
  devUrl?: string;
}

interface TemplateInfoLike {
  externals: ExtendedExternal[];
  type: string;
  version: string;
}

/** Mirrors `CompileOptions` from oc-client-browser's index.d.ts (minus `templates`). */
export interface ClientCompileOptions {
  externals?: External[];
  imports?: Record<string, string>;
  retryInterval?: number;
  retryLimit?: number;
  disableLoader?: boolean;
  disableLegacyTemplates?: boolean;
}

export type CompileClientConfig = Config & {
  compileClient?: boolean | ClientCompileOptions;
};

interface ParsedConf {
  externals: External[];
  imports: Record<string, string>;
  retryLimit: number;
  retryInterval: number;
  disableLegacyTemplates: boolean;
  disableLoader: boolean;
  templates: Record<string, { externals: External[] }>;
}

function transformTemplates(
  templates: Template[] | Record<string, { externals: External[] }> = {}
): Record<string, { externals: External[] }> {
  if (Array.isArray(templates)) {
    const templatesObj: Record<string, { externals: External[] }> = {};
    for (const template of templates) {
      if (typeof template.getInfo !== 'function') {
        throw new Error(
          `Template ${
            (template as { type?: string }).type || 'unknown'
          } does not have a getInfo function`
        );
      }
      const { externals, type } = template.getInfo() as TemplateInfoLike;
      templatesObj[type] = { externals };
    }
    return templatesObj;
  }

  return templates;
}

// Unlike upstream, which hardcoded the legacy handlebars/jade templates plus
// oc-template-es6, the registry's built-in templates are the five current
// template engines under ./templates. All of them are always registered in
// the client bundle; `disableLegacyTemplates` only toggles the dead
// legacy-template code paths inside oc-client.js itself.
const baseTemplates: Record<string, { externals: External[] }> =
  Object.fromEntries(
    builtinTemplates.map((template) => {
      const info = template.getInfo() as TemplateInfoLike;
      return [info.type, { externals: info.externals }];
    })
  );

function parseConf(
  conf: ClientCompileOptions & { templates?: unknown }
): ParsedConf {
  const disableLegacyTemplates = Boolean(conf.disableLegacyTemplates ?? false);
  const transformedTemplates = transformTemplates(
    conf.templates as Template[] | Record<string, { externals: External[] }>
  );

  return {
    externals: conf.externals || [],
    imports: conf.imports || {},
    retryLimit: conf.retryLimit || 30,
    retryInterval: conf.retryInterval || 5000,
    disableLegacyTemplates,
    disableLoader: Boolean(conf.disableLoader ?? false),
    templates: { ...baseTemplates, ...transformedTemplates }
  };
}

function buildDefines(parsedConf: ParsedConf): Record<string, string> {
  return {
    __REGISTERED_TEMPLATES_PLACEHOLDER__: JSON.stringify(parsedConf.templates),
    __EXTERNALS__: JSON.stringify(parsedConf.externals),
    __IMPORTS__: JSON.stringify(parsedConf.imports),
    __DEFAULT_RETRY_LIMIT__: JSON.stringify(parsedConf.retryLimit),
    __DEFAULT_RETRY_INTERVAL__: JSON.stringify(parsedConf.retryInterval),
    __DEFAULT_DISABLE_LOADER__: JSON.stringify(parsedConf.disableLoader),
    __DISABLE_LEGACY_TEMPLATES__: JSON.stringify(
      parsedConf.disableLegacyTemplates
    ),
    __CLIENT_VERSION__: JSON.stringify(clientVersion)
  };
}

type BuildResult = Awaited<ReturnType<typeof Bun.build>>;

async function bunBuild(
  define: Record<string, string>,
  minify: boolean
): Promise<BuildResult> {
  const result = await Bun.build({
    entrypoints: [clientEntryPoint],
    format: 'iife',
    target: 'browser',
    minify,
    sourcemap: minify ? 'external' : 'none',
    define
  });

  if (!result.success) {
    const details = result.logs
      .map((log) => `${log.level}: ${log.message}`)
      .join('\n');
    throw new Error(`Failed to compile oc-client: ${details}`);
  }

  return result;
}

async function outputText(
  result: BuildResult,
  kind: BuildResult['outputs'][number]['kind']
): Promise<string> {
  const output = result.outputs.find((o) => o.kind === kind);
  if (!output) {
    throw new Error(`oc-client build produced no ${kind} output`);
  }
  return output.text();
}

export interface CompiledClient {
  code: string;
  map: string;
  dev: string;
}

/**
 * Bundles the vendored oc-client-browser sources. Equivalent to upstream's
 * `compile`/`compileSync`, except the minified bundle is produced by
 * Bun.build's minifier instead of uglify-js, so the bytes differ while the
 * behaviour is the same.
 */
export async function buildClient(
  conf: ClientCompileOptions & { templates?: unknown } = {}
): Promise<CompiledClient> {
  const parsedConf = parseConf(conf);
  const define = buildDefines(parsedConf);

  const [prod, dev] = await Promise.all([
    bunBuild(define, true),
    bunBuild(define, false)
  ]);

  const [minifiedRaw, map, devRaw] = await Promise.all([
    outputText(prod, 'entry-point'),
    outputText(prod, 'sourcemap'),
    outputText(dev, 'entry-point')
  ]);

  // Normalise the sourcemap reference to the name under which the registry
  // serves it (`/oc-client/oc-client.min.map`), matching upstream's output,
  // and drop Bun's internal debugId marker.
  const minified =
    minifiedRaw.replace(/(\n?\/\/# [^\n]*)+\s*$/, '') +
    '\n//# sourceMappingURL=oc-client.min.map\n';

  return {
    code: `${licenseBanner}\n${minified}`,
    map,
    dev: `${licenseBanner}\n${devRaw}`
  };
}

/**
 * Compiles the oc-client bundle and stores it on `conf.compiledClient`,
 * compressed with brotli and gzip like options-sanitiser used to do.
 * No-op when `compileClient` is `false`.
 */
export async function compileClient(conf: CompileClientConfig): Promise<void> {
  const option = conf.compileClient;
  if (option === false) {
    return;
  }

  const clientOptions: ClientCompileOptions =
    typeof option === 'boolean' ? {} : (option ?? {});

  // The effective template set is the same one the repository registers:
  // built-ins plus user templates, with user templates winning on type.
  const templates = Object.values(
    registerTemplates(conf.templates ?? [], conf.local).templatesHash
  );

  const compiled = await buildClient({ templates, ...clientOptions });
  const minified = compiled.code;
  const brotli = zlib.brotliCompressSync(minified, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 1,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: minified.length
    }
  });
  const gzip = zlib.gzipSync(minified, { level: 7 });

  conf.compiledClient = {
    ...compiled,
    imports: clientOptions.imports,
    code: {
      minified,
      gzip,
      brotli
    }
  };
}
