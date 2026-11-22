import { expect, test } from 'bun:test';

import { distTag, increment } from './release';

test.each([
  ['1.0.0-alpha.0', 'prerelease', '1.0.0-alpha.1'],
  ['1.0.0', 'prerelease', '1.0.1-alpha.0'],
  ['1.0.0-alpha', 'prerelease', '1.0.0-alpha.0'],
  ['1.0.0-alpha.3', 'patch', '1.0.0'],
  ['1.0.0', 'patch', '1.0.1'],
  ['1.0.0-alpha.3', 'minor', '1.0.0'],
  ['1.0.1', 'minor', '1.1.0'],
  ['1.0.0-alpha.3', 'major', '1.0.0'],
  ['1.2.3', 'major', '2.0.0'],
  ['1.0.0-alpha.3', '2.0.0-beta.1', '2.0.0-beta.1']
])('%s + %s = %s', (current, bump, expected) => {
  expect(increment(current, bump)).toBe(expected);
});

test('starts a prerelease with the given id', () => {
  expect(increment('1.2.3', 'prerelease', 'beta')).toBe('1.2.4-beta.0');
});

test('rejects invalid versions', () => {
  expect(() => increment('1.0.0', 'not-a-version')).toThrow();
});

test.each([
  ['1.0.0-alpha.0', 'alpha'],
  ['2.0.0-beta.3', 'beta'],
  ['1.0.0', 'latest'],
  ['1.0.0-0', 'latest']
])('%s publishes to the %s dist-tag', (version, tag) => {
  expect(distTag(version)).toBe(tag);
});
