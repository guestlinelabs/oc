const expect = require('chai').expect;
const injectr = require('injectr');
const sinon = require('sinon');

describe('cli : index', () => {
  const load = (parseResult) => {
    const result = { output: [], exited: null };
    const parseArgv = sinon.stub().returns(parseResult);
    const renderHelp = sinon.stub().returns('HELP-TEXT');
    const facades = {};
    for (const name of [
      'dev',
      'mock',
      'package',
      'preview',
      'publish',
      'registry',
      'registry-add',
      'registry-ls',
      'registry-remove',
      'validate'
    ]) {
      facades[name] = sinon.stub().returns((options) => {
        result.command = name;
        result.argv = options;
        return Promise.resolve();
      });
    }
    const mocks = {
      './parse-argv': {
        parseArgv,
        getCommandTree: () => ({ usage: '', commands: {} })
      },
      './help': { renderHelp },
      './domain/local': () => ({}),
      './domain/registry': () => ({})
    };
    for (const [name, facade] of Object.entries(facades)) {
      mocks[`./facade/${name}`] = facade;
    }

    const log = sinon
      .stub(console, 'log')
      .callsFake((x) => result.output.push(x));
    const error = sinon
      .stub(console, 'error')
      .callsFake((x) => result.output.push(x));
    const exit = sinon.stub(process, 'exit').callsFake((code) => {
      result.exited = code;
      throw Object.assign(new Error('exit'), { exitCode: code });
    });
    try {
      injectr(
        '../../dist/cli/index.js',
        mocks,
        // injectr evaluates the module in a bare vm context; provide the
        // globals index.ts relies on plus __dirname for package.json lookup.
        {
          process,
          console,
          __dirname: require('node:path').join(__dirname, '../../dist/cli')
        }
      );
    } catch (err) {
      if (err.exitCode === undefined) throw err;
      result.exitCode = err.exitCode;
    } finally {
      log.restore();
      error.restore();
      exit.restore();
    }
    return { result, parseArgv, renderHelp, facades };
  };

  it('should dispatch a parsed command to its facade with the argv', () => {
    const argv = { _: ['dev'], dirPath: '.', port: 3030 };
    const { result } = load({ type: 'run', node: { path: ['dev'] }, argv });
    expect(result.command).to.equal('dev');
    expect(result.argv).to.equal(argv);
  });

  it('should dispatch registry subcommands by dashed path', () => {
    const argv = { _: ['registry', 'add'], registryUrl: 'http://x/' };
    const { result } = load({
      type: 'run',
      node: { path: ['registry', 'add'] },
      argv
    });
    expect(result.command).to.equal('registry-add');
    expect(result.argv).to.equal(argv);
  });

  it('should print help for help results', () => {
    const { result, renderHelp } = load({
      type: 'help',
      node: { path: ['dev'] }
    });
    expect(renderHelp.calledOnce).to.be.true;
    expect(result.output).to.deep.equal(['HELP-TEXT']);
    expect(result.command).to.be.undefined;
  });

  it('should print the version for version results', () => {
    const { result } = load({ type: 'version' });
    expect(result.output.join('\n').trim()).to.equal(
      require('../../package.json').version
    );
  });

  it('should print help and the error message for error results', () => {
    const { result, renderHelp } = load({
      type: 'error',
      message: "No such command 'nope'",
      node: null
    });
    expect(renderHelp.calledOnce).to.be.true;
    expect(result.output.join('\n')).to.contain("No such command 'nope'");
    expect(result.exitCode).to.equal(1);
    expect(result.command).to.be.undefined;
  });

  it('should exit 1 when a facade rejects', (done) => {
    const result = { exited: null };
    const facades = {};
    for (const name of [
      'dev',
      'mock',
      'package',
      'preview',
      'publish',
      'registry',
      'registry-add',
      'registry-ls',
      'registry-remove',
      'validate'
    ]) {
      facades[name] = () => () => Promise.reject(new Error('boom'));
    }
    const mocks = {
      './parse-argv': {
        parseArgv: () => ({
          type: 'run',
          node: { path: ['dev'] },
          argv: {}
        }),
        getCommandTree: () => ({ usage: '', commands: {} })
      },
      './help': { renderHelp: () => '' },
      './domain/local': () => ({}),
      './domain/registry': () => {}
    };
    for (const [name, facade] of Object.entries(facades)) {
      mocks[`./facade/${name}`] = facade;
    }
    const exit = sinon.stub(process, 'exit').callsFake((code) => {
      result.exited = code;
    });
    const log = sinon.stub(console, 'log');
    const error = sinon.stub(console, 'error');
    try {
      injectr('../../dist/cli/index.js', mocks, {
        process,
        console,
        __dirname: require('node:path').join(__dirname, '../../dist/cli')
      });
    } catch (err) {
      // The facade rejection triggers process.exit asynchronously.
    } finally {
      setTimeout(() => {
        log.restore();
        error.restore();
        exit.restore();
        expect(exit.calledWith(1)).to.be.true;
        done();
      }, 10);
    }
  });
});
