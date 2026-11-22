const coreModules =
  require('@guestlinelabs/oc-registry/utils/core-modules').default;
const expect = require('chai').expect;
const injectr = require('injectr');
const sinon = require('sinon');

describe('cli : domain : handle-dependencies', () => {
  describe('happy path', () => {
    const components = {
      '/path/to/components/esm': {
        name: 'esm',
        oc: { files: { template: { type: 'oc-template-esm' } } },
        dependencies: { lodash: '1.2.3' }
      },
      '/path/to/components/react': {
        name: 'react',
        oc: { files: { template: { type: 'oc-template-esm' } } },
        dependencies: { moment: '2.x.x', lodash: '4.0.0' }
      },
      '/path/to/components/nodeps': {
        name: 'nodeps',
        oc: { files: { template: { type: 'oc-template-esm' } } }
      }
    };

    let logger;
    let spies;
    let error;
    let result;
    let handleDependencies;
    beforeEach(() => {
      spies = {
        installMissingDependencies: sinon.spy()
      };

      handleDependencies = injectr(
        '../../dist/cli/domain/handle-dependencies/index.js',
        {
          'node:fs/promises': {
            readFile: (path) =>
              Promise.resolve(
                JSON.stringify(components[path.replace('/package.json', '')])
              )
          },
          'node:path': { join: (...args) => args.join('/') },
          './install-missing-dependencies': (options) => {
            spies.installMissingDependencies(options);
            return Promise.resolve();
          }
        }
      ).default;

      logger = {
        fail: sinon.spy(),
        ok: sinon.spy(),
        warn: sinon.spy()
      };
    });

    describe('when packaging', () => {
      beforeEach((done) => {
        handleDependencies({
          components: Object.keys(components),
          logger,
          install: true
        })
          .then((res) => {
            result = res;
          })
          .catch((err) => {
            error = err;
          })
          .finally(done);
      });

      it('should return no error', () => {
        expect(error).to.be.undefined;
      });

      it('should return modules plus the node.js core modules', () => {
        expect(result.modules).to.deep.equal(
          [...coreModules, ...['lodash', 'moment']].sort()
        );
      });

      it('should return no templates (built-in registry templates only)', () => {
        expect(result.templates).to.deep.equal([]);
      });

      it('should log progress', () => {
        expect(logger.warn.args[0][0]).to.equal(
          'Ensuring dependencies are loaded...'
        );
      });

      it('should install the dependencies if missing', () => {
        const args = spies.installMissingDependencies.args;
        expect(args.length).to.equal(1);
        expect(args[0][0].dependencies).to.deep.equal({
          lodash: '4.0.0',
          moment: '2.x.x'
        });
      });
    });

    describe('when in dev mode', () => {
      beforeEach((done) => {
        handleDependencies({
          components: Object.keys(components),
          logger,
          install: false
        })
          .then((res) => {
            result = res;
          })
          .catch((err) => {
            error = err;
          })
          .finally(done);
      });

      it('should not install the dependencies if missing', () => {
        const args = spies.installMissingDependencies.args;
        expect(args).to.deep.equal([]);
      });
    });
  });
});
