import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import * as validator from '@guestlinelabs/oc-registry/registry/domain/validators';
import type { Component } from '@guestlinelabs/oc-registry/types';
import { buildComponentWithVite } from './vite-build';

export interface PackageOptions {
  componentPath: string;
  verbose?: boolean;
  production?: boolean;
}

const packageComponents =
  () =>
  async (options: PackageOptions): Promise<Component> => {
    const componentPath = path.resolve(options.componentPath);
    const componentPackagePath = path.join(componentPath, 'package.json');

    if (!fs.existsSync(componentPackagePath)) {
      throw new Error('component does not contain package.json');
    }

    const componentPackage: Component = JSON.parse(
      await fsp.readFile(componentPackagePath, 'utf8')
    );

    if (!validator.validateComponentName(componentPackage.name)) {
      throw new Error('name not valid');
    }

    console.log('building component with vite', componentPath);

    return buildComponentWithVite({
      componentDir: componentPath,
      componentPackage,
      production: options.production,
      verbose: options.verbose === true
    });
  };

export default packageComponents;
