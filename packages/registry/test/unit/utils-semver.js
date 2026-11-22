const expect = require('chai').expect;

const semver = require('../../dist/utils/semver');

describe('utils : semver', () => {
  describe('valid', () => {
    it('accepts strict versions and normalises them', () => {
      expect(semver.valid('1.2.3')).to.equal('1.2.3');
      expect(semver.valid('v1.2.3')).to.equal('1.2.3');
      expect(semver.valid(' 1.2.3 ')).to.equal('1.2.3');
      expect(semver.valid('1.2.3-alpha.1')).to.equal('1.2.3-alpha.1');
      expect(semver.valid('1.2.3+build.5')).to.equal('1.2.3+build.5');
      expect(semver.valid('1.2.3-rc.1+build')).to.equal('1.2.3-rc.1+build');
    });

    it('rejects invalid versions', () => {
      for (const version of [
        '',
        'foo',
        '1.2',
        '1',
        '1.2.3.4',
        'v',
        '1.2.x',
        'latest',
        '1.2.3-',
        '1.2.3+'
      ]) {
        expect(semver.valid(version)).to.equal(null);
      }
    });
  });

  describe('major / minor / patch', () => {
    it('extracts numeric components', () => {
      expect(semver.major('1.2.3')).to.equal(1);
      expect(semver.minor('1.2.3')).to.equal(2);
      expect(semver.patch('1.2.3')).to.equal(3);
      expect(semver.major('10.20.30-rc.1')).to.equal(10);
      expect(semver.minor('v0.0.7')).to.equal(0);
    });

    it('throws on invalid versions', () => {
      expect(() => semver.major('foo')).to.throw(TypeError);
      expect(() => semver.minor('1.2')).to.throw(TypeError);
    });
  });

  describe('compare / rcompare', () => {
    it('orders versions', () => {
      expect(semver.compare('1.0.0', '2.0.0')).to.equal(-1);
      expect(semver.compare('2.0.0', '1.0.0')).to.equal(1);
      expect(semver.compare('1.0.0', '1.0.0')).to.equal(0);
      expect(semver.compare('1.0.0-alpha', '1.0.0')).to.equal(-1);
      expect(semver.compare('1.0.0-alpha', '1.0.0-beta')).to.equal(-1);
      expect(semver.compare('1.0.0-beta.2', '1.0.0-beta.11')).to.equal(-1);
      expect(semver.compare('1.0.0+build', '1.0.0')).to.equal(0);
      expect(semver.compare('v1.2.3', '1.2.3')).to.equal(0);
    });

    it('rcompare reverses the order', () => {
      expect(semver.rcompare('1.0.0', '2.0.0')).to.equal(1);
      expect(semver.rcompare('2.0.0', '1.0.0')).to.equal(-1);
      expect(semver.rcompare('1.0.0', '1.0.0')).to.equal(0);
    });

    it('throws on invalid versions', () => {
      expect(() => semver.compare('foo', '1.0.0')).to.throw();
    });
  });

  describe('comparison predicates', () => {
    it('evaluates lt/lte/gt/gte/eq', () => {
      expect(semver.lt('1.0.0', '2.0.0')).to.equal(true);
      expect(semver.lt('2.0.0', '1.0.0')).to.equal(false);
      expect(semver.lt('1.0.0', '1.0.0')).to.equal(false);
      expect(semver.lte('1.0.0', '1.0.0')).to.equal(true);
      expect(semver.lte('2.0.0', '1.0.0')).to.equal(false);
      expect(semver.gt('2.0.0', '1.0.0')).to.equal(true);
      expect(semver.gt('1.0.0', '2.0.0')).to.equal(false);
      expect(semver.gte('1.0.0', '1.0.0')).to.equal(true);
      expect(semver.gte('1.0.0', '2.0.0')).to.equal(false);
      expect(semver.eq('1.0.0', 'v1.0.0')).to.equal(true);
      expect(semver.eq('1.0.0', '1.0.1')).to.equal(false);
    });
  });

  describe('satisfies', () => {
    it('matches versions against ranges', () => {
      expect(semver.satisfies('1.2.3', '*')).to.equal(true);
      expect(semver.satisfies('1.2.3', '')).to.equal(true);
      expect(semver.satisfies('1.5.0', '^1.0.0')).to.equal(true);
      expect(semver.satisfies('2.0.0', '^1.0.0')).to.equal(false);
      expect(semver.satisfies('1.2.9', '~1.2.0')).to.equal(true);
      expect(semver.satisfies('1.3.0', '~1.2.0')).to.equal(false);
      expect(semver.satisfies('1.5.0', '>=1.0.0 <2.0.0')).to.equal(true);
      expect(semver.satisfies('1.2.3', '1.x')).to.equal(true);
      expect(semver.satisfies('1.2.3', '1.2.x')).to.equal(true);
      expect(semver.satisfies('1.2.3', '=1.2.3')).to.equal(true);
      expect(semver.satisfies('1.5.0', '1.0.0 - 2.0.0')).to.equal(true);
      expect(semver.satisfies('3.0.0', '^1.0.0 || ^3.0.0')).to.equal(true);
      expect(semver.satisfies('v1.2.3', '^1.0.0')).to.equal(true);
    });

    it('rejects prereleases unless the range opts in', () => {
      expect(semver.satisfies('1.0.0-alpha', '^1.0.0')).to.equal(false);
      expect(semver.satisfies('1.0.0-alpha', '*')).to.equal(false);
      expect(semver.satisfies('1.0.0-alpha', '>=1.0.0-alpha')).to.equal(true);
    });

    it('returns false for invalid versions', () => {
      expect(semver.satisfies('foo', '*')).to.equal(false);
      expect(semver.satisfies('not-a-version', '^1.0.0')).to.equal(false);
    });

    it('returns false for invalid ranges', () => {
      for (const range of ['hello!', 'garbage', 'foo bar', '=>', '>=', 'v']) {
        expect(semver.satisfies('1.2.3', range)).to.equal(false);
      }
    });
  });

  describe('validRange', () => {
    it('accepts valid ranges', () => {
      for (const range of [
        '',
        '*',
        'x',
        '1',
        '1.2',
        '1.2.3',
        'v1.2.3',
        '=1.2.3',
        '1.x',
        '1.2.x',
        '^1.2.3',
        '~1.2',
        '>=1.0.0 <2.0.0',
        '>= 1.0.0 < 2.0.0',
        '1.0.0 - 2.0.0',
        '1.0.0-alpha - 2.0.0',
        '^1.0.0 || ^2.0.0',
        '1.2.3||2.0.0',
        '>=1.0.0-alpha'
      ]) {
        expect(semver.validRange(range)).to.equal(true, `range: ${range}`);
      }
    });

    it('rejects invalid ranges', () => {
      for (const range of [
        'hello!',
        'garbage',
        'foo bar',
        '=>',
        '>=',
        'v',
        '<',
        '1.2.3.4.5',
        'latest',
        '1.2.3 ||',
        '|| 1.2.3',
        '- 2.0.0',
        '1.0.0 -',
        '>=1.0.0 - 2.0.0'
      ]) {
        expect(semver.validRange(range)).to.equal(false, `range: ${range}`);
      }
    });
  });

  describe('maxSatisfying', () => {
    it('returns the greatest satisfying version', () => {
      expect(semver.maxSatisfying(['1.0.0', '2.0.0', '1.5.0'], '')).to.equal(
        '2.0.0'
      );
      expect(
        semver.maxSatisfying(['1.0.0', '2.0.0', '1.5.0'], '^1.0.0')
      ).to.equal('1.5.0');
      expect(semver.maxSatisfying(['1.0.0', '2.0.0'], '~1.0.0')).to.equal(
        '1.0.0'
      );
    });

    it('returns undefined when nothing satisfies', () => {
      expect(semver.maxSatisfying(['1.0.0'], '^2.0.0')).to.equal(undefined);
      expect(semver.maxSatisfying([], '')).to.equal(undefined);
      expect(semver.maxSatisfying(['foo', 'bar'], '*')).to.equal(undefined);
    });

    it('handles prerelease ordering', () => {
      expect(
        semver.maxSatisfying(
          ['1.0.0-alpha', '1.0.0-beta', '0.9.0'],
          '>=1.0.0-alpha <2.0.0'
        )
      ).to.equal('1.0.0-beta');
      // prereleases only satisfy when a comparator shares their tuple
      expect(
        semver.maxSatisfying(
          ['1.0.0-alpha', '1.0.0-beta', '0.9.0'],
          '>=0.9.0 <2.0.0-0'
        )
      ).to.equal('0.9.0');
    });
  });
});
