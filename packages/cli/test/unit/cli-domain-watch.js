const expect = require('chai').expect;
const injectr = require('injectr');
const sinon = require('sinon');

describe('cli : domain : watch', () => {
  const dirs = [
    'C:\\Windows-like\\path\\to\\yet-another-component',
    '/path/to/my-component',
    '/path/to/my-component2',
    '/path/to/some-other-component'
  ];

  const loadWatch = ({ watchImpl, readdirSync, statSync } = {}) => {
    const watcher = { on: sinon.stub() };
    const watchStub = watchImpl || sinon.stub().returns(watcher);
    const fsMock = {
      watch: watchStub,
      readdirSync: readdirSync || sinon.stub().returns([]),
      statSync: statSync || sinon.stub()
    };
    const watch = injectr(
      '../../dist/cli/domain/watch.js',
      {
        'node:fs': fsMock,
        'node:path': require('node:path')
      },
      {
        // injectr evaluates the module in a bare vm context; provide the
        // Node globals watch.ts relies on (timers, Buffer, Error realm).
        setTimeout,
        clearTimeout,
        Buffer,
        Error,
        process,
        console
      }
    ).default;
    return { watch, watchStub, watcher };
  };

  // fs.watch callbacks are debounced by 100ms inside the module.
  const flush = () => new Promise((resolve) => setTimeout(resolve, 200));

  it('should watch the resolved base dir recursively', () => {
    const { watch, watchStub } = loadWatch();
    watch(dirs, '/path/to/', () => {});
    expect(watchStub.calledOnce).to.be.true;
    expect(watchStub.args[0][0]).to.equal('/path/to');
    expect(watchStub.args[0][1]).to.deep.equal({ recursive: true });
  });

  it('should report the file name and component dir for a component file', async () => {
    const { watch, watchStub } = loadWatch();
    const cb = sinon.spy();
    watch(dirs, '/path/to/', cb);
    const onEvent = watchStub.args[0][2];
    onEvent('change', 'my-component/server.js');
    await flush();
    expect(cb.calledOnce).to.be.true;
    expect(cb.args[0][0]).to.be.null;
    expect(cb.args[0][1]).to.equal('/path/to/my-component/server.js');
    expect(cb.args[0][2]).to.equal('/path/to/my-component');
  });

  it('should pick the longest matching component dir', async () => {
    const { watch, watchStub } = loadWatch();
    const cb = sinon.spy();
    watch(dirs, '/path/to/', cb);
    const onEvent = watchStub.args[0][2];
    onEvent('change', 'my-component2/server.js');
    await flush();
    expect(cb.args[0][1]).to.equal('/path/to/my-component2/server.js');
    expect(cb.args[0][2]).to.equal('/path/to/my-component2');
  });

  it('should debounce duplicate events for the same file', async () => {
    const { watch, watchStub } = loadWatch();
    const cb = sinon.spy();
    watch(dirs, '/path/to/', cb);
    const onEvent = watchStub.args[0][2];
    onEvent('change', 'my-component/server.js');
    onEvent('rename', 'my-component/server.js');
    await flush();
    expect(cb.calledOnce).to.be.true;
  });

  it('should ignore files matching the dev-watch ignore rules', async () => {
    const { watch, watchStub } = loadWatch();
    const cb = sinon.spy();
    watch(dirs, '/path/to/', cb);
    const onEvent = watchStub.args[0][2];
    onEvent('change', 'my-component/node_modules/dep/index.js');
    onEvent('change', 'my-component/_package/package.json');
    onEvent('change', 'my-component/.DS_Store');
    onEvent('change', 'my-component/oc.json');
    await flush();
    expect(cb.called).to.be.false;
  });

  it('should ignore events that resolve to directories', async () => {
    const statSync = sinon.stub().callsFake((fileName) => {
      if (String(fileName).endsWith('/my-component/public')) {
        return { isDirectory: () => true };
      }
      return { isDirectory: () => false };
    });
    const { watch, watchStub } = loadWatch({ statSync });
    const cb = sinon.spy();
    watch(dirs, '/path/to/', cb);
    const onEvent = watchStub.args[0][2];
    // Spurious directory event (e.g. Bun's fs.cp on a static dir) must not
    // trigger a repackage; file events still do.
    onEvent('rename', 'my-component/public');
    onEvent('change', 'my-component/server.js');
    await flush();
    expect(cb.calledOnce).to.be.true;
    expect(cb.args[0][1]).to.equal('/path/to/my-component/server.js');
  });

  it('should report watcher errors through the callback', () => {
    const { watch, watcher } = loadWatch();
    const cb = sinon.spy();
    watch(dirs, '/path/to/', cb);
    const errorHandler = watcher.on.args.find((args) => args[0] === 'error')[1];
    const err = new Error('boom');
    errorHandler(err);
    expect(cb.calledOnce).to.be.true;
    expect(cb.args[0][0]).to.equal(err);
    expect(cb.args[0][1]).to.equal('');
    expect(cb.args[0][2]).to.be.undefined;
  });

  it('should fall back to per-directory watchers without recursive support', () => {
    const watchImpl = sinon.stub().callsFake((_dir, options) => {
      if (options?.recursive) {
        throw new Error('recursive not supported');
      }
      return { on: sinon.stub() };
    });
    const dirent = (name, isDirectory) => ({
      name,
      isDirectory: () => isDirectory
    });
    const readdirSync = sinon.stub().callsFake((dir) => {
      if (dir === '/path/to') {
        return [dirent('my-component', true), dirent('file.txt', false)];
      }
      return [];
    });
    const { watch, watchStub } = loadWatch({ watchImpl, readdirSync });
    const watchers = watch(dirs, '/path/to/', () => {});
    // root + my-component watched individually
    expect(watchers.length).to.equal(2);
    const recursiveCalls = watchStub.args.filter((args) => args[1]?.recursive);
    expect(recursiveCalls.length).to.equal(1);
    const nonRecursiveDirs = watchStub.args
      .filter((args) => args[1]?.recursive === false)
      .map((args) => args[0])
      .sort();
    expect(nonRecursiveDirs).to.deep.equal([
      '/path/to',
      '/path/to/my-component'
    ]);
  });
});
