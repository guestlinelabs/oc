import fsp from 'node:fs/promises';
import path from 'node:path';
import strings from '@guestlinelabs/oc-registry/resources';
import type { Component, Template } from '@guestlinelabs/oc-registry/types';
import coreModules from '@guestlinelabs/oc-registry/utils/core-modules';
import type { Logger } from '../../logger';
import installMissingDependencies from './install-missing-dependencies';

const getComponentPackageJson = async (
  componentPath: string
): Promise<Component> =>
  JSON.parse(
    await fsp.readFile(path.join(componentPath, 'package.json'), 'utf8')
  ) as Component;

const union = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => [
  ...new Set([...a, ...b])
];

/**
 * Collect the dependencies `oc dev` needs for its local registry:
 *
 * - `modules`: the allow-list handed to the registry as `dependencies`,
 *   i.e. node core modules plus every dependency declared by the selected
 *   components. Data providers `require()` their externals through this
 *   list (see the registry's require-wrapper), so declared deps must be
 *   present or the data provider fails with DEPENDENCY_NOT_FOUND.
 * - `templates`: always empty. The old flow returned the resolved
 *   `*-compiler` packages so the registry could server-side render
 *   components; the fork registry ships metadata-only built-in templates
 *   (including `oc-template-esm`, the only type the CLI builds) and
 *   components built by @guestlinelabs/oc-vite are rendered client-side.
 *
 * When `install` is set (dev mode), dependencies missing from the working
 * directory's node_modules are installed so data providers can require
 * them — same behaviour as the upstream CLI.
 */
export default async function handleDependencies(options: {
  install?: boolean;
  components: string[];
  logger: Logger;
}): Promise<{
  modules: string[];
  templates: Template[];
}> {
  const { components, logger } = options;

  const dependencies: Record<string, string> = {};

  logger.warn(strings.messages.cli.CHECKING_DEPENDENCIES);

  for (const component of components) {
    const pkg = await getComponentPackageJson(component);
    for (const [dependency, version] of Object.entries(
      (pkg.dependencies as Record<string, string>) || {}
    )) {
      dependencies[dependency] = version;
    }
  }

  const result = {
    modules: union(coreModules, Object.keys(dependencies)).sort(),
    templates: [] as Template[]
  };

  if (options.install) {
    await installMissingDependencies({ dependencies, logger });
  }
  return result;
}
