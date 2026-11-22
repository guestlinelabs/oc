const expect = require('chai').expect;
const injectr = require('injectr');
const sinon = require('sinon');

describe('registry', () => {
  const repositoryInitStub = sinon.stub();
  let server;

  const createServer = () => ({
    app: { get: sinon.stub(), post: sinon.stub(), onRequest: sinon.stub() },
    listen: sinon.stub(),
    onServerError: sinon.stub(),
    httpServer: sinon.stub().returns('server instance'),
    isListening: sinon.stub().returns(false),
    close: sinon.stub()
  });

  const deps = {
    './app-start': sinon.stub(),
    './domain/compile-client': { compileClient: sinon.stub().resolves() },
    './domain/events-handler': { fire: sinon.stub() },
    './domain/http-server/server': {
      createHttpServer: sinon.stub().callsFake(() => {
        server = createServer();
        return server;
      })
    },
    './middleware': {
      bind: sinon.stub().callsFake((httpServer) => httpServer)
    },
    './domain/plugins-initialiser': { init: sinon.stub() },
    './domain/repository': sinon.stub().returns({
      init: repositoryInitStub,
      close: sinon.stub().resolves()
    }),
    './router': { create: sinon.stub() },
    './domain/options-sanitiser': sinon.stub(),
    './domain/validators': {
      validateRegistryConfiguration: sinon.stub()
    }
  };

  const Registry = injectr('../../dist/registry/index.js', deps).default;

  const sanitisedOptions = () => ({
    port: 3000,
    timeout: 120000
  });

  describe('when instanciated', () => {
    describe('when options are not valid', () => {
      let init;
      beforeEach(() => {
        deps['./domain/validators'].validateRegistryConfiguration.returns({
          isValid: false,
          message: 'blargh'
        });
        init = () => {
          Registry({});
        };
      });

      it('should throw an error', () => {
        expect(init).to.throw('blargh');
      });
    });

    describe('when options are valid', () => {
      let registry;
      beforeEach(() => {
        deps['./domain/validators'].validateRegistryConfiguration.returns({
          isValid: true
        });
        deps['./domain/options-sanitiser'].returns(sanitisedOptions());
        registry = Registry({});
      });

      it('should create the HTTP server', () => {
        expect(deps['./domain/http-server/server'].createHttpServer.called).to
          .be.true;
      });

      it('should bind the middleware', () => {
        const bind = deps['./middleware'].bind;
        expect(bind.called).to.be.true;
        expect(bind.lastCall.args[0]).to.equal(server);
        expect(bind.lastCall.args[1]).to.eql(sanitisedOptions());
      });

      it('should expose the host app router', () => {
        expect(registry.app).to.equal(server.app);
      });

      it('should instanciate the repository', () => {
        expect(deps['./domain/repository'].called).to.be.true;
      });

      it('should register a plugin using a promise', async () => {
        await registry.register({ name: 'test-plugin' });

        deps['./domain/plugins-initialiser'].init.resolves({});
        repositoryInitStub.resolves();
        deps['./app-start'].resolves();
        server.listen.resolves();

        await registry.start();

        expect(
          deps['./domain/plugins-initialiser'].init.lastCall.args[0][0].name
        ).to.equal('test-plugin');
      });

      describe('when starting it', () => {
        describe('when plugins initialiser fails', () => {
          let error;
          beforeEach(async () => {
            deps['./domain/plugins-initialiser'].init.rejects(
              new Error('error!')
            );
            try {
              await registry.start();
            } catch (err) {
              error = err;
            }
          });

          it('should fail with error', () => {
            expect(error.message).to.equal('error!');
          });

          it('should reject the promise with an Error', async () => {
            const newRegistry = Registry({});

            let error;
            try {
              await newRegistry.start();
            } catch (err) {
              error = err;
            }

            expect(error.name).to.equal('Error');
            expect(error.message).to.equal('error!');
          });
        });

        describe('when plugins initialiser succeeds', () => {
          describe('when repository initialisation fails', () => {
            let error;
            beforeEach(async () => {
              deps['./domain/plugins-initialiser'].init.resolves('ok');
              repositoryInitStub.rejects(new Error('nope'));

              try {
                await registry.start();
              } catch (err) {
                error = err;
              }
            });

            it('should fail with error', () => {
              expect(error.message).to.equal('nope');
            });
          });

          describe('when repository initialisation succeeds', () => {
            describe('when app fails to start', () => {
              let error;
              beforeEach(async () => {
                deps['./domain/plugins-initialiser'].init.resolves('ok');
                repositoryInitStub.resolves('ok');
                deps['./app-start'].rejects({ msg: 'I got a problem' });

                try {
                  await registry.start();
                } catch (err) {
                  error = err;
                }
              });

              it('should fail with error', () => {
                expect(error.name).to.equal('Error');
                expect(error.message).to.equal('I got a problem');
              });
            });

            describe('when app starts', () => {
              describe('when http listener errors', () => {
                let error;
                beforeEach(async () => {
                  deps['./domain/plugins-initialiser'].init.resolves('ok');
                  repositoryInitStub.resolves('ok');
                  deps['./app-start'].resolves('ok');

                  server.listen.rejects(new Error('Port is already used'));

                  try {
                    await registry.start();
                  } catch (err) {
                    error = err;
                  }
                });

                it('should fail with error', () => {
                  expect(error.name).to.equal('Error');
                  expect(error.message).to.equal('Port is already used');
                });
              });

              describe('when http listener succeeds', () => {
                let error;
                let result;
                beforeEach(async () => {
                  deps['./domain/plugins-initialiser'].init.resolves('ok');
                  repositoryInitStub.resolves('ok');
                  deps['./app-start'].resolves('ok');
                  deps['./domain/events-handler'].fire = sinon.stub();

                  server.listen.resolves();

                  try {
                    result = await registry.start();
                  } catch (err) {
                    error = err;
                  }
                });

                it('should not return error', () => {
                  expect(error).to.be.undefined;
                });

                it('should return the app and server', () => {
                  expect(result.app).to.equal(server.app);
                  expect(result.server).to.equal('server instance');
                });

                it('should listen with the configured options', () => {
                  expect(
                    server.listen.calledWith({
                      port: 3000,
                      timeout: 120000
                    })
                  ).to.be.true;
                });

                it('should emit a start event', () => {
                  expect(deps['./domain/events-handler'].fire.args[0]).to.eql([
                    'start',
                    {}
                  ]);
                });

                it('should resolve with the app and server', async () => {
                  const newRegistry = Registry({});
                  server.listen.resolves();

                  const result = await newRegistry.start();

                  expect(result).to.eql({
                    app: server.app,
                    server: 'server instance'
                  });
                });
              });

              describe('when http listener emits an error before the listener to start', () => {
                let error;
                beforeEach(async () => {
                  deps['./domain/plugins-initialiser'].init.resolves('ok');
                  repositoryInitStub.resolves('ok');
                  deps['./app-start'].resolves('ok');
                  deps['./domain/events-handler'].fire = sinon.stub();

                  server.listen.callsFake(() => new Promise(() => {}));
                  server.onServerError.callsFake((cb) =>
                    cb(new Error('I failed for some reason'))
                  );

                  try {
                    await registry.start();
                  } catch (err) {
                    error = err;
                  }
                });

                it('should return error', () => {
                  expect(error.name).to.equal('Error');
                  expect(error.message).to.equal('I failed for some reason');
                });

                it('should emit an error event', () => {
                  expect(deps['./domain/events-handler'].fire.args[0]).to.eql([
                    'error',
                    {
                      code: 'SERVER_ERROR',
                      message: 'I failed for some reason'
                    }
                  ]);
                });
              });

              describe('when the HTTP server emits an error', () => {
                it('should emit SERVER_ERROR for server errors', async () => {
                  deps['./domain/plugins-initialiser'].init.resolves('ok');
                  repositoryInitStub.resolves('ok');
                  deps['./app-start'].resolves('ok');
                  deps['./domain/events-handler'].fire = sinon.stub();

                  const newRegistry = Registry({});
                  const serverError = new Error('server failed');
                  server.listen.callsFake(() => new Promise(() => {}));
                  server.onServerError.callsFake((cb) => cb(serverError));

                  let rejectedError;
                  try {
                    await newRegistry.start();
                  } catch (error) {
                    rejectedError = error;
                  }

                  expect(rejectedError.name).to.equal('Error');
                  expect(rejectedError.message).to.equal('server failed');
                  expect(
                    deps['./domain/events-handler'].fire.calledWith('error', {
                      code: 'SERVER_ERROR',
                      message: 'server failed'
                    })
                  ).to.be.true;
                });
              });
            });
          });
        });
      });

      describe('when closing it', () => {
        let repositoryCloseStub;

        beforeEach(() => {
          repositoryCloseStub = sinon.stub().resolves();
          deps['./domain/repository'].returns({
            init: repositoryInitStub,
            close: repositoryCloseStub
          });
          deps['./domain/validators'].validateRegistryConfiguration.returns({
            isValid: true
          });
          deps['./domain/options-sanitiser'].returns(sanitisedOptions());
          deps['./domain/plugins-initialiser'].init.resolves({});
          deps['./app-start'].resolves();
          repositoryInitStub.resolves();
        });

        it('should close the repository when the server is not listening', async () => {
          const registry = Registry({});

          let error;
          try {
            await registry.close();
          } catch (err) {
            error = err;
          }

          expect(error).to.equal('not opened');
          expect(repositoryCloseStub.calledOnce).to.be.true;
        });

        it('should close the server then the repository when listening', async () => {
          const registry = Registry({});
          server.listen.resolves();
          server.isListening.returns(true);
          server.close.resolves();

          await registry.start();
          await registry.close();

          expect(server.close.calledOnce).to.be.true;
          expect(repositoryCloseStub.calledOnce).to.be.true;
          expect(repositoryCloseStub.calledAfter(server.close)).to.be.true;
        });

        it('should resolve after the server and repository close', async () => {
          let resolveRepositoryClose;
          repositoryCloseStub.callsFake(
            () =>
              new Promise((resolve) => {
                resolveRepositoryClose = resolve;
              })
          );
          const registry = Registry({});
          server.isListening.returns(true);
          server.close.resolves();

          let closed = false;
          const closePromise = registry.close().then(() => {
            closed = true;
          });
          await new Promise((resolve) => setImmediate(resolve));

          expect(server.close.calledOnce).to.be.true;
          expect(repositoryCloseStub.calledOnce).to.be.true;
          expect(repositoryCloseStub.calledAfter(server.close)).to.be.true;
          expect(closed).to.be.false;

          resolveRepositoryClose();
          await closePromise;

          expect(closed).to.be.true;
        });

        it('should reject when the server was not opened', async () => {
          const registry = Registry({});

          let error;
          try {
            await registry.close();
          } catch (err) {
            error = err;
          }

          expect(error).to.equal('not opened');
          expect(repositoryCloseStub.calledOnce).to.be.true;
        });

        it('should still call the repository close when the server close errors', async () => {
          const serverError = new Error('close failed');
          const registry = Registry({});
          server.listen.resolves();
          server.isListening.returns(true);
          server.close.rejects(serverError);

          await registry.start();

          let error;
          try {
            await registry.close();
          } catch (err) {
            error = err;
          }

          expect(error).to.equal(serverError);
          expect(repositoryCloseStub.calledOnce).to.be.true;
        });
      });
    });
  });
});
