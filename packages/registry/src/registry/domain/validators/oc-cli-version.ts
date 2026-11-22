import * as semver from '../../../utils/semver';
import { OC_VERSION } from '../../../version';

type OkResult = { isValid: true };
type ErrorResult = {
  isValid: false;
  error: {
    suggestedVersion: string;
    registryVersion: string;
    cliVersion: string;
    code: string;
  };
};
type Result = OkResult | ErrorResult;

export default function ocCliVersion(userAgent?: string): Result {
  const baseError = (
    opts: Partial<ErrorResult['error']> = {}
  ): ErrorResult => ({
    isValid: false,
    error: {
      suggestedVersion: `${semver.major(OC_VERSION)}.${semver.minor(
        OC_VERSION
      )}.X`,
      registryVersion: OC_VERSION,
      cliVersion: '',
      code: '',
      ...opts
    }
  });

  if (!userAgent) {
    return baseError({ code: 'empty' });
  }

  const matchVersion = /oc-cli-([\w|.]+).*/.exec(userAgent);
  if (!matchVersion) {
    return baseError({ code: 'not_valid', cliVersion: 'not_valid' });
  }

  const cliVersion = matchVersion[1];
  const cliMajorMinor = `${semver.major(cliVersion)}.${semver.minor(cliVersion)}.0`;
  const registryMajorMinor = `${semver.major(OC_VERSION)}.${semver.minor(OC_VERSION)}.0`;
  if (semver.lt(cliMajorMinor, registryMajorMinor)) {
    return baseError({ code: 'old_version', cliVersion });
  }

  return { isValid: true };
}
