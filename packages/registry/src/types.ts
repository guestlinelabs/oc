import type { IncomingHttpHeaders } from 'node:http';
import type { PackageJson } from 'type-fest';
import type {
  ConnectMiddleware,
  RegistryApp
} from './registry/domain/http-server/types';
import type { StorageAdapter } from './storage';

export type { ConnectMiddleware, RegistryApp };

export interface RegistryErrorEvent {
  /**
   * Stable registry error category. HTTP server failures use
   * `SERVER_ERROR`.
   */
  code: string;
  /** The original error message reported by the failing registry operation. */
  message: string;
}

export interface CorsConfig {
  origin: string;
  credentials: boolean;
  allowedHeaders: string;
  methods: string;
}

export interface CorsOptions {
  origin?: string;
  credentials?: boolean;
  allowedHeaders?: string | string[];
  methods?: string | string[];
}

export interface Author {
  email?: string;
  name?: string;
  url?: string;
}

interface ComponentList {
  author: Author;
  name: string;
  state: string;
}

export interface TemplateInfo {
  externals: Array<{
    name: string;
    global: string | string[];
    url: string;
    devUrl?: string;
  }>;
  type: string;
  version: string;
}

export type ComponentDetail = {
  [componentVersion: string]: {
    publishDate: number;
    templateSize?: number;
  };
};

export interface ComponentsDetails {
  components: {
    [componentName: string]: ComponentDetail;
  };
  lastEdit: number;
}

export interface ComponentsList {
  components: Record<string, string[]>;
  lastEdit: number;
}

export interface OcParameter {
  default?: string | boolean | number;
  description?: string;
  example?: string | boolean | number;
  mandatory?: boolean;
  /**
   * You can optionally restrict the values of the parameter to a specific set of values.
   * @example
   * ```ts
   * {
   *   type: 'string',
   *   enum: ['foo', 'bar', 'baz']
   * }
   */
  enum?: string[] | number[] | boolean[];
  type: 'string' | 'boolean' | 'number';
}

interface OcConfiguration {
  container?: boolean;
  date: number;
  files: {
    imports?: Record<string, string>;
    dataProvider: {
      hashKey: string;
      src: string;
      type: string;
      size?: number;
    };
    static: string[];
    template: {
      hashKey: string;
      src: string;
      type: string;
      version: string;
      minOcVersion?: string;
      size?: number;
    };
    env?: string;
  };
  packaged: boolean;
  parameters: Record<string, OcParameter>;
  plugins?: string[];
  renderInfo?: boolean;
  state?: 'deprecated' | 'experimental';
  stringifiedDate: string;
  publisher?: string;
  version: string;
}

export interface Component extends PackageJson {
  allVersions: string[];
  name: string;
  oc: OcConfiguration;
  version: string;
}

/** package.json of a published component, as stored by the registry. */
export type ComponentInfo = Component;

export type TransformInfo = (
  info: Readonly<ComponentInfo>
) => object | Promise<object>;

export interface ComponentRequestContext {
  /** Name of the requested component. */
  name: string;
  /** Version requested by the consumer (exact, semver range or empty for latest). */
  requestedVersion: string;
  /** Version the registry resolved the request to and is about to serve. */
  version: string;
  /** Latest published version of the component, as resolved for an unversioned request. */
  latestVersion: string;
  /** package.json of the resolved component, including `allVersions`. */
  component: Readonly<Component>;
  headers: IncomingHttpHeaders;
  parameters: Record<string, string>;
  /** Name of the action being invoked, if any. */
  action?: string;
}

export interface ComponentRequestRejection {
  /** @default 403 */
  status?: number;
  /** @default "COMPONENT_REQUEST_REJECTED" */
  code?: string;
  error?: string;
}

export type ComponentRequestHook = (
  context: ComponentRequestContext
) =>
  | ComponentRequestRejection
  | undefined
  | Promise<ComponentRequestRejection | undefined>;

export interface ParsedComponent extends Omit<Component, 'author'> {
  author: Author;
}

export interface VM {
  availableDependencies: Array<{
    core: boolean;
    name: string;
    version: string;
    link: string;
  }>;
  availablePlugins: Plugins;
  components: ParsedComponent[];
  componentsList: ComponentList[];
  componentsReleases: number;
  href: string;
  ocVersion: string;
  q: string;
  stateCounts: {
    deprecated?: number;
    experimental?: number;
  };
  templates: TemplateInfo[];
  title: string;
  theme: 'light' | 'dark';
  type: 'oc-registry' | 'oc-registry-local';
  robots: boolean;
}

