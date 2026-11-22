import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Component } from '@guestlinelabs/oc-registry/types';

export default function getComponentsByDir() {
  return async (
    componentsDir: string,
    componentsToRun?: string[]
  ): Promise<string[]> => {
    const isOcComponent = (file: string) => {
      const filePath = path.resolve(componentsDir, file);
      const packagePath = path.join(filePath, 'package.json');
      let content: Component;

      try {
        content = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      } catch {
        return false;
      }

      if (!content.oc) {
        return false;
      }

      const packagedProperty = content.oc?.packaged;

      return typeof packagedProperty === 'undefined';
    };

    try {
      let dirContent = await fsp.readdir(componentsDir);
      if (componentsToRun) {
        dirContent = dirContent.filter((content) =>
          componentsToRun.includes(content)
        );
      }

      const components = dirContent
        .filter(isOcComponent)
        .map((component) => path.resolve(componentsDir, component));

      return components;
    } catch {
      return [];
    }
  };
}
