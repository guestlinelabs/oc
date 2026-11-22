import fs from 'node:fs';
import path from 'node:path';
import strings from '@guestlinelabs/oc-registry/resources';
import * as semver from '@guestlinelabs/oc-registry/utils/semver';
import Local from './domain/local';
import Registry from './domain/registry';
import dev from './facade/dev';
import mock from './facade/mock';
import packageScript from './facade/package';
import preview from './facade/preview';
import publish from './facade/publish';
import registry from './facade/registry';
import registryAdd from './facade/registry-add';
import registryLs from './facade/registry-ls';
import registryRemove from './facade/registry-remove';
import validate from './facade/validate';
import { renderHelp } from './help';
import logger from './logger';
import { getCommandTree, parseArgv } from './parse-argv';

const cliFunctions = {
  dev,
  mock,
  package: packageScript,
  preview,
  publish,
  registry,
  'registry-add': registryAdd,
  'registry-ls': registryLs,
  'registry-remove': registryRemove,
  validate
};

const currentNodeVersion = process.version;
const minSupportedVersion = '6.0.0';
if (semver.lt(currentNodeVersion, minSupportedVersion)) {
  logger.err(
    strings.errors.cli.NODE_CLI_VERSION_UNSUPPORTED(
      currentNodeVersion,
      minSupportedVersion
    )
  );
}

const dependencies = {
  local: Local(),
  logger,
  registry: Registry()
};

function scriptName(): string {
  const base = path
    .basename(process.argv[1] || 'oc')
    .replace(/\.(js|ts|mjs|cjs)$/, '');
  return base === 'oc-cli' ? 'oc' : base;
}

function packageVersion(): string {
  const ocPackagePath = path.join(__dirname, '../../package.json');
  return JSON.parse(fs.readFileSync(ocPackagePath, 'utf8')).version;
}

const name = scriptName();
const tree = getCommandTree();
const result = parseArgv(process.argv.slice(2), name);

switch (result.type) {
  case 'help':
    console.log(renderHelp(result.node, tree, name));
    break;
  case 'version':
    console.log(packageVersion());
    break;
  case 'run': {
    const key = result.node.path.join('-');
    const facade = cliFunctions[key as keyof typeof cliFunctions](
      dependencies
    ) as (options: unknown) => Promise<unknown>;
    facade(result.argv).catch(() => {
      process.exit(1);
    });
    break;
  }
  case 'error': {
    console.log(renderHelp(result.node, tree, name));
    console.error(result.message);
    process.exit(1);
  }
}