export type Authentication<T = any> = {
  validate: (config: T) => {
    isValid: boolean;
    message: string;
  };
  middleware: (config: T) => ConnectMiddleware;
};

export type PublishAuthConfig =
  | {
      type: 'basic';
      username: string;
      password: string;
    }
  | {
      type: 'basic';
      logins: Array<{ username: string; password: string }>;
    }
  | ({ type: string | Authentication } & Record<string, any>);

export interface Config<T = any> {
  /**
   * Public base URL where the registry is reachable by consumers.
   *
   * The value **must** include the configured {@link prefix} at the end
   * (e.g. `https://components.mycompany.com/` if `prefix` is `/`).
   *
   * When it doesn't, the sanitiser will automatically append it.
   *
   * @example "https://components.mycompany.com/"
   */
  baseUrl: string;
  /**
   * CORS response headers sent by the registry.
   *
   * @default Existing registry CORS headers
   */
  cors?: CorsConfig;
  /**
   * Pre-compiled version of the `oc-client` library generated automatically
   * at runtime when `compileClient` is enabled (default).
   *
   * This is filled in by the framework – you normally don't set it yourself.
   * Declared here to keep the type complete.
   *
   * @internal
   */
  compiledClient?: {
    imports?: Record<string, string>;
    code: { gzip: Buffer; brotli: Buffer; minified: string };
    map: string;
    dev: string;
  };
  /**
   * Names of npm packages that components can `require` at runtime.
   *
   * @default []
   * @example ["lodash", "moment"]
   */
  dependencies: string[];
  /**
   * Configuration for the data provider step, i.e. the component's `server.js`
   * that produces the model consumed by the view.
   */
  dataProvider: {
    /**
     * Executes the component's own data provider (`server.js`) when it has one.
     *
     * When `false` the registry never fetches nor runs a component's data
     * provider, even if one exists in the storage: every component is served
     * through the same path used by components that ship no `server.js`, i.e.
     * the request parameters are passed straight through as the view model.
     *
     * @default true
     */
    enabled: boolean;
  };
  /**
   * Configuration object to enable/disable the HTML discovery page and the API
   */
  discovery: {
    /**
     * Appends a <meta name="robots" content="index, follow" /> to the HTML head
     * False to append a <meta name="robots" content="noindex, nofollow" />
     * @default true
     */
    robots: boolean;
    /**
     * Enables API discovery endpoints
     * @default true
     */
    api: boolean;
    /**
     * Enables the HTML discovery page
     * @default true
     */
    ui: boolean;
    /**
     * Enables validation for the discovery API
     * @default false
     */
    validate: boolean;
    /**
     * Shows experimental components from the API
     * @default true
     */
    experimental: boolean;
    /**
     * Transforms the component info returned by the discovery API
     * (`GET /:name/~info` as JSON and `GET /?meta=...`). The returned object
     * is what gets sent, so fields can be removed or added. It does not apply
     * to the HTML UI nor to internal consumers like the `component-published`
     * event. Throwing or rejecting responds with a 500 error.
     *
     * @example
     * transformInfo: ({ author, owners, ...info }) => info
     */
    transformInfo?: TransformInfo;
  };
  /**
   * Environment values passed to components in `context.env` and the data
   * provider's `process.env` shim.
   *
   * @default {}
   */
  env: Record<string, any>;
  /**
   * Maximum execution time of a component’s server-side logic, expressed in
   * seconds. When the timeout elapses the registry returns a 500 error.
   *
   * If omitted there is no execution timeout.
   */
  executionTimeout?: number;
  /**
   * URL of a secondary registry that will be queried if a component cannot
   * be found on this instance. A trailing slash is appended automatically.
   */
  fallbackRegistryUrl: string;
  /**
   * Enables the fallback client to be used
   *
   * @default false
   */
  fallbackClient: boolean;
  /**
   * Enables hot-reloading of component code (always `true` when `local` is).
   *
   * @default !!local
   */
  hotReloading: boolean;
  /**
   * TCP port of the LiveReload server used by the preview page.
   */
  liveReloadPort: number;
  /**
   * Restricts the registry to serve only the specified component names.
   */
  components?: string[];
  /**
   * Indicates whether the registry serves components from the local file
   * system (`true`) or from the remote storage (`false`).
   */
  local: boolean;
  /**
   * Absolute path where local components are stored.
   */
  path: string;
  /**
   * Collection of plugins initialised for this registry instance.
   * Populated via `registry.register(...)`.
   */
  plugins: Plugins;
  /**
   * Seconds between each poll of the storage adapter for changes.
   *
   * @default 5
   */
  pollingInterval: number;
  /**
   * Port the HTTP server listens on.
   *
   * @default process.env.PORT ?? 3000
   */
  port: number | string;
  /**
   * Maximum allowed `Content-Length` for *publish* requests.
   * Accepts any value supported by the `bytes` module (e.g. "10mb").
   */
  postRequestPayloadSize?: string | number;
  /**
   * URL path prefix appended to every registry endpoint.
   * It **must** start and end with a slash (e.g. `/`, `/components/`).
   *
   * @default "/"
   */
  prefix: string;
  /**
   * Authentication strategy for component publishing.
   */
  publishAuth?: PublishAuthConfig;
  /**
   * Custom validation logic executed during component publishing.
   */
  publishValidation: (
    pkgJson: unknown,
    context: { user?: string }
  ) =>
    | {
        isValid: boolean;
        error?: string;
      }
    | boolean;
  /**
   * Hook executed for every component request once the requested version has
   * been resolved, before the component is rendered or its info returned.
   * Return (or resolve to) a {@link ComponentRequestRejection} to reject the
   * request, or nothing to let it through. Throwing or rejecting responds with
   * a 500 error.
   *
   * @example
   * onComponentRequest: ({ version, latestVersion }) => {
   *   if (semver.major(version) < semver.major(latestVersion)) {
   *     return { status: 410, code: 'VERSION_TOO_OLD', error: `Use ${latestVersion}` };
   *   }
   * }
   */
  onComponentRequest?: ComponentRequestHook;
  /**
   * Seconds between each refresh of the internal component list cache.
   */
  refreshInterval?: number;
  /**
   * Low-level storage adapter used by the registry.
   */
  storage: {
    adapter: (options: T) => StorageAdapter;
    options: T & { componentsDir: string };
  };
  /**
   * Directory used by the registry for temporary files.
   */
  tempDir: string;
  /**
   * List of template engines available for rendering components.
   */
  templates: Template[];
  /**
   * HTTP request timeout in **milliseconds**.
   *
   * @default 120000
   */
  timeout: number;
  /**
   * Verbosity level of the console logger (0 = silent).
   *
   * @default 0
   */
  verbosity: number;
}

