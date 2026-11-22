const expect = require('chai').expect;
const sinon = require('sinon');
const injectr = require('injectr');

describe('cli : facade : validate', () => {
  const fsMock = {
    existsSync: () => true
  };
  const fspMock = {
    readFile: async () =>
      JSON.stringify({
        name: 'my-component',
        version: '1.0.0',
        oc: {
          files: {
            template: {
              type: 'oc-template-es6'
            }
          }
        }
      })
  };
  const ValidateFacade = injectr('../../dist/cli/facade/validate.js', {
    'node:fs': fsMock,
    'node:fs/promises': fspMock
  }).default;
  let local;
  let registry;
  let logger;
  let validate;

  const initialise = () => {
    local = {
      package: sinon.stub(),
      cleanup: sinon.stub()
    };
    registry = {
      get: sinon.stub(),
      validateComponent: sinon.stub()
    };
    logger = {
      warn: sinon.stub(),
      ok: sinon.stub(),
      err: sinon.stub()
    };
    validate = ValidateFacade({ logger, registry, local });
  };

  const cleanup = () => {};

  describe('when validating a component', () => {
    beforeEach(() => {
      initialise();
    });

    afterEach(() => {
      cleanup();
    });

    describe('when validation succeeds', () => {
      beforeEach(async () => {
        registry.get.resolves(['http://my-registry.com/']);
        local.package.resolves({
          name: 'my-component',
          version: '1.0.0'
        });
        registry.validateComponent.resolves();
        await validate({
          componentPath: 'test/fixtures/components/hello-world/'
        });
      });

      it('should get registries', () => {
        expect(registry.get.called).to.be.true;
      });

      it('should package the component', () => {
        expect(local.package.called).to.be.true;
      });

      it('should validate against registry', () => {
        expect(registry.validateComponent.called).to.be.true;
      });

      it('should log success message', () => {
        expect(
          logger.ok.calledWith(
            '✓ Component validation completed successfully for all registries'
          )
        ).to.be.true;
      });
    });

    describe('when skipPackage option is used', () => {
      beforeEach(async () => {
        registry.get.resolves(['http://my-registry.com/']);
        registry.validateComponent.resolves();
        await validate({
          componentPath: 'test/fixtures/components/hello-world/',
          skipPackage: true
        });
      });

      it('should not package the component', () => {
        expect(local.package.called).to.be.false;
      });

      it('should validate against registry', () => {
        expect(registry.validateComponent.called).to.be.true;
      });
    });

    describe('when validation fails', () => {
      beforeEach(() => {
        registry.get.resolves(['http://my-registry.com/']);
        local.package.resolves({
          name: 'my-component',
          version: '1.0.0'
        });
        registry.validateComponent.rejects(new Error('Validation failed'));
      });

      it('should throw an error', async () => {
        try {
          await validate({
            componentPath: '/path/to/component'
          });
        } catch (err) {
          expect(err).to.contain('Validation failed for registry ');
        }
      });
    });

    describe('when multiple registries are provided', () => {
      beforeEach(async () => {
        local.package.resolves({
          name: 'my-component',
          version: '1.0.0'
        });
        registry.validateComponent.resolves();
        await validate({
          componentPath: '/path/to/component',
          registries: ['http://registry1.com/', 'http://registry2.com/']
        });
      });

      it('should not call registry.get', () => {
        expect(registry.get.called).to.be.false;
      });

      it('should validate against both registries', () => {
        expect(registry.validateComponent.callCount).to.equal(2);
      });
    });
  });
});
