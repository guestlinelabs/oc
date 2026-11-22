const { parseArgv } = require('../../dist/cli/parse-argv');
const expect = require('chai').expect;

const run = (args) => {
  const result = parseArgv(args, 'oc');
  expect(result.type).to.equal('run');
  return result;
};

const commandOf = (args) => run(args).node.path.join('-');

describe('cli : parse-argv', () => {
  describe('command routing', () => {
    const scenarios = [
      ['dev', 'dev'],
      ['mock', 'mock'],
      ['preview', 'preview'],
      ['package', 'package'],
      ['publish', 'publish'],
      ['validate', 'validate'],
      [['registry', 'add', 'http://x/'], 'registry-add'],
      [['registry', 'ls'], 'registry-ls'],
      [['registry', 'remove', 'http://x/'], 'registry-remove']
    ];

    for (const [args, expected] of scenarios) {
      it(`should route "oc ${[].concat(args).join(' ')}" to ${expected}`, () => {
        const argv = [].concat(args);
        // Append the required positionals each command needs.
        const positional = {
          dev: '.',
          mock: null,
          preview: 'http://x/',
          package: '.',
          publish: '.',
          validate: '.',
          'registry-add': null,
          'registry-ls': null,
          'registry-remove': null
        }[expected];
        const full =
          expected === 'mock'
            ? [...argv, 'plugin', 'name', 'value']
            : expected === 'registry-add' || expected === 'registry-remove'
              ? argv
              : expected === 'registry-ls'
                ? argv
                : [...argv, positional];
        expect(commandOf(full)).to.equal(expected);
      });
    }
  });

  describe('positionals', () => {
    it('should parse dev dirPath, port and baseUrl', () => {
      const { argv } = run(['dev', '../all', '3001', '127.0.0.1:3001']);
      expect(argv.dirPath).to.equal('../all');
      expect(argv.port).to.equal(3001);
      expect(argv.baseUrl).to.equal('127.0.0.1:3001');
      expect(argv._).to.deep.equal(['dev']);
    });

    it('should keep leading-zero ports as strings like yargs', () => {
      const { argv } = run(['dev', '.', '0300']);
      expect(argv.port).to.equal('0300');
    });

    it('should parse mock targetType, targetName and targetValue', () => {
      const { argv } = run(['mock', 'plugin', 'num', '-5']);
      expect(argv.targetType).to.equal('plugin');
      expect(argv.targetName).to.equal('num');
      expect(argv.targetValue).to.equal(-5);
    });

    it('should parse preview componentHref', () => {
      const { argv } = run(['preview', 'http://x/component/1.0.0/?a=b']);
      expect(argv.componentHref).to.equal('http://x/component/1.0.0/?a=b');
    });

    it('should parse package/publish/validate componentPath', () => {
      for (const cmd of ['package', 'publish', 'validate']) {
        const { argv } = run([cmd, 'comp/']);
        expect(argv.componentPath).to.equal('comp/');
      }
    });

    it('should parse registry add/remove registryUrl', () => {
      expect(run(['registry', 'add', 'http://x/']).argv.registryUrl).to.equal(
        'http://x/'
      );
      expect(
        run(['registry', 'remove', 'http://x/']).argv.registryUrl
      ).to.equal('http://x/');
    });

    it('should keep overflow positionals in _ like yargs', () => {
      const { argv } = run(['dev', '.', '1', '2', '3', '4']);
      expect(argv._).to.deep.equal(['dev', 3, 4]);
    });

    it('should keep tokens after -- in _ without filling positionals', () => {
      const { argv } = run(['dev', '.', '0300', '--', '--weird']);
      expect(argv.dirPath).to.equal('.');
      expect(argv.port).to.equal('0300');
      expect(argv.baseUrl).to.be.undefined;
      expect(argv._).to.deep.equal(['dev', '--weird']);
    });
  });

  describe('dev options', () => {
    it('should parse the full real-world spelling', () => {
      const { argv } = run([
        'dev',
        '.',
        '3030',
        '--components',
        'a,b',
        '--prefix=/registry/',
        '--fallbackRegistryUrl=https://x/registry'
      ]);
      expect(argv.components).to.deep.equal(['a,b']);
      expect(argv.prefix).to.equal('/registry/');
      expect(argv.fallbackRegistryUrl).to.equal('https://x/registry');
      expect(argv['fallback-registry-url']).to.equal('https://x/registry');
    });

    it('should parse components as a single comma-joined value like yargs', () => {
      const { argv } = run([
        'dev',
        '..',
        '3030',
        '--components',
        'my-component',
        '--prefix=/registry/',
        '--fallbackRegistryUrl=https://x'
      ]);
      expect(argv.components).to.deep.equal(['my-component']);
      expect(argv.dirPath).to.equal('..');
      expect(argv.port).to.equal(3030);
    });

    it('should apply dev defaults', () => {
      const { argv } = run(['dev', '.']);
      expect(argv.hotReloading).to.equal(true);
      expect(argv.watch).to.equal(true);
      expect(argv.verbose).to.equal(false);
      expect(argv.production).to.equal(false);
      expect(argv.prefix).to.equal('');
      expect(argv.postRequestPayloadSize).to.equal('100kb');
      expect(argv.components).to.be.undefined;
    });

    it('should support kebab-case spellings', () => {
      const { argv } = run([
        'dev',
        '.',
        '--fallback-registry-url',
        'http://x/',
        '--hot-reloading',
        'false',
        '--post-request-payload-size',
        '5mb',
        '--skip-package'
      ]);
      expect(argv.fallbackRegistryUrl).to.equal('http://x/');
      expect(argv.hotReloading).to.equal(false);
      expect(argv.postRequestPayloadSize).to.equal('5mb');
    });

    it('should support --no-<option> boolean negation', () => {
      const { argv } = run(['dev', '.', '--no-watch', '--no-hot-reloading']);
      expect(argv.watch).to.equal(false);
      expect(argv.hotReloading).to.equal(false);
      expect(argv['watch']).to.equal(false);
    });

    it('should consume every value of an array option', () => {
      const { argv } = run(['dev', '.', '--components', 'a', 'b', 'c']);
      expect(argv.components).to.deep.equal(['a', 'b', 'c']);
    });

    it('should consume values after an equals-style array option', () => {
      const { argv } = run([
        'dev',
        'components',
        '--components=header',
        'footer'
      ]);
      expect(argv.components).to.deep.equal(['header', 'footer']);
      expect(argv.dirPath).to.equal('components');
      expect(argv.port).to.be.undefined;
      expect(argv.baseUrl).to.be.undefined;
    });

    it('should accumulate repeated array options', () => {
      const { argv } = run([
        'dev',
        '.',
        '--components',
        'a',
        '--components',
        'b'
      ]);
      expect(argv.components).to.deep.equal(['a', 'b']);
    });

    it('should collapse duplicate non-array options into an array', () => {
      const { argv } = run(['dev', '.', '--prefix', '/x/', '--prefix', '/y/']);
      expect(argv.prefix).to.deep.equal(['/x/', '/y/']);
    });
  });

  describe('package options', () => {
    it('should parse --compress', () => {
      const { argv } = run(['package', '.', '--compress']);
      expect(argv.compress).to.equal(true);
    });

    it('should default compress to false', () => {
      const { argv } = run(['package', '.']);
      expect(argv.compress).to.equal(false);
    });
  });

  describe('publish options', () => {
    it('should parse the real-world spelling', () => {
      const { argv } = run([
        'publish',
        '.',
        '--registries',
        'https://x/',
        '--token',
        'abc',
        '--skipPackage'
      ]);
      expect(argv.registries).to.deep.equal(['https://x/']);
      expect(argv.token).to.equal('abc');
      expect(argv.skipPackage).to.equal(true);
      expect(argv['skip-package']).to.equal(true);
      expect(argv.dryRun).to.equal(false);
    });

    it('should parse --dryRun on an existing package', () => {
      const { argv } = run(['publish', '_package', '--dryRun']);
      expect(argv.componentPath).to.equal('_package');
      expect(argv.dryRun).to.equal(true);
      expect(argv['dry-run']).to.equal(true);
    });

    it('should parse kebab-case spellings', () => {
      const { argv } = run([
        'publish',
        '.',
        '--skip-package',
        '--dry-run',
        '--registries',
        'https://a/',
        'https://b/'
      ]);
      expect(argv.skipPackage).to.equal(true);
      expect(argv.dryRun).to.equal(true);
      expect(argv.registries).to.deep.equal(['https://a/', 'https://b/']);
    });

    it('should consume every registry after an equals-style array option', () => {
      const { argv } = run([
        'publish',
        'comp/',
        '--registries=http://a/',
        'http://b/'
      ]);
      expect(argv.registries).to.deep.equal(['http://a/', 'http://b/']);
    });

    it('should coerce numeric-looking credentials like yargs', () => {
      const { argv } = run([
        'publish',
        'comp/',
        '--username',
        '123',
        '--password=007'
      ]);
      expect(argv.username).to.equal(123);
      expect(argv.password).to.equal('007');
    });
  });

  describe('validate options', () => {
    it('should parse the real-world spelling', () => {
      const { argv } = run([
        'validate',
        '.',
        '--registries',
        'https://x/registry/',
        '--skipPackage'
      ]);
      expect(argv.registries).to.deep.equal(['https://x/registry/']);
      expect(argv.skipPackage).to.equal(true);
      expect(argv['skip-package']).to.equal(true);
    });
  });

  describe('registry subcommands', () => {
    it('should route registry add with its positional', () => {
      const { argv, node } = run(['registry', 'add', 'http://my-registry/']);
      expect(node.path).to.deep.equal(['registry', 'add']);
      expect(argv.registryUrl).to.equal('http://my-registry/');
      expect(argv['registry-url']).to.equal('http://my-registry/');
      expect(argv._).to.deep.equal(['registry', 'add']);
    });

    it('should route registry ls without positionals', () => {
      const { node } = run(['registry', 'ls']);
      expect(node.path).to.deep.equal(['registry', 'ls']);
    });

    it('should treat an unknown registry subcommand as the <command> positional', () => {
      const { argv, node } = run(['registry', 'nope']);
      expect(node.path).to.deep.equal(['registry']);
      expect(argv.command).to.equal('nope');
      expect(argv._).to.deep.equal(['registry']);
    });

    it('should fail on overflow positionals under registry', () => {
      const result = parseArgv(['registry', 'nope', 'extra'], 'oc');
      expect(result.type).to.equal('error');
      expect(result.message).to.equal("No such command 'extra'");
      expect(result.node.path).to.deep.equal(['registry']);
    });
  });

  describe('kebab-case coverage for every declared option', () => {
    const cases = [
      ['dev', '.', '--fallback-registry-url', 'x'],
      ['dev', '.', '--hot-reloading'],
      ['dev', '.', '--post-request-payload-size', '1kb'],
      ['dev', '.', '--verbose'],
      ['dev', '.', '--watch'],
      ['dev', '.', '--production'],
      ['dev', '.', '--prefix', '/p/'],
      ['dev', '.', '--components', 'a'],
      ['package', '.', '--compress'],
      ['publish', '.', '--password', 'p'],
      ['publish', '.', '--username', 'u'],
      ['publish', '.', '--token', 't'],
      ['publish', '.', '--skip-package'],
      ['publish', '.', '--registries', 'r'],
      ['publish', '.', '--dry-run'],
      ['validate', '.', '--skip-package'],
      ['validate', '.', '--registries', 'r']
    ];

    for (const args of cases) {
      it(`should accept "oc ${args.slice(1).join(' ')}"`, () => {
        expect(run(args).type).to.equal('run');
      });
    }
  });

  describe('help and version', () => {
    it('should return global help for empty args', () => {
      const result = parseArgv([], 'oc');
      expect(result.type).to.equal('help');
      expect(result.node).to.be.null;
    });

    it('should return global help for --help and -h', () => {
      for (const flag of ['--help', '-h']) {
        const result = parseArgv([flag], 'oc');
        expect(result.type).to.equal('help');
        expect(result.node).to.be.null;
      }
    });

    it('should return command help for per-command -h/--help', () => {
      for (const flag of ['-h', '--help']) {
        const result = parseArgv(['dev', '.', flag], 'oc');
        expect(result.type).to.equal('help');
        expect(result.node.path).to.deep.equal(['dev']);
      }
    });

    it('should return subcommand help', () => {
      const result = parseArgv(['registry', 'add', '--help'], 'oc');
      expect(result.type).to.equal('help');
      expect(result.node.path).to.deep.equal(['registry', 'add']);
    });

    it('should return version for --version and -v', () => {
      for (const flag of ['--version', '-v']) {
        expect(parseArgv([flag], 'oc').type).to.equal('version');
      }
    });

    it('should prefer help over version', () => {
      expect(
        parseArgv(['dev', '.', '--help', '--version'], 'oc').type
      ).to.equal('help');
    });

    it('should prefer help over an unknown command', () => {
      const result = parseArgv(['nope', '--help'], 'oc');
      expect(result.type).to.equal('help');
      expect(result.node).to.be.null;
    });
  });

  describe('errors', () => {
    it('should fail on unknown commands with the validate-command message', () => {
      const result = parseArgv(['nope'], 'oc');
      expect(result.type).to.equal('error');
      expect(result.message).to.equal("No such command 'nope'");
      expect(result.node).to.be.null;
    });

    it('should fail when required positionals are missing', () => {
      const scenarios = [
        [['dev'], 'Not enough non-option arguments: got 0, need at least 1'],
        [
          ['registry', 'add'],
          'Not enough non-option arguments: got 0, need at least 1'
        ],
        [
          ['mock', 'plugin'],
          'Not enough non-option arguments: got 1, need at least 3'
        ],
        [
          ['registry'],
          'Not enough non-option arguments: got 0, need at least 1'
        ]
      ];
      for (const [args, message] of scenarios) {
        const result = parseArgv(args, 'oc');
        expect(result.type).to.equal('error');
        expect(result.message).to.equal(message);
      }
    });

    it('should tolerate unknown options like yargs', () => {
      const { argv } = run(['dev', '.', '--unknown', 'val', '--verbose']);
      expect(argv.verbose).to.equal(true);
      expect(argv.dirPath).to.equal('.');
    });
  });
});
