const { expect } = require('chai');
const vm = require('node:vm');
const zlib = require('node:zlib');
const {
  buildClient,
  compileClient
} = require('../../dist/registry/domain/compile-client');
const upstream = require('oc-client-browser');

// Evaluates a bundled oc-client in a minimal fake DOM and returns the
// resulting window.oc API surface for comparison. Script/link loads are
// simulated by firing onload on the next tick so oc.ready() can complete.
const evaluateClient = async (code, { conf } = {}) => {
  const fireLoad = (el) => {
    if (typeof el.onload === 'function') {
      setTimeout(() => el.onload(), 0);
    }
  };
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    URLSearchParams,
    URL,
    fetch: () => Promise.reject(new Error('fetch not available in test')),
    document: {
      currentScript: null,
      querySelectorAll: () => [],
      createElement: () => ({ setAttribute() {}, style: {} }),
      createElementNS: () => ({ setAttribute() {}, style: {} }),
      head: {
        appendChild: fireLoad,
        append: fireLoad
      },
      body: { appendChild() {} }
    },
    navigator: { userAgent: 'test' }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  if (conf) {
    sandbox.window.oc = { conf };
  }
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  // Let script loads and promise chains settle so oc.status becomes 'ready'.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { oc: sandbox.window.oc, ljs: sandbox.window.ljs };
};

const fakeTemplate = {
  getInfo: () => ({
    type: 'oc-template-fake',
    version: '9.9.9',
    externals: [
      {
        name: 'fake-lib',
        global: 'FakeLib',
        url: 'https://example.com/fake.js',
        devUrl: 'https://example.com/fake.dev.js'
      }
    ]
  }),
  render() {},
  getCompiledTemplate() {
    return () => '';
  }
};

const compileOptions = {
  templates: [fakeTemplate],
  externals: [{ global: 'Ext', url: 'https://example.com/ext.js' }],
  imports: { 'fake-pkg': 'https://esm.sh/fake-pkg' },
  retryLimit: 7,
  retryInterval: 1234,
  disableLoader: true,
  disableLegacyTemplates: true
};

const apiKeys = (oc) => Object.keys(oc).sort();

