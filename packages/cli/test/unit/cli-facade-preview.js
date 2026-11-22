const { EventEmitter } = require('node:events');
const expect = require('chai').expect;
const injectr = require('injectr');
const sinon = require('sinon');

describe('cli : facade : preview', () => {
  let spawnStub;
  let logSpy;
  let registryStub;

  const execute = (error, url, done) => {
    spawnStub = sinon.stub().callsFake(() => {
      const child = new EventEmitter();
      child.unref = () => {};
      process.nextTick(() => child.emit('spawn'));
      return child;
    });
    registryStub = {
      getComponentPreviewUrlByUrl: error
        ? sinon.stub().rejects(error)
        : sinon.stub().resolves(url)
    };
    logSpy = { err: sinon.spy() };

    const PreviewFacade = injectr(
      '../../dist/cli/facade/preview.js',
      {
        'node:child_process': { spawn: spawnStub }
      },
      { process, console }
    ).default;
    const previewFacade = PreviewFacade({
      logger: logSpy,
      registry: registryStub
    });

    previewFacade({ componentHref: 'http://components.com/component' }).then(
      () => done(),
      () => done()
    );
  };

  describe('when previewing not valid component', () => {
    beforeEach((done) => {
      execute('404!!!', {}, done);
    });

    it('should not open any preview', () => {
      expect(spawnStub.called).to.be.false;
    });

    it('should show error message', () => {
      expect(logSpy.err.args[0][0]).to.equal(
        "The specified path is not a valid component's url"
      );
    });
  });

  describe('when previewing valid component', () => {
    beforeEach((done) => {
      execute(null, 'http://registry.com/component/~preview/', done);
    });

    it('should open the preview url in the platform browser opener', () => {
      expect(spawnStub.calledOnce).to.be.true;
      const [command, args] = spawnStub.args[0];
      const expectedCommands = {
        darwin: 'open',
        win32: 'cmd',
        linux: 'xdg-open'
      };
      const platform =
        process.platform === 'darwin'
          ? 'darwin'
          : process.platform === 'win32'
            ? 'win32'
            : 'linux';
      expect(command).to.equal(expectedCommands[platform]);
      expect(args).to.include('http://registry.com/component/~preview/');
    });
  });
});
