const expect = require('chai').expect;
const injectr = require('injectr');
const sinon = require('sinon');

describe('utils : npm-utils', () => {
  const crossSpawnStub = sinon.stub();

  const npmUtils = injectr(
    '../../dist/utils/npm-utils.js',
    {
      'node:path': { join: (...items) => items.join('/') }
    },
    { Bun: { spawn: crossSpawnStub } }
  );

  const installPath = 'path/to/component';
  const initPath = installPath;

  describe('init()', () => {
    const scenarios = [
      {
        input: { initPath },
        output: ['init', '--yes', '--no-package-lock'],
        cmdCall: { cwd: initPath, stdio: ['inherit', 'inherit', 'inherit'] }
      },
      {
        input: { initPath, silent: true },
        output: ['init', '--yes', '--no-package-lock'],
        cmdCall: { cwd: initPath, stdio: ['ignore', 'ignore', 'ignore'] }
      }
    ];

    for (const scenario of scenarios) {
      const { initPath, silent } = scenario.input;
      describe(`when invoked for ${initPath} with silent=${silent}`, () => {
        let error;
        beforeEach((done) => {
          crossSpawnStub.reset();
          crossSpawnStub.returns({ exited: Promise.resolve(0) });
          npmUtils
            .init(scenario.input)
            .catch((err) => {
              error = err;
            })
            .finally(done);
        });

        it('should spawn the process with correct parameters', () => {
          expect(crossSpawnStub.args[0][0]).to.deep.equal([
            'npm',
            ...scenario.output
          ]);
          expect(crossSpawnStub.args[0][1]).to.deep.equal(scenario.cmdCall);
        });

        it('should return no error', () => {
          expect(error).to.be.undefined;
        });

        it('should wait for the process to exit', () => {
          expect(crossSpawnStub.calledOnce).to.be.true;
        });
      });
    }
  });

  describe('installDependency()', () => {
    const scenarios = [
      {
        input: {
          dependency: 'oc-template-es6-compiler',
          installPath,
          isDev: true,
          save: true
        },
        output: [
          'install',
          '--save-exact',
          '--save-dev',
          'oc-template-es6-compiler',
          '--no-package-lock'
        ]
      },
      {
        input: {
          dependency: 'lodash',
          installPath,
          isDev: true,
          save: false
        },
        output: ['install', '--no-save', 'lodash', '--no-package-lock']
      },
      {
        input: {
          dependency: 'underscore',
          installPath,
          isDev: false,
          save: true
        },
        output: [
          'install',
          '--save-exact',
          '--save',
          'underscore',
          '--no-package-lock'
        ]
      },
      {
        input: { dependency: 'oc-client@~1.2.3', installPath, save: false },
        output: [
          'install',
          '--no-save',
          'oc-client@~1.2.3',
          '--no-package-lock'
        ]
      }
    ];

    for (const scenario of scenarios) {
      const dependency = scenario.input.dependency;
      describe(`when invoked for installing ${dependency}`, () => {
        let error;
        let result;
        beforeEach((done) => {
          crossSpawnStub.reset();
          crossSpawnStub.returns({ exited: Promise.resolve(0) });
          npmUtils
            .installDependency(scenario.input)
            .then((res) => {
              result = res;
            })
            .catch((err) => {
              error = err;
            })
            .finally(done);
        });

        it('should spawn the process with correct parameters', () => {
          expect(crossSpawnStub.args[0][0]).to.deep.equal([
            'npm',
            ...scenario.output
          ]);
          expect(crossSpawnStub.args[0][1]).to.deep.equal({
            cwd: installPath,
            stdio: ['inherit', 'inherit', 'inherit']
          });
        });

        it('should return no error', () => {
          expect(error).to.be.undefined;
        });

        it('should return the installation path', () => {
          expect(result).to.deep.equal({
            dest: `path/to/component/node_modules/${dependency.split('@')[0]}`
          });
        });

        it('should wait for the process to exit', () => {
          expect(crossSpawnStub.calledOnce).to.be.true;
        });
      });
    }
  });

  describe('installDependencies()', () => {
    const scenarios = [
      {
        input: {
          dependencies: ['oc-template-es6-compiler', 'lodash'],
          installPath,
          isDev: true,
          save: true
        },
        output: [
          'install',
          '--save-exact',
          '--save-dev',
          'oc-template-es6-compiler',
          'lodash',
          '--no-package-lock'
        ]
      },
      {
        input: {
          dependencies: ['moment', 'lodash'],
          installPath,
          isDev: true,
          save: false
        },
        output: [
          'install',
          '--no-save',
          'moment',
          'lodash',
          '--no-package-lock'
        ]
      },
      {
        input: {
          dependencies: ['underscore', 'oc-client'],
          installPath,
          isDev: false,
          save: true
        },
        output: [
          'install',
          '--save-exact',
          '--save',
          'underscore',
          'oc-client',
          '--no-package-lock'
        ]
      },
      {
        input: {
          dependencies: ['oc-client@~1.2.3', 'oc-template-react-compiler'],
          installPath,
          save: false
        },
        output: [
          'install',
          '--no-save',
          'oc-client@~1.2.3',
          'oc-template-react-compiler',
          '--no-package-lock'
        ]
      }
    ];

    for (const scenario of scenarios) {
      const dependencies = scenario.input.dependencies;
      describe(`when invoked for installing [${dependencies.join(
        ', '
      )}]`, () => {
        let error;
        let result;
        beforeEach((done) => {
          crossSpawnStub.reset();
          crossSpawnStub.returns({ exited: Promise.resolve(0) });
          npmUtils
            .installDependencies(scenario.input)
            .then((res) => {
              result = res;
            })
            .catch((err) => {
              error = err;
            })
            .finally(done);
        });

        it('should spawn the process with correct parameters', () => {
          expect(crossSpawnStub.args[0][0]).to.deep.equal([
            'npm',
            ...scenario.output
          ]);
          expect(crossSpawnStub.args[0][1]).to.deep.equal({
            cwd: installPath,
            stdio: ['inherit', 'inherit', 'inherit']
          });
        });

        it('should return no error', () => {
          expect(error).to.be.undefined;
        });

        it('should return the installation path', () => {
          expect(result).to.deep.equal({
            dest: dependencies.map(
              (dependency) =>
                `path/to/component/node_modules/${dependency.split('@')[0]}`
            )
          });
        });

        it('should wait for the process to exit', () => {
          expect(crossSpawnStub.calledOnce).to.be.true;
        });
      });
    }
  });

  describe('when the npm process fails', () => {
    it('should reject with the exit code on non-zero exit', async () => {
      crossSpawnStub.reset();
      crossSpawnStub.returns({ exited: Promise.resolve(1) });

      let error;
      try {
        await npmUtils.init({ initPath, silent: true });
      } catch (err) {
        error = err;
      }
      expect(error).to.equal(1);
    });

    it('should reject when the process cannot be spawned', async () => {
      crossSpawnStub.reset();
      crossSpawnStub.throws(new Error('ENOENT'));

      let error;
      try {
        await npmUtils.init({ initPath, silent: true });
      } catch (err) {
        error = err;
      }
      expect(error.message).to.equal('error');
    });
  });
});
