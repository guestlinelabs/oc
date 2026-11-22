import settings from '../../resources/settings';
import type { Config, CorsOptions } from '../../types';
import { normaliseCorsConfig } from '../middleware/cors';
import type { ClientCompileOptions } from './compile-client';

type CompileOptions = ClientCompileOptions;

export interface RegistryOptions<T = any>
  extends Partial<
    Omit<Config<T>, 'cors' | 'dataProvider' | 'discovery' | 'plugins'>
  > {
  /**
   * Configuration for the data provider step, i.e. the component's `server.js`
   * that produces the model consumed by the view.
   */
  dataProvider?: {
    /**
     * Executes the component's own data provider (`server.js`) when it has one.
     * Set to `false` to serve every component as if it shipped no `server.js`.
     *
     * @default true
     */
    enabled?: boolean;
  };
  /**
   * Configuration object to enable/disable the HTML discovery page and the API
   *
   * @default true
   */
  discovery?:
    | {
        ui?: boolean;
        experimental?: boolean;
        api?: boolean;
        validate?: boolean;
        robots?: boolean;
        transformInfo?: Config['discovery']['transformInfo'];
      }
    | boolean;
  /**
   * CORS response headers sent by the registry.
   *
   * @default Existing registry CORS headers
   */
  cors?: CorsOptions;
  /**
   * Public base URL where the registry will be accessible by consumers.
   * It **must** already include the chosen {@link Config.prefix} and end with a trailing slash.
   *
   * @example "https://components.mycompany.com/"
   */
  baseUrl: string;
  /**
   * Set the options for the oc-client-browser
   * Set it to false to disable the compilation of the client
   * @default true
   */
  compileClient?: boolean | CompileOptions;
}

export default function optionsSanitiser<T = any>(
  input: RegistryOptions<T>
): Config {
  const options = { ...input } as unknown as Config & RegistryOptions;

  if (!options.publishValidation) {
    options.publishValidation = () => ({
      isValid: true
    });
  }

  if (!options.prefix) {
    options.prefix = '/';
  }

  const hasTrailingPrefix = new RegExp(options.prefix + '$');
  if (!options.baseUrl.match(hasTrailingPrefix)) {
    options.baseUrl = options.baseUrl.replace(/\/$/, '') + options.prefix;
  }

  if (!options.tempDir) {
    options.tempDir = settings.registry.defaultTempPath;
  }

  if (typeof options.hotReloading !== 'boolean') {
    options.hotReloading = !!options.local;
  }

  if (!options.verbosity) {
    options.verbosity = 0;
  }

  options.dataProvider = {
    ...options.dataProvider,
    enabled: options.dataProvider?.enabled !== false
  };

  options.cors = normaliseCorsConfig(options.cors);

  const showApi =
    typeof options.discovery === 'boolean'
      ? true
      : (options.discovery?.api ?? true);
  const showUI =
    typeof options.discovery === 'boolean'
      ? options.discovery
      : (options.discovery?.ui ?? true);
  const showRobots =
    typeof options.discovery === 'boolean'
      ? true
      : (options.discovery?.robots ?? true);
  const showExperimental = !showApi
    ? false
    : typeof options.discovery === 'boolean'
      ? // We keep previous default behavior for backward compatibility
        true
      : (options.discovery?.experimental ?? true);
  const showValidation = !showApi
    ? false
    : typeof options.discovery === 'boolean'
      ? // We keep previous default behavior for backward compatibility
        false
      : (options.discovery?.validate ?? false);
  const transformInfo =
    typeof options.discovery === 'boolean'
      ? undefined
      : options.discovery?.transformInfo;

  options.discovery = {
    ui: showUI,
    experimental: showExperimental,
    api: showApi,
    validate: showValidation,
    robots: showRobots,
    ...(transformInfo && { transformInfo })
  };

  if (typeof options.pollingInterval === 'undefined') {
    options.pollingInterval = 5;
  }

  if (!options.templates) {
    options.templates = [];
  }

  // The oc-client bundle is compiled asynchronously at startup by
  // ./compile-client (Bun.build); `compileClient: false` opts out there.

  if (!options.dependencies) {
    options.dependencies = [];
  }

  if (
    typeof options.fallbackRegistryUrl !== 'undefined' &&
    !options.fallbackRegistryUrl.endsWith('/')
  ) {
    options.fallbackRegistryUrl += '/';
  }

  options.port = options.port || process.env['PORT'] || 3000;
  options.timeout = options.timeout || 1000 * 60 * 2;

  if (typeof options.refreshInterval !== 'undefined' && options.storage) {
    options.storage.options = options.storage.options || {};
    options.storage.options['refreshInterval'] = options.refreshInterval;
  }

  if (options.verbosity && options.storage) {
    options.storage.options['verbosity'] = options.verbosity;
  }

  if (options.storage?.options?.['path']) {
    options.storage.options['path'] =
      options.storage.options['path'].indexOf('http') === 0
        ? options.storage.options['path']
        : `https:${options.storage.options['path']}`;
  }

  if (!options.env) {
    options.env = {};
  }

  return options as Config;
}
