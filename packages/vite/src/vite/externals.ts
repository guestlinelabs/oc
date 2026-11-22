import type { PluginOption } from 'vite';

import { loadComponentVite } from './componentVite.js';

type External = string | RegExp;

interface RollupInputOptions {
  external?: unknown;
  plugins?: unknown[];
}

/**
 * Port of `oc-vite-compiler`'s `externals.ts`, adapted to running inside the
 * user's Vite config where the `external` list is only known once options are
 * normalized.
 *
 * On rolldown-based Vite (v8), `require()` calls of externals inside CJS
 * dependencies (react-dom, react/jsx-runtime, ...) are kept as-is, which
 * throws in the browser. Vite 8 re-exports rolldown's
 * `esmExternalRequirePlugin`, which turns them into imports — but it must
 * own those externals, so they are also dropped from `external`.
 *
 * On rollup-based Vite (v6/v7) the commonjs plugin already emits imports
 * for externals, so this plugin is a no-op there.
 *
 * The plugin list cannot be extended from a `config` hook (Vite flattens
 * `config.plugins` before running config hooks), so the rolldown plugin is
 * appended to `inputOptions.plugins` from the rollup `options` hook, which
 * runs after `external` has been merged from the user's vite.config.
 */
export function ocExternalsPlugin(getRoot: () => string): PluginOption {
  return {
    name: 'OcExternals',
    enforce: 'post',
    async options(inputOptions) {
      // Only the bundler actually running this build decides: rollup-based
      // vite (v6/v7) already turns externals into imports.
      const meta = (this as unknown as { meta?: { rolldownVersion?: string } })
        .meta;
      if (!meta?.rolldownVersion) return;

      const vite = await loadComponentVite(getRoot());
      const esmExternalRequirePlugin = (
        vite as unknown as Record<string, unknown>
      )['esmExternalRequirePlugin'] as
        | ((opts: { external: External[] }) => PluginOption)
        | undefined;
      if (typeof esmExternalRequirePlugin !== 'function') return;

      const options = inputOptions as RollupInputOptions;
      const current = options.external;
      const list = (
        Array.isArray(current) ? current : current != null ? [current] : []
      ) as External[];
      const owned = list.filter(
        (x): x is External => typeof x === 'string' || x instanceof RegExp
      );
      if (!owned.length) return;
      const ownedSet = new Set(owned.map(String));

      if (Array.isArray(current)) {
        options.external = current.filter((x) => !ownedSet.has(String(x)));
      } else if (current !== undefined && ownedSet.has(String(current))) {
        options.external = [];
      }

      options.plugins = [
        ...(options.plugins ?? []),
        esmExternalRequirePlugin({ external: owned })
      ];
    }
  };
}