describe('registry : domain : compile-client', () => {
  describe('buildClient', () => {
    let mine;
    let upstreamCompiled;
    let upstreamOc;

    before(async () => {
      [mine, upstreamCompiled] = await Promise.all([
        buildClient(compileOptions),
        Promise.resolve(upstream.compileSync(compileOptions))
      ]);
      upstreamOc = (await evaluateClient(upstreamCompiled.dev)).oc;
    });

    it('should not leave unreplaced define placeholders', () => {
      // mine.map is excluded: it embeds sourcesContent, which legitimately
      // contains the placeholder names from the original sources. Comments
      // are stripped first because the dev bundles keep the `/* globals
      // __X__ */` pragma, `/* @__PURE__ */` annotations and esbuild's
      // `// <define:__X__>` substitution traces.
      const stripComments = (s) =>
        s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/ <define:[^\n]*/g, '');
      for (const bundle of [
        mine.code,
        mine.dev,
        upstreamCompiled.code,
        upstreamCompiled.dev
      ]) {
        expect(stripComments(bundle)).to.not.match(/__[A-Z_]+__/);
      }
    });

    it('should substitute the compile defines', () => {
      for (const bundle of [mine.code, mine.dev]) {
        expect(bundle).to.contain('oc-template-fake'); // templates
        expect(bundle).to.contain('2.1.13'); // client version
        expect(bundle).to.contain('https://example.com/ext.js'); // externals
        expect(bundle).to.contain('https://esm.sh/fake-pkg'); // imports
      }
    });

    it('should produce code, map and dev bundles', () => {
      expect(mine.code).to.be.a('string').and.not.empty;
      expect(mine.dev).to.be.a('string').and.not.empty;
      expect(mine.map).to.be.a('string').and.not.empty;
      expect(JSON.parse(mine.map).version).to.equal(3);
    });

    it('should reference the served sourcemap name', () => {
      expect(mine.code).to.contain('//# sourceMappingURL=oc-client.min.map');
      expect(upstreamCompiled.code).to.contain(
        '//# sourceMappingURL=oc-client.min.map'
      );
    });

    it('should reach ready state and expose the same oc API as upstream', async () => {
      for (const bundle of [mine.code, mine.dev]) {
        const { oc, ljs } = await evaluateClient(bundle);
        expect(oc.status).to.equal('ready');
        expect(oc.clientVersion).to.equal(upstreamOc.clientVersion);
        expect(ljs).to.exist;
        expect(apiKeys(oc)).to.deep.equal(apiKeys(upstreamOc));
      }
    });

    it('should register the same user templates as upstream', async () => {
      const { oc: mineOc } = await evaluateClient(mine.dev);
      const mineTemplates = mineOc.registerTemplates({
        type: 'probe',
        externals: []
      });
      const upstreamTemplates = upstreamOc.registerTemplates({
        type: 'probe',
        externals: []
      });

      // The fork registers its five built-in templates instead of upstream's
      // handlebars/jade/es6 set; user templates must match exactly.
      expect(mineTemplates['oc-template-fake']).to.deep.equal(
        upstreamTemplates['oc-template-fake']
      );
      expect(mineTemplates['oc-template-react'].externals).to.deep.equal([
        {
          name: 'react',
          global: 'React',
          url: 'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
          devUrl: 'https://unpkg.com/react@18.3.1/umd/react.development.js'
        },
        {
          name: 'react-dom',
          global: 'ReactDOM',
          url: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
          devUrl:
            'https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js'
        }
      ]);
      expect(Object.keys(mineTemplates).sort()).to.deep.equal([
        'oc-template-es6',
        'oc-template-esm',
        'oc-template-fake',
        'oc-template-react',
        'oc-template-solid',
        'oc-template-typescript-react',
        'probe'
      ]);
    });

    it('should behave the same for an unknown template type', async () => {
      const { oc } = await evaluateClient(mine.dev);
      const err = await new Promise((resolve) =>
        oc.render({ type: 'does-not-exist' }, {}, resolve)
      );
      expect(err).to.equal(
        'Error loading component: view engine "does-not-exist" not supported'
      );
    });

    it('should honour oc.conf overrides like upstream', async () => {
      const conf = { debug: true, retryLimit: 3, tag: 'my-tag' };
      const { oc: mineOc } = await evaluateClient(mine.dev, { conf });
      const { oc: upstreamOcWithConf } = await evaluateClient(
        upstreamCompiled.dev,
        { conf }
      );
      expect(mineOc.conf).to.deep.equal(upstreamOcWithConf.conf);
      expect(apiKeys(mineOc)).to.deep.equal(apiKeys(upstreamOcWithConf));
    });

    it('should keep the dynamic import() for esm components', () => {
      expect(mine.dev).to.contain('import(data.component.src)');
      expect(mine.code).to.contain('import(');
    });
  });

  describe('compileClient', () => {
    it('should populate conf.compiledClient with compressed bundles', async () => {
      const conf = {
        local: false,
        templates: [fakeTemplate],
        compileClient: { imports: { x: 'y' }, retryLimit: 5 }
      };
      await compileClient(conf);

      expect(conf.compiledClient).to.exist;
      expect(conf.compiledClient.imports).to.deep.equal({ x: 'y' });
      expect(conf.compiledClient.code.minified).to.be.a('string');
      expect(conf.compiledClient.code.gzip).to.be.instanceOf(Buffer);
      expect(conf.compiledClient.code.brotli).to.be.instanceOf(Buffer);
      expect(conf.compiledClient.dev).to.be.a('string');
      expect(conf.compiledClient.map).to.be.a('string');
      // gzip/brotli must decompress to the minified bundle
      expect(
        zlib.gunzipSync(conf.compiledClient.code.gzip).toString()
      ).to.equal(conf.compiledClient.code.minified);
      expect(
        zlib.brotliDecompressSync(conf.compiledClient.code.brotli).toString()
      ).to.equal(conf.compiledClient.code.minified);
    });

    it('should be a no-op when compileClient is false', async () => {
      const conf = { local: false, templates: [], compileClient: false };
      await compileClient(conf);
      expect(conf.compiledClient).to.equal(undefined);
    });

    it('should register built-in templates in the bundle', async () => {
      const conf = { local: false, templates: [], compileClient: true };
      await compileClient(conf);
      const { oc } = await evaluateClient(conf.compiledClient.dev);
      const registered = oc.registerTemplates({ type: 'probe', externals: [] });
      expect(registered['oc-template-es6']).to.exist;
      expect(registered['oc-template-esm']).to.exist;
      expect(registered['oc-template-solid']).to.exist;
    });
  });
});
