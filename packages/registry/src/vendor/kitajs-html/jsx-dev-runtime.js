// Vendored from @kitajs/html@4.2.13 (MIT License, (c) Kita). See LICENSE
// in this directory. Only the runtime files used by the registry's JSX
// views are vendored (index, jsx-runtime, jsx-dev-runtime); the emitted
// `require("@kitajs/html...")` specifiers are rewritten to these files by
// tasks/build.js.
// @ts-nocheck

const { Fragment, jsx, jsxs } = require('./jsx-runtime');

exports.jsx = jsx;
exports.jsxs = jsxs;
exports.jsxDEV = jsx;
exports.Fragment = Fragment;
