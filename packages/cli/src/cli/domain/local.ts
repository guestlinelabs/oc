import fsp from 'node:fs/promises';

import * as targz from '@guestlinelabs/oc-registry/utils/targz';
import getComponentsByDir from './get-components-by-dir';
import mock from './mock';
import packageComponents from './package-components';

export default function local() {
  return {
    cleanup(compressedPackagePath: string): Promise<void> {
      return fsp.unlink(compressedPackagePath);
    },
    compress(input: string, output: string): Promise<void> {
      return targz.compress(input, output, '_package');
    },
    getComponentsByDir: getComponentsByDir(),
    mock: mock(),
    package: packageComponents()
  };
}

export type Local = ReturnType<typeof local>;
