const removeExtension = (path: string) => path.replace(/\.(j|t)sx?$/, '');

/**
 * Higher-order wrapper around the component's data provider, producing the
 * `data` export the OC registry executes. Ported from
 * `oc-vite-compiler@6.0.4` `serverWrapper.ts`.
 *
 * Intentional difference: upstream detects the entry's exports with
 * `es-module-lexer` and emits either `import { server }` or
 * `import { data }`. We import the entry as a namespace and pick `server`
 * when present instead — no lexer dependency, and it also resolves
 * re-exported (`export { server } from ...`, `export * from ...`) entries.
 */
export type ServerWrapper = (options: {
  exports?: string[];
  serverPath: string;
  componentName: string;
  componentVersion: string;
  bundleHashKey: string;
  esm?: boolean;
  production: boolean;
}) => string;

const higherOrderServerTemplate: ServerWrapper = ({
  serverPath,
  componentName,
  componentVersion,
  bundleHashKey,
  production,
  esm = true
}) => {
  return `
import * as __oc_server_module__ from '${removeExtension(serverPath)}';

const __oc_server_export__ = Reflect.get(__oc_server_module__, 'server');
const __oc_data_export__ = Reflect.get(__oc_server_module__, 'data');
const dataProvider = __oc_server_export__
  ? __oc_server_export__.getData()
  : __oc_data_export__;

export const server = __oc_server_export__;

export const data = (context : any, callback : (error: any, data?: any) => void) => {
  dataProvider(context, (error: any, model: any, meta: any = {}) => {
    if (error) {
      return callback(error);
    }
    if (model == null) return callback(null, { __oc_emptyResponse: true });

    const props = context.action
      ? model
      : Object.assign({}, model, {
          _staticPath: context.staticPath,
          _baseUrl: context.baseUrl,
          _componentName: "${componentName}",
          _componentVersion: "${componentVersion}"
        });

    const srcPathHasProtocol = context.staticPath.indexOf("http") === 0;
    const srcPath = srcPathHasProtocol ? context.staticPath : ("https:" + context.staticPath);
    return callback(null, Object.assign({}, {
      component: {
        key: "${bundleHashKey}",
        src: srcPath + "template.js",
        props,
        esm: ${esm},
        development: ${production ? 'undefined' : 'meta'}
      }
    }));
  });
}
`;
};

export default higherOrderServerTemplate;