type CompiledTemplate = (model: unknown) => string;

interface CompilerOptions {
  componentPackage: PackageJson & {
    oc: OcConfiguration;
  };
  componentPath: string;
  minify: boolean;
  ocPackage: PackageJson;
  production: boolean;
  publishPath: string;
  verbose: boolean;
  watch: boolean;
}

export interface Template {
  compile?: (options: CompilerOptions, cb: (err: Error | null) => void) => void;
  getCompiledTemplate: (
    templateString: string,
    key: string,
    context?: Record<string, unknown>
  ) => CompiledTemplate;
  getInfo: () => TemplateInfo;
  render: (options: any, cb: (err: Error | null, data: string) => void) => void;
}

/**
 * Plugin registration function. Two forms are supported:
 *
 * - `register(options, dependencies)` returning a value or a `Promise`;
 * - the classic callback form `register(options, dependencies, next)`,
 *   detected by a declared arity of 3 or more (used by older npm plugins).
 */
export type PluginRegistration<T = any> = (
  options: T,
  dependencies: any,
  next: (error?: Error) => void
) => unknown;

interface BasePLugin<T = any> {
  description?: string;
  name: string;
  options?: T;
  register: {
    register: PluginRegistration<T>;
    dependencies?: string[];
  };
}

/**
 * The context object passed to the plugin's execute function
 */
export type PluginContext = {
  /**
   * The name of the component calling the plugin
   */
  name: string;
  /**
   * The version of the component calling the plugin
   */
  version: string;
};

export type Plugin<T = any> = BasePLugin<T> &
  (
    | {
        /**
         * When false or undefined, the plugin's execute function will be called directly.
         * The execute function should accept any parameters and return any value.
         */
        context?: false | undefined;
        register: {
          register: PluginRegistration<T>;
          execute: (...args: any[]) => any;
          dependencies?: string[];
        };
      }
    | {
        /**
         * When true, the plugin's execute function will be called with a context object containing
         * the component name and version. It should return a function that accepts parameters and returns any value.
         * @example
         * ```ts
         * {
         *   register: {
         *     execute: (...args: any[]) => any
         *   }
         * }
         * ```
         */
        context: true;
        register: {
          register: PluginRegistration<T>;
          execute: (context: PluginContext) => (params: any) => any;
          dependencies?: string[];
        };
      }
  );

export interface Plugins {
  [pluginName: string]: {
    handler: (...args: unknown[]) => void;
    description: string;
    context: boolean;
  };
}
