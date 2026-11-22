import strings from '../../../resources';
import type { Config, CorsOptions } from '../../../types';
import { validateCorsConfig } from '../../middleware/cors';
import * as auth from '../authentication';

type ValidationResult = { isValid: true } | { isValid: false; message: string };
type RegistryConfiguration = Partial<
  Omit<Config, 'dataProvider' | 'discovery' | 'cors'>
> & { cors?: CorsOptions; discovery?: boolean | { transformInfo?: unknown } };

// Options that were supported by upstream oc but have been removed in this
// fork. They are rejected with a dedicated message instead of the generic
// "unknown option" one so hosts get a clear migration hint.
const REMOVED_OPTIONS = [
  'metadata',
  'routes',
  'beforePublish',
  'baseUrlFunc',
  'discoveryFunc',
  'customHeadersToSkipOnWeakVersion',
  'tarExtractMode',
  'preload',
  's3',
  'server',
  'keepAliveTimeout'
] as const;

const ALLOWED_OPTIONS = new Set<string>([
  // Config fields (post-sanitisation shape)
  'baseUrl',
  'compiledClient',
  'cors',
  'dataProvider',
  'dependencies',
  'discovery',
  'env',
  'executionTimeout',
  'fallbackClient',
  'fallbackRegistryUrl',
  'hotReloading',
  'components',
  'liveReloadPort',
  'local',
  'path',
  'plugins',
  'pollingInterval',
  'port',
  'postRequestPayloadSize',
  'prefix',
  'publishAuth',
  'publishValidation',
  'onComponentRequest',
  'refreshInterval',
  'storage',
  'tempDir',
  'templates',
  'timeout',
  'verbosity',
  // Input-only option handled by the sanitiser
  'compileClient'
]);

export default function registryConfiguration(
  conf: RegistryConfiguration
): ValidationResult {
  const returnError = (message: string): ValidationResult => {
    return {
      isValid: false,
      message: message || 'registry configuration is not valid'
    };
  };

  if (!conf || Object.keys(conf).length === 0) {
    return returnError(strings.errors.registry.CONFIGURATION_EMPTY);
  }

  const unknownOptions = Object.keys(conf).filter(
    (key) => !ALLOWED_OPTIONS.has(key)
  );
  if (unknownOptions.length > 0) {
    const removed = unknownOptions.filter((key) =>
      (REMOVED_OPTIONS as readonly string[]).includes(key)
    );
    if (removed.length > 0) {
      return returnError(
        strings.errors.registry.CONFIGURATION_OPTIONS_REMOVED(removed)
      );
    }
    return returnError(
      strings.errors.registry.CONFIGURATION_UNKNOWN_OPTIONS(unknownOptions)
    );
  }

  const prefix = conf.prefix;

  if (prefix) {
    if (prefix.substr(0, 1) !== '/') {
      return returnError(
        strings.errors.registry.CONFIGURATION_PREFIX_DOES_NOT_START_WITH_SLASH
      );
    }

    if (prefix.substr(prefix.length - 1) !== '/') {
      return returnError(
        strings.errors.registry.CONFIGURATION_PREFIX_DOES_NOT_END_WITH_SLASH
      );
    }
  }

  const corsError = validateCorsConfig(conf.cors);
  if (corsError) {
    return returnError(corsError);
  }

  const publishAuth = conf.publishAuth;

  if (publishAuth) {
    const res = auth.validate(publishAuth);
    if (!res.isValid) {
      return returnError(res.message);
    }
  }

  const dependencies = conf.dependencies;

  if (dependencies && !Array.isArray(dependencies)) {
    return returnError(
      strings.errors.registry.CONFIGURATION_DEPENDENCIES_MUST_BE_ARRAY
    );
  }

  if (!conf.local) {
    if (!conf.storage || typeof conf.storage.adapter !== 'function') {
      return returnError(
        strings.errors.registry.CONFIGURATION_STORAGE_ADAPTER_REQUIRED
      );
    }
  }

  const transformInfo =
    typeof conf.discovery === 'object'
      ? conf.discovery?.transformInfo
      : undefined;
  if (transformInfo !== undefined && typeof transformInfo !== 'function') {
    return returnError(
      strings.errors.registry.CONFIGURATION_TRANSFORM_INFO_MUST_BE_FUNCTION
    );
  }

  if (
    conf.onComponentRequest !== undefined &&
    typeof conf.onComponentRequest !== 'function'
  ) {
    return returnError(
      strings.errors.registry
        .CONFIGURATION_ON_COMPONENT_REQUEST_MUST_BE_FUNCTION
    );
  }

  return { isValid: true };
}
