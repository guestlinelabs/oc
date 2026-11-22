const expect = require('chai').expect;
const injectr = require('injectr');
const sinon = require('sinon');

describe('cli : domain : vite-build', () => {
  const COMPONENT_DIR = '/path/to/component';
  const PUBLISH_PATH = '/path/to/component/_package';

  const esmComponentPackage = {
    name: 'my-component',
    oc: { files: { template: { type: 'oc-template-esm', src: 'template.js' } } }
  };

  const initialise = ({ componentPackage, vite } = {}) => {
    const pkg = componentPackage || esmComponentPackage;
    const fsMock = {
      existsSync: sinon.stub().returns(true)
    };
    const fspMock = {
      rm: sinon.stub().resolves(),
      mkdir: sinon.stub().resolves(),
      readFile: sinon.stub().resolves(JSON.stringify({ name: 'packaged' }))
    };
    const loadViteMock = vite
      ? sinon.stub().resolves(vite)
      : sinon.stub().rejects(new Error('vite is not installed'));

    const buildComponentWithVite = injectr(
      '../../dist/cli/domain/vite-build.js',
      {
        'node:fs': fsMock,
        'node:fs/promises': fspMock,
        './load-vite': { loadVite: loadViteMock }
      }
    ).buildComponentWithVite;

    return {
      buildComponentWithVite,
      componentPackage: pkg,
      fsMock,
      fspMock,
      loadViteMock
    };
  };

  const fakeVite = ({ configFile, plugins, build } = {}) => ({
    resolveConfig: sinon.stub().resolves({
      configFile:
        configFile === undefined
          ? '/path/to/component/vite.config.js'
          : configFile,
      plugins: plugins || [{ name: 'guestlinelabs-oc-vite' }]
    }),
    build: build || sinon.stub().resolves()
  });

  const run = (buildComponentWithVite, options = {}) =>
    buildComponentWithVite({
      componentDir: COMPONENT_DIR,
      ...options,
      componentPackage: options.componentPackage || esmComponentPackage
    });

  describe('when the template type is not oc-template-esm', () => {
    it('should fail with the old-template migration message', async () => {
      const oldTemplatePackage = {
        name: 'my-component',
        oc: { files: { template: { type: 'oc-template-react' } } }
      };
      const { buildComponentWithVite, loadViteMock } = initialise({
        componentPackage: oldTemplatePackage,
        vite: fakeVite()
      });

      let error;
      try {
        await run(buildComponentWithVite, {
          componentPackage: oldTemplatePackage
        });
      } catch (err) {
        error = err;
      }

      expect(error.message).to.contain('oc-template-esm');
      expect(error.message).to.contain('upstream "oc" CLI');
      expect(error.message).to.contain('@guestlinelabs/oc-vite');
      expect(loadViteMock.called).to.be.false;
    });
  });

  describe('when vite is not installed in the component', () => {
    it('should fail with a clear message', async () => {
      const { buildComponentWithVite } = initialise();

      let error;
      try {
        await run(buildComponentWithVite);
      } catch (err) {
        error = err;
      }

      expect(error.message).to.contain('"vite" is not installed');
      expect(error.message).to.contain(COMPONENT_DIR);
    });
  });

  describe('when no vite config exists', () => {
    it('should fail with a clear message', async () => {
      const vite = fakeVite();
      vite.resolveConfig.resolves({ configFile: undefined, plugins: [] });
      const { buildComponentWithVite } = initialise({ vite });

      let error;
      try {
        await run(buildComponentWithVite);
      } catch (err) {
        error = err;
      }

      expect(error.message).to.contain('no vite config found');
    });
  });

  describe('when the vite config lacks the oc() plugin', () => {
    it('should fail with a clear message', async () => {
      const { buildComponentWithVite } = initialise({
        vite: fakeVite({ plugins: [{ name: 'vite:css' }] })
      });

      let error;
      try {
        await run(buildComponentWithVite);
      } catch (err) {
        error = err;
      }

      expect(error.message).to.contain('does not include the oc() plugin');
      expect(error.message).to.contain('@guestlinelabs/oc-vite');
    });
  });

  describe('when the vite config cannot be loaded', () => {
    it('should fail with a clear message', async () => {
      const vite = fakeVite();
      vite.resolveConfig.rejects(new Error('boom'));
      const { buildComponentWithVite } = initialise({ vite });

      let error;
      try {
        await run(buildComponentWithVite);
      } catch (err) {
        error = err;
      }

      expect(error.message).to.contain('failed to load the component');
      expect(error.message).to.contain('boom');
    });
  });

  describe('when the build succeeds', () => {
    it('should run vite build in production mode by default options and return the packaged component', async () => {
      const vite = fakeVite();
      const { buildComponentWithVite, fspMock } = initialise({ vite });

      const result = await run(buildComponentWithVite, { production: true });

      expect(vite.build.calledOnce).to.be.true;
      expect(vite.build.args[0][0]).to.deep.equal({
        root: COMPONENT_DIR,
        configFile: '/path/to/component/vite.config.js',
        mode: 'production',
        logLevel: 'silent'
      });
      expect(fspMock.rm.calledWith(PUBLISH_PATH)).to.be.true;
      expect(result).to.deep.equal({ name: 'packaged' });
    });

    it('should use development mode and info logging when not production and verbose', async () => {
      const vite = fakeVite();
      const { buildComponentWithVite } = initialise({ vite });

      await run(buildComponentWithVite, { verbose: true });

      expect(vite.build.args[0][0].mode).to.equal('development');
      expect(vite.build.args[0][0].logLevel).to.equal('info');
    });

    it('should fail when _package/package.json was not produced', async () => {
      const vite = fakeVite();
      const { buildComponentWithVite, fsMock } = initialise({ vite });
      fsMock.existsSync.returns(false);

      let error;
      try {
        await run(buildComponentWithVite);
      } catch (err) {
        error = err;
      }

      expect(error.message).to.contain('did not produce');
    });
  });
});
