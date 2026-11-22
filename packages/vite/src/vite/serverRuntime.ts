import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

export interface OcRuntimeState {
  componentName?: string;
  componentVersion?: string;
}

// This file is emitted to dist/vite/serverRuntime.js; the client entry is
// dist/client.js re-exporting dist/serverClient.js, which is where the
// 'COMPONENT_NAME' / 'COMPONENT_VERSION' placeholders live (same layout as
// upstream `oc-server/dist/serverClient.js`).
const ownServerClientPath = path.resolve(
  fileURLToPath(new URL('../serverClient.js', import.meta.url))
);

function isOcServerClientModule(id: string): boolean {
  const clean = id.split('?')[0].split('#')[0];
  if (!clean.endsWith('.js')) return false;
  const resolved = path.resolve(clean);
  if (resolved === ownServerClientPath) return true;
  // Fallback for installs where the plugin and the client module resolve to
  // different copies/realpaths (e.g. nested node_modules).
  return /[\\/]oc-vite[\\/]dist[\\/]serverClient\.js$/.test(resolved);
}

/**
 * Port of `oc-vite-compiler`'s `OcServerRuntime` transform. Replaces the
 * `'COMPONENT_NAME'` / `'COMPONENT_VERSION'` placeholders in our bundled
 * `serverClient` module with the component's package name/version, so
 * `serverClient`/`getAction` calls hit the right component. Robust to the
 * module living in `node_modules/@guestlinelabs/oc-vite/dist/...` or being
 * linked from a workspace (matched by resolved path, not a
 * `node_modules/...` substring like upstream).
 */
export function ocServerRuntimePlugin(state: OcRuntimeState): Plugin {
  return {
    name: 'OcServerRuntime',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!state.componentName || !isOcServerClientModule(id)) {
        return;
      }
      code = code.replace(
        /("|')COMPONENT_NAME("|')/,
        `"${state.componentName}"`
      );
      code = code.replace(
        /("|')COMPONENT_VERSION("|')/,
        `"${state.componentVersion}"`
      );
      return {
        code,
        map: null
      };
    }
  };
}
