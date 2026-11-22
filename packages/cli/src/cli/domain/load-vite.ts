import fs from 'node:fs';
import path from 'node:path';

export interface VitePluginLike {
  name?: string;
}

export interface ViteResolvedConfigLike {
  configFile?: string | false;
  plugins?: VitePluginLike[];
}

/**
 * The slice of Vite's API the CLI needs. `vite` is resolved from the
 * component's own dependencies, so its version (6/7/8) is whatever the
 * component declares — the types are intentionally structural.
 */
export interface ViteLike {
  build(inlineConfig: Record<string, unknown>): Promise<unknown>;
  resolveConfig(
    inlineConfig: Record<string, unknown>,
    command: 'build' | 'serve',
    defaultMode?: string,
    defaultNodeEnv?: string
  ): Promise<ViteResolvedConfigLike>;
}

/**
 * Walk the component's node_modules chain looking for an installed `vite`
 * package. Mirrors Node's resolution order (nearest `node_modules` first)
 * but deliberately does NOT use `require.resolve`: under Bun it falls back
 * to the global install cache (`~/.bun/install/cache`), which would make
 * "vite is not installed in the component" undetectable.
 */
function findVitePackageDir(componentDir: string): string | undefined {
  let dir = path.resolve(componentDir);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', 'vite');
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

const EXPORT_CONDITIONS = [
  'import',
  'module-sync',
  'default',
  'require',
  'node',
  'module'
];

/**
 * Pick the ESM entry point of an installed vite package from its
 * package.json `exports`/`module`/`main`. Preferring `import` keeps a
 * single ESM module instance shared with `@guestlinelabs/oc-vite`'s own
 * `import ... from 'vite'` (its server build runs inside the plugin).
 */
function viteEntryPath(vitePackageDir: string): string | undefined {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(vitePackageDir, 'package.json'), 'utf8')
  ) as {
    exports?: Record<string, unknown>;
    module?: string;
    main?: string;
  };

  const candidates: string[] = [];
  const dotExport = pkg.exports?.['.'];
  if (typeof dotExport === 'string') {
    candidates.push(dotExport);
  } else if (dotExport && typeof dotExport === 'object') {
    for (const condition of EXPORT_CONDITIONS) {
      const target = (dotExport as Record<string, unknown>)[condition];
      if (typeof target === 'string') {
        candidates.push(target);
      }
    }
  }
  if (typeof pkg.module === 'string') candidates.push(pkg.module);
  if (typeof pkg.main === 'string') candidates.push(pkg.main);
  candidates.push('index.js');

  for (const candidate of candidates) {
    const entryPath = path.join(vitePackageDir, candidate);
    if (fs.existsSync(entryPath)) {
      return entryPath;
    }
  }
  return undefined;
}

/**
 * Resolve and load `vite` from the component's own dependencies.
 *
 * Components own their toolchain: the CLI must never bundle or depend on a
 * specific vite version, so resolution walks the component's
 * node_modules chain and dynamically imports the resolved entry.
 * Throws when the component does not have vite installed — callers turn
 * that into a friendly error.
 */
export async function loadVite(componentDir: string): Promise<ViteLike> {
  const vitePackageDir = findVitePackageDir(componentDir);
  if (!vitePackageDir) {
    throw new Error(`vite is not installed for ${componentDir}`);
  }
  const viteEntry = viteEntryPath(vitePackageDir);
  if (!viteEntry) {
    throw new Error(
      `cannot resolve the entry point of vite installed at ${vitePackageDir}`
    );
  }
  return (await import(viteEntry)) as ViteLike;
}
