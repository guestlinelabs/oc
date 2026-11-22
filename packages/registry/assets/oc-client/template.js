var oc=oc||{};oc.components=oc.components||{};oc.components['c4abb6bf4dc6657fb718a45b64bd6b2cb92e874a']=function(model) {
           var __toOcStaticPathUrl = function(args) {
             return model.component.props._staticPath + 'src/' + args;
           } 
           const { _staticPath, _baseUrl, _componentName, _componentVersion, ...rest } = model.component.props;
           var __$$oc_initialData__ = rest;
           
           var element = model.element || typeof document !== 'undefined' ? document.querySelector(window.oc.conf.tag || 'oc-component' + '[data-id="'+ model.id +'"]') : null;
           var __$$oc_Settings__ = {id: model.id, element: element, staticPath: _staticPath, baseUrl: _baseUrl, name: _componentName, version: _componentVersion};
           var innerFn = function(model){
  oc.es6Components = oc.es6Components || {};
  oc.es6Components['c4abb6bf4dc6657fb718a45b64bd6b2cb92e874a'] = (
           (function() {
            var clientBundle=(function(){"use strict";const n=({templates:c,staticPath:t})=>`<script>window.oc=window.oc||{};oc.conf=oc.conf||{};oc.conf.templates=(oc.conf.templates||[]).concat(${JSON.stringify(c)});<\/script><script src="${t}src/oc-client.min.js" type="text/javascript"><\/script>`;function e(c,t){const{_staticPath:o,_baseUrl:i,_componentName:r,_componentVersion:s,...a}=c;t.innerHTML=n(c)}return e})();

            return clientBundle;
           })());
  if (!model) return;
  var modelHTML =  model.__html ? model.__html : '';
  var ssr = !!modelHTML;
  var externals = [];
  var staticPath = model.component.props._staticPath;
  var props = JSON.stringify(model.component.props);
  oc = oc || {};
  oc.__es6Template = oc.__es6Template || { count: 0 };
  oc.__data = oc.__data || {};
  oc.__data[model.id] = model.component.props;
  var count = oc.__es6Template.count;
  var templateId = "oc-es6Root-oc-client-" + count;
  oc.__es6Template.count++;
  var renderScript = '<script>' +
    'oc = oc || {};' +
    'oc.cmd = oc.cmd || [];' +
    'oc.cmd.push(function(oc){' +
    '' +
      'oc.requireSeries(' + JSON.stringify(externals) + ', function(){' +
        'var targetNode = document.getElementById("' + model.id + '");' +
        'oc.components["c4abb6bf4dc6657fb718a45b64bd6b2cb92e874a"]({ id: "' + model.id + '", component: { props: oc.__data["' + model.id + '"]} });' +
        'oc.es6Components["c4abb6bf4dc6657fb718a45b64bd6b2cb92e874a"](oc.__data["' + model.id + '"], targetNode, ' + !!modelHTML  + ');' +
      '});' +
    '});' +
  '</script>';
  var wrappedHtml = '<div id="' + templateId + '" class="oc-es6Root-oc-client">' + modelHTML + '</div>';

  return modelHTML +
    '' +
    (ssr ? '' : renderScript)
};
           return innerFn(model);
         }
         