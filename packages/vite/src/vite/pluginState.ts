import type { ResolvedConfig } from 'vite';
import type { ComponentPackage } from './packageJson.js';

/**
 * Mutable state shared between the `oc()` plugin instances. The `config`
 * hook (which runs once per build, before any plugin hook that needs it)
 * fills in the component-derived fields; the css-injection and
 * server-runtime plugins read them lazily during the build.
 */
export interface OcBuildState {
  production: boolean;
  /** Set by the config hook; `undefined` outside `vite build`. */
  componentPackage?: ComponentPackage;
  componentName: string;
  componentVersion: string;
  componentPath: string;
  publishPath: string;
  viewFileName: string;
  viewPath: string;
  viewExtension: string;
  wrapperPath: string;
  wrapperContent?: string;
  /**
   * `vite dev` only: the mount-wrapper module served by the
   * `oc-vite:dev-entry` virtual module (same `esmOCProviderTemplate`
   * output as the build wrapper, `production: false`, no styleId).
   */
  devWrapperContent?: string;
  shadowDOM?: boolean | 'open' | 'closed';
  styleId: string;
  mode: string;
  logLevel: ResolvedConfig['logLevel'];
  configFile: string | false | undefined;
  /** Raw `resolve.alias` from the user's config, stored in `oc.files.imports`. */
  alias?: unknown;
  packaged: boolean;
}

export function createOcBuildState(options: {
  production?: boolean;
}): OcBuildState {
  return {
    production: !!options.production,
    componentName: '',
    componentVersion: '',
    componentPath: '',
    publishPath: '',
    viewFileName: '',
    viewPath: '',
    viewExtension: '.js',
    wrapperPath: '',
    styleId: '',
    mode: 'production',
    logLevel: 'info',
    configFile: undefined,
    packaged: false
  };
}
