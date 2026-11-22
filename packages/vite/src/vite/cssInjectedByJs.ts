import type { Plugin, ResolvedConfig } from 'vite';
import { loadComponentVite } from './componentVite.js';
import { prependLines } from './prependCode.js';

// Minimal rollup output types (vite 6/7 expose Rollup types, vite 8 Rolldown).
interface OutputAsset {
  type: 'asset';
  fileName: string;
  source: string | Uint8Array;
}
interface OutputChunk {
  type: 'chunk';
  fileName: string;
  code: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  viteMetadata?: { importedCss: Set<string> };
}
type OutputEntry = OutputAsset | OutputChunk;

/**
 * Replacement for `vite-plugin-css-injected-by-js` (build side, global
 * injection mode only — the mode `oc-vite-compiler` uses). Ported from
 * `vite-plugin-css-injected-by-js@3.5.2` `dist/esm/{index,utils}.js`;
 * `relativeCSSInjection`, `jsAssetsFilterFunction`, dev mode and HTML
 * handling are omitted because the OC client build never uses them.
 */

interface InjectionOptions {
  styleId?: string;
  injectCode?: (cssCode: string) => string;
}

export interface CssInjectedByJsState extends InjectionOptions {
  config?: ResolvedConfig;
}

const cssInjectedByJsId = '\0vite/all-css';

async function buildCSSInjectionCode({
  root,
  buildOptions,
  cssToInject,
  injectCode,
  styleId
}: {
  root: string;
  buildOptions: ResolvedConfig['build'];
  cssToInject: string;
  injectCode?: (cssCode: string) => string;
  styleId?: string;
}): Promise<{ code: string } | null> {
  const { minify, target } = buildOptions;
  const cssCode = JSON.stringify(cssToInject.trim());
  const code = injectCode
    ? injectCode(cssCode)
    : `try{if(typeof document != 'undefined'){var elementStyle = document.createElement('style');${
        typeof styleId === 'string' && styleId.length > 0
          ? `elementStyle.id = '${styleId}';`
          : ''
      }elementStyle.appendChild(document.createTextNode(${cssCode}));document.head.appendChild(elementStyle);}}catch(e){console.error('vite-plugin-css-injected-by-js', e);}`;

  const { build } = await loadComponentVite(root);
  const res = await build({
    root: '',
    configFile: false,
    logLevel: 'error',
    plugins: [
      {
        name: 'vite:injection-css-code-plugin',
        resolveId(id: string) {
          if (id === cssInjectedByJsId) {
            return id;
          }
          return null;
        },
        load(id: string) {
          if (id === cssInjectedByJsId) {
            return code;
          }
          return null;
        }
      }
    ],
    build: {
      write: false,
      target,
      minify,
      assetsDir: '',
      rollupOptions: {
        input: {
          ['all-css']: cssInjectedByJsId
        },
        output: {
          format: 'iife',
          manualChunks: undefined
        }
      }
    }
  });
  const _cssChunk = Array.isArray(res) ? res[0] : res;
  if (!('output' in _cssChunk)) return null;
  const first = _cssChunk.output[0] as { code?: string } | undefined;
  return first?.code != null ? { code: first.code } : null;
}

function isJsOutputChunk(chunk: OutputEntry) {
  return (
    chunk.type === 'chunk' &&
    // eslint-disable-next-line no-useless-escape
    /.[cm]?js(?:\?.+)?$/.test(chunk.fileName)
  );
}

function defaultJsAssetsFilter(chunk: OutputChunk) {
  return chunk.isEntry && !chunk.fileName.includes('polyfill');
}

function getJsTargetBundleKeys(bundle: Record<string, OutputEntry>) {
  const jsAssets = Object.keys(bundle).filter((i) => {
    const asset = bundle[i];
    return (
      asset.type === 'chunk' &&
      isJsOutputChunk(asset) &&
      defaultJsAssetsFilter(asset)
    );
  });
  if (jsAssets.length === 0) {
    return [];
  }
  const jsTargetFileName = jsAssets[jsAssets.length - 1];
  if (jsAssets.length > 1) {
    console.warn(
      `\x1b[33m \n[vite-plugin-css-injected-by-js] has identified "${jsTargetFileName}" as one of the multiple output files marked as "entry" to put the CSS injection code.\x1b[39m`
    );
  }
  return [jsTargetFileName];
}

