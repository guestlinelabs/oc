import fs from 'node:fs/promises';
import path from 'node:path';
import type { Component } from '../../types';

export default async function getPackageJsonFromTempDir(
  tempDirPath: string
): Promise<Component> {
  return JSON.parse(
    await fs.readFile(path.join(tempDirPath, 'package.json'), 'utf8')
  ) as Component;
}
