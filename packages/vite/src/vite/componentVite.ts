import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type ViteModule = typeof import('vite');

const cache = new Map<string, Promise<ViteModule>>();

/**
 * The Vite instance running the component's build, resolved from the
 * component's own root. A static `import 'vite'` would resolve from this
 * package's location instead, which differs from the component's Vite when
 * the plugin is linked or hoisted (e.g. Vite 8 here, Vite 7 in the component)
 * and mixes rollup- and rolldown-based Vite in one build.
 */
export function loadComponentVite(root: string): Promise<ViteModule> {
  const key = path.resolve(root || process.cwd());
  let vite = cache.get(key);
  if (!vite) {
    vite = (async () => {
      try {
        const resolved = createRequire(path.join(key, 'package.json')).resolve(
          'vite'
        );
        return (await import(pathToFileURL(resolved).href)) as ViteModule;
      } catch {
        return import('vite');
      }
    })();
    cache.set(key, vite);
  }
  return vite;
}
