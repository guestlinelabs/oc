const expect = require('chai').expect;

// The built artifact assembled by tasks/build.js from
// assets/oc-client — the same file the registry publishes to storage as
// components/oc-client/<version>/server.js and runs for `oc-client`
// component requests. Its behaviour must match the oc-template-es6-compiler
// output upstream oc@0.50.67 ships in dist/components/oc-client/_package.
const ocClientServer = require('../../dist/components/oc-client/_package/server.js');

const STATIC_PATH =
  'https://cdn.example.com/oc-public/components/oc-client/0.50.67/';
const BASE_URL = 'https://registry.example.com/registry/';
const TEMPLATE_KEY = 'c4abb6bf4dc6657fb718a45b64bd6b2cb92e874a';

const callData = (context) =>
  new Promise((resolve, reject) => {
    ocClientServer.data(context, (err, result) =>
      err ? reject(err) : resolve(result)
    );
  });

describe('oc-client : data provider', () => {
  it('wraps the data result in the component response envelope', async () => {
    const templates = { 'oc-template-es6': { externals: [] } };
    const result = await callData({
      staticPath: STATIC_PATH,
      baseUrl: BASE_URL,
      templates
    });

    expect(result).to.have.property('component');
    const { component } = result;
    expect(component.key).to.equal(TEMPLATE_KEY);
    expect(component.src).to.equal(`${STATIC_PATH}template.js`);
    expect(component.esm).to.be.false;
    expect(component.props).to.deep.include({
      staticPath: STATIC_PATH,
      templates,
      _staticPath: STATIC_PATH,
      _baseUrl: BASE_URL,
      _componentName: 'oc-client',
      _componentVersion: '0.50.67'
    });
  });

  it('prefixes a protocol-relative staticPath with https:', async () => {
    const result = await callData({
      staticPath: '//cdn.example.com/oc-public/components/oc-client/0.50.67/',
      baseUrl: BASE_URL,
      templates: {}
    });

    expect(result.component.src).to.equal(
      'https://cdn.example.com/oc-public/components/oc-client/0.50.67/template.js'
    );
  });

  it('does not inject render props for actions', async () => {
    const result = await callData({
      action: 'ping',
      staticPath: STATIC_PATH,
      baseUrl: BASE_URL,
      templates: {}
    });

    expect(result.component.props).to.not.have.property('_staticPath');
    expect(result.component.props).to.not.have.property('_componentName');
  });

  it('passes staticPath and templates through into props', async () => {
    const result = await callData({
      staticPath: STATIC_PATH,
      baseUrl: BASE_URL,
      templates: { t: 1 }
    });
    expect(result.component.props.staticPath).to.equal(STATIC_PATH);
    expect(result.component.props.templates).to.deep.equal({ t: 1 });
  });
});
