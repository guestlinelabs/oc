import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type { Component } from '@guestlinelabs/oc-registry/types';
import { loadVite } from './load-vite';

export const OC_TEMPLATE_ESM = 'oc-template-esm';
// `name` of the main plugin returned by `oc()` in @guestlinelabs/oc-vite
// (packages/vite/src/vite/plugin.ts). Used to verify the component's
// vite.config actually wires the OC plugin into the build.
export const OC_VITE_PLUGIN_NAME = 'guestlinelabs-oc-vite';

export interface ViteBuildOptions {
  componentDir: string;
  componentPackage: Component;
  production?: boolean;
  verbose?: boolean;
}

const oldTemplateError = (componentDir: string, type: unknown): Error =>
  new Error(
    `Cannot build ${componentDir}: "oc.files.template.type" is ` +
      `${JSON.stringify(type ?? null)} but @guestlinelabs/oc only builds ` +
      `"${OC_TEMPLATE_ESM}" components through the component's own Vite ` +
      `and the oc() plugin from @guestlinelabs/oc-vite. Components using ` +
      `other templates must be packaged with the upstream "oc" CLI, or ` +
      `migrated to @guestlinelabs/oc-vite.`
  );

/**
 * Build a component into `_package/` using the component's own Vite and
 * the `oc()` plugin from `@guestlinelabs/oc-vite`.
 *
 * This replaces the old compiler flow (`requireTemplate().compile()`):
 * there are no `*-compiler` packages anymore — the component's
 * `vite.config.*` is the build definition and the plugin emits the same
 * `_package/` contents the registry expects.
 *
 * Returns the packaged component metadata read back from
 * `_package/package.json`.
 */
export async function buildComponentWithVite(
  options: ViteBuildOptions
): Promise<Component> {
  const { componentDir, componentPackage } = options;
  const production = options.production === true;
  const verbose = options.verbose === true;
  const publishPath = path.join(componentDir, '_package');
  const logLevel = verbose ? 'info' : 'silent';

  const templateType = componentPackage?.oc?.files?.template?.type;
  if (templateType !== OC_TEMPLATE_ESM) {
    throw oldTemplateError(componentDir, templateType);
  }

  // Clean the output dir like the old flow's `emptyDir(publishPath)`.
  await fsp.rm(publishPath, { recursive: true, force: true });
  await fsp.mkdir(publishPath, { recursive: true });

  let vite: Awaited<ReturnType<typeof loadVite>>;
  try {
    vite = await loadVite(componentDir);
  } catch {
    throw new Error(
      `Cannot build ${componentDir}: "vite" is not installed for this ` +
        `component. @guestlinelabs/oc builds components with the ` +
        `component's own Vite — install vite (and @guestlinelabs/oc-vite ` +
        `for the oc() plugin) in the component's dependencies.`
    );
  }

  let resolvedConfig: Awaited<ReturnType<typeof vite.resolveConfig>>;
  try {
    // Pass the same default mode/NODE_ENV that `vite build` uses: when
    // NODE_ENV is unset, resolveConfig sets it to its `defaultNodeEnv`
    // ('development' unless given) for the rest of the process, and plugins
    // like @vitejs/plugin-react then emit the dev JSX runtime (`jsxDEV`) into
    // a production build.
    const mode = production ? 'production' : 'development';
    resolvedConfig = await vite.resolveConfig(
      { root: componentDir, logLevel, mode },
      'build',
      mode,
      mode
    );
  } catch (err) {
    throw new Error(
      `Cannot build ${componentDir}: failed to load the component's ` +
        `vite config: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const configFile = resolvedConfig.configFile;
  if (!configFile) {
    throw new Error(
      `Cannot build ${componentDir}: no vite config found. Create a ` +
        `vite.config.* in the component that registers the oc() plugin ` +
        `from @guestlinelabs/oc-vite.`
    );
  }

  const hasOcPlugin = (resolvedConfig.plugins ?? []).some(
    (plugin) => plugin?.name === OC_VITE_PLUGIN_NAME
  );
  if (!hasOcPlugin) {
    throw new Error(
      `Cannot build ${componentDir}: the vite config (${configFile}) does ` +
        `not include the oc() plugin from @guestlinelabs/oc-vite. Add ` +
        `\`import { oc } from '@guestlinelabs/oc-vite/plugin'\` and ` +
        `\`plugins: [oc()]\`.`
    );
  }

  await vite.build({
    root: componentDir,
    configFile,
    mode: production ? 'production' : 'development',
    logLevel
  });

  const packagedPackageJsonPath = path.join(publishPath, 'package.json');
  if (!fs.existsSync(packagedPackageJsonPath)) {
    throw new Error(
      `Cannot build ${componentDir}: vite build did not produce ` +
        `${packagedPackageJsonPath}. Make sure the oc() plugin from ` +
        `@guestlinelabs/oc-vite is registered in the vite config.`
    );
  }

  return JSON.parse(
    await fsp.readFile(packagedPackageJsonPath, 'utf8')
  ) as Component;
}
