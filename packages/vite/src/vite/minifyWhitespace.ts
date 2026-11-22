import type { Plugin } from 'vite';

import { loadComponentVite } from './componentVite.js';
import type { OcBuildState } from './pluginState.js';

type RolldownMinify = boolean | 'dce-only' | Record<string, unknown>;

/**
 * Vite never strips whitespace from ES library output ("to keep pure
 * annotations for tree-shaking"), which only matters for libraries that get
 * bundled again. `template.js` is loaded by the browser as is, so in
 * production builds this removes the whitespace too:
 *
 * - rolldown-based Vite (8+): turn rolldown's codegen whitespace removal back
 *   on in the output options;
 * - rollup-based Vite (6/7): re-print the minified chunk with esbuild (which
 *   these Vite versions ship) after every other `renderChunk`, returning the
 *   source map so Rollup chains it onto the bundle's map.
 */
export function ocMinifyWhitespacePlugin(state: OcBuildState): Plugin {
  const isRolldown = (ctx: unknown) =>
    !!(ctx as { meta?: { rolldownVersion?: string } }).meta?.rolldownVersion;

  return {
    name: 'OcMinifyWhitespace',
    apply: 'build',
    outputOptions(options) {
      if (!state.production || !isRolldown(this)) return null;
      const minify = (options as { minify?: RolldownMinify }).minify;
      if (!minify || typeof minify !== 'object' || minify['codegen']) {
        return null;
      }
      return {
        ...options,
        minify: { ...minify, codegen: { removeWhitespace: true } }
      } as typeof options;
    },
    renderChunk: {
      order: 'post',
      async handler(code, chunk) {
        if (
          !state.production ||
          isRolldown(this) ||
          chunk.fileName !== 'template.js'
        ) {
          return null;
        }
        const vite = await loadComponentVite(state.componentPath);
        if (typeof vite.transformWithEsbuild !== 'function') return null;
        const result = await vite.transformWithEsbuild(code, chunk.fileName, {
          format: 'esm',
          minifyWhitespace: true,
          minifySyntax: false,
          minifyIdentifiers: false,
          legalComments: 'none',
          sourcemap: true
        });
        return { code: result.code, map: result.map };
      }
    }
  };
}