function extractCss(bundle: Record<string, OutputEntry>, cssName: string) {
  const cssAsset = bundle[cssName];
  if (cssAsset !== undefined && cssAsset.type === 'asset' && cssAsset.source) {
    const cssSource = cssAsset.source;
    return cssSource instanceof Uint8Array
      ? new TextDecoder().decode(cssSource)
      : `${cssSource}`;
  }
  return '';
}

function concatCssAndDeleteFromBundle(
  bundle: Record<string, OutputEntry>,
  cssAssets: string[]
) {
  return cssAssets.reduce(function extractCssAndDeleteFromBundle(
    previous,
    cssName
  ) {
    const cssSource = extractCss(bundle, cssName);
    delete bundle[cssName];
    return previous + cssSource;
  }, '');
}

function clearImportedCssViteMetadataFromBundle(
  bundle: Record<string, OutputEntry>,
  unusedCssAssets: string[]
) {
  // Required to exclude removed files from manifest.json
  for (const key in bundle) {
    const chunk = bundle[key];
    const viteMetadata = (
      chunk as OutputEntry & { viteMetadata?: { importedCss: Set<string> } }
    ).viteMetadata;
    if (viteMetadata && viteMetadata.importedCss.size > 0) {
      const importedCssFileNames = viteMetadata.importedCss;
      importedCssFileNames.forEach((importedCssFileName) => {
        if (!unusedCssAssets.includes(importedCssFileName)) {
          viteMetadata.importedCss = new Set();
        }
      });
    }
  }
}

export default function cssInjectedByJsPlugin(
  state: CssInjectedByJsState
): Plugin[] {
  const plugins: Plugin[] = [
    {
      apply: 'build',
      enforce: 'post',
      name: 'vite-plugin-css-injected-by-js',
      configResolved(_config) {
        state.config = _config;
      },
      async generateBundle(_opts, bundle: Record<string, OutputEntry>) {
        const config = state.config;
        if (!config || config.build.ssr) {
          return;
        }
        const buildCssCode = (cssToInject: string) =>
          buildCSSInjectionCode({
            root: config.root,
            buildOptions: config.build,
            cssToInject,
            injectCode: state.injectCode,
            styleId: state.styleId
          });

        const cssAssets = Object.keys(bundle).filter(
          (i) =>
            bundle[i].type === 'asset' && bundle[i].fileName.endsWith('.css')
        );
        const allCssAssets = cssAssets;
        const unusedCssAssets = allCssAssets.filter(
          (cssAsset) => !cssAssets.includes(cssAsset)
        );

        const jsTargetBundleKeys = getJsTargetBundleKeys(bundle);
        if (jsTargetBundleKeys.length === 0) {
          throw new Error(
            'Unable to locate the JavaScript asset for adding the CSS injection code. It is recommended to review your configurations.'
          );
        }
        const allCssCode = concatCssAndDeleteFromBundle(bundle, cssAssets);
        let cssInjectionCode = '';
        if (allCssCode.length > 0) {
          const cssCode = (await buildCssCode(allCssCode))?.code;
          if (typeof cssCode === 'string') {
            cssInjectionCode = cssCode;
          }
        }
        for (const jsTargetKey of jsTargetBundleKeys) {
          const jsAsset = bundle[jsTargetKey];
          if (jsAsset.type !== 'chunk') continue;
          // Blank out Vite's placeholders without moving columns (source map).
          jsAsset.code = jsAsset.code.replace(/\/\*\s*empty css\s*\*\//g, (m) =>
            ' '.repeat(m.length)
          );
          prependLines(jsAsset, cssInjectionCode ?? '', bundle);
        }
        clearImportedCssViteMetadataFromBundle(bundle, unusedCssAssets);
      }
    }
  ];
  return plugins;
}
