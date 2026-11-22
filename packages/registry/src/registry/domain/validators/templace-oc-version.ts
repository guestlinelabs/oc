import * as semver from '../../../utils/semver';
import { OC_VERSION } from '../../../version';

type OkResult = { isValid: true };
type ErrorResult = {
  isValid: false;
  error: {
    registryVersion: string;
    minOcVersion: string;
    code: string;
  };
};
type Result = OkResult | ErrorResult;

export default function templateOcVersion(minOcVersion: string): Result {
  if (semver.lt(OC_VERSION, minOcVersion)) {
    return {
      isValid: false,
      error: {
        registryVersion: OC_VERSION,
        minOcVersion,
        code: 'old_version'
      }
    };
  }

  return { isValid: true };
}
