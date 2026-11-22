const expect = require('chai').expect;
const path = require('node:path');
const injectr = require('injectr');
const sinon = require('sinon');

const FIXTURE = path.join(__dirname, '../fixtures/components/hello-world');

describe('cli : domain : package-components', () => {
  const initialise = (component) => {
    const fsMock = {
      existsSync: sinon.stub().returns(true)
    };

    const fspMock = {
      readFile: sinon.stub().resolves(JSON.stringify(component))
    };

    const buildComponentWithViteMock = sinon
      .stub()
      .resolves({ name: 'helloworld', oc: { files: { template: {} } } });

    const PackageComponents = injectr(
      '../../dist/cli/domain/package-components.js',
      {
        'node:fs': fsMock,
        'node:fs/promises': fspMock,
        './vite-build': { buildComponentWithVite: buildComponentWithViteMock }
      }
    ).default;

    return { PackageComponents, buildComponentWithViteMock, fsMock, fspMock };
  };

  const validComponent = {
    name: 'helloworld',
    oc: {
      files: {
        template: {
          type: 'oc-template-esm',
          src: 'template.js'
        }
      }
    },
    dependencies: {}
  };

  describe('when packaging', () => {
    describe('when component package.json is missing', () => {
      it('should fail', async () => {
        const { PackageComponents, fsMock } = initialise(validComponent);
        fsMock.existsSync.returns(false);

        let error;
        try {
          await PackageComponents()({ componentPath: '/nowhere' });
        } catch (err) {
          error = err;
        }
        expect(error.message).to.equal(
          'component does not contain package.json'
        );
      });
    });

    describe('when component is valid', () => {
      it('should delegate the build to vite-build and return its result', async () => {
        const { PackageComponents, buildComponentWithViteMock } =
          initialise(validComponent);

        const result = await PackageComponents()({
          componentPath: FIXTURE,
          production: true,
          verbose: true
        });

        expect(buildComponentWithViteMock.calledOnce).to.be.true;
        const args = buildComponentWithViteMock.args[0][0];
        expect(args.componentDir).to.equal(path.resolve(FIXTURE));
        expect(args.componentPackage).to.deep.equal(validComponent);
        expect(args.production).to.equal(true);
        expect(args.verbose).to.equal(true);
        expect(result).to.deep.equal({
          name: 'helloworld',
          oc: { files: { template: {} } }
        });
      });
    });

    describe('when component name is not valid', () => {
      it('should fail before invoking the build', async () => {
        const { PackageComponents, buildComponentWithViteMock } = initialise({
          ...validComponent,
          name: 'h@lloworld'
        });

        let error;
        try {
          await PackageComponents()({ componentPath: FIXTURE });
        } catch (err) {
          error = err;
        }
        expect(error.message).to.equal('name not valid');
        expect(buildComponentWithViteMock.called).to.be.false;
      });
    });

    describe('when the vite build fails', () => {
      it('should propagate the error', async () => {
        const { PackageComponents, buildComponentWithViteMock } =
          initialise(validComponent);
        buildComponentWithViteMock.rejects(new Error('Ouch'));

        let error;
        try {
          await PackageComponents()({ componentPath: '' });
        } catch (err) {
          error = err;
        }
        expect(error.message).to.equal('Ouch');
      });
    });
  });

  describe('when packaging the real fixture component', function () {
    this.timeout(60000);

    const PackageComponents =
      require('../../dist/cli/domain/package-components.js').default;

    afterEach(async () => {
      const fsp = require('node:fs/promises');
      await fsp.rm(path.join(FIXTURE, '_package'), {
        recursive: true,
        force: true
      });
    });

    it('should produce a _package with the oc metadata', async () => {
      const component = await PackageComponents()({
        componentPath: FIXTURE,
        production: true
      });

      expect(component.name).to.equal('hello-world');
      expect(component.oc.files.template.type).to.equal('oc-template-esm');
      expect(component.oc.files.template.src).to.equal('template.js');
      expect(component.oc.files.template.hashKey).to.be.a('string');
      expect(component.oc.version).to.equal('0.50.67');
      expect(component.oc.packaged).to.equal(true);

      const fsp = require('node:fs/promises');
      const template = await fsp.readFile(
        path.join(FIXTURE, '_package/template.js'),
        'utf8'
      );
      expect(template).to.contain('hello world');
    });
  });
});
