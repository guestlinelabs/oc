// Vendored from oc-client@4.0.4 (MIT License, (c) OpenComponents community).
// See LICENSE in this directory.
// @ts-nocheck
'use strict';

const templates = require('./templates');

module.exports = {
  renderedComponent: data => {
    if (!!data.name && data.renderInfo !== false) {
      data.html += templates.renderInfo(data);
    }

    if (data.container !== false) {
      data.html = templates.componentTag(data);
    }

    return data.html;
  },
  unrenderedComponent: href =>
    href ? templates.componentUnrenderedTag({ href }) : ''
};
