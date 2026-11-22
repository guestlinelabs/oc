"use strict";
// Compiled equivalent of src/components/oc-client/server.js
// (`export const data = (context, callback) => ...`), matching the
// oc-template-es6-compiler output that upstream oc@0.50.67 ships as
// dist/components/oc-client/_package/server.js. The upstream compiled
// artifact is not published to the public npm registry, so this file is
// maintained by hand in the same CommonJS shape: it runs the component's
// data function and wraps its result in the `{ component: {...} }`
// response envelope, injecting the render props the browser client needs.
// `key` must stay equal to the template hashKey in _package/package.json
// and `_componentVersion` to the OC-compatible version (0.50.67).

const data = (context, callback) => {
  const { staticPath, templates } = context;
  return callback(null, { staticPath, templates });
};

module.exports.data = function (context, callback) {
  data(context, (err, result) => {
    if (err) return callback(err);
    if (result == null) return callback(null, { __oc_emptyResponse: true });

    const props = context.action
      ? result
      : Object.assign({}, result, {
          _staticPath: context.staticPath,
          _baseUrl: context.baseUrl,
          _componentName: 'oc-client',
          _componentVersion: '0.50.67'
        });

    const staticPath =
      context.staticPath.indexOf('http') === 0
        ? context.staticPath
        : `https:${context.staticPath}`;

    return callback(
      null,
      Object.assign({}, {
        component: {
          key: 'c4abb6bf4dc6657fb718a45b64bd6b2cb92e874a',
          src: `${staticPath}template.js`,
          props,
          esm: false,
          development: undefined
        }
      })
    );
  });
};
