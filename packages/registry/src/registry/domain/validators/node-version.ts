import fs from 'node:fs';
import path from 'node:path';
import * as semver from '../../../utils/semver';

const packageInfo = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'package.json'),
    'utf8'
  )
);

type OkResult = { isValid: true };
type ErrorResult = {
  isValid: false;
  error: {
    suggestedVersion: string;
    registryNodeVersion: string;
    cliNodeVersion: string;
    code: string;
  };
};
type Result = OkResult | ErrorResult;

export default function nodeVersion(
  userAgent: string | undefined,
  nodeVersion: string
): Result {
  const baseError = (
    opts: Partial<ErrorResult['error']> = {}
  ): ErrorResult => ({
    isValid: false,
    error: {
      suggestedVersion: packageInfo.engines?.node || '*',
      registryNodeVersion: nodeVersion,
      cliNodeVersion: '',
      code: '',
      ...opts
    }
  });

  if (!userAgent) {
    return baseError({ code: 'empty' });
  }

  const matchVersion = /.*\/v([\w|.]+)-.*/.exec(userAgent);
  if (!matchVersion) {
    return baseError({
      code: 'not_valid',
      cliNodeVersion: 'not-valid'
    });
  }

  const cliNodeVersion = matchVersion[1];
  // The fork declares `engines.bun`, not `engines.node`; without a Node
  // engine range there is no Node version constraint to enforce.
  if (!semver.satisfies(cliNodeVersion, packageInfo.engines?.node || '*')) {
    return baseError({
      code: 'not_matching',
      cliNodeVersion
    });
  }

  return { isValid: true };
}
