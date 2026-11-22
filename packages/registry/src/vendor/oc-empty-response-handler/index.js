// Vendored from oc-empty-response-handler@1.0.2 (MIT License, (c) 2018
// OpenComponents community). See LICENSE in this directory.
// @ts-nocheck
const viewModelEmptyKey = '__oc_emptyResponse';

module.exports = {
  contextDecorator: callback => () =>
    callback(null, { [viewModelEmptyKey]: true }),
  shouldRenderAsEmpty: model => model[viewModelEmptyKey] === true,
  viewModelEmptyKey
};
