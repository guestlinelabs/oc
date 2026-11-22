const expect = require('chai').expect;

// The vendored copy under src/vendor/turbo-stream must produce byte-identical
// output to the published @rdevis/turbo-stream package (kept as a
// devDependency for this comparison only).
const {
  encode: vendoredEncode
} = require('../../dist/vendor/turbo-stream/turbo-stream.js');
const { encode: realEncode } = require('@rdevis/turbo-stream');

const streamToText = async (stream) => new Response(stream).text();

describe('vendor : turbo-stream', () => {
  const cases = [
    [
      'nested objects and arrays',
      { a: { b: [1, 'two', { c: null }], d: true } }
    ],
    [
      'promises resolving later',
      {
        immediate: 'now',
        later: new Promise((resolve) =>
          setTimeout(() => resolve({ resolved: 'later' }), 10)
        )
      }
    ],
    [
      'errors',
      { failure: Object.assign(new Error('boom'), { code: 'E_BOOM' }) }
    ],
    ['dates', { when: new Date('2020-01-02T03:04:05.678Z') }],
    ['undefined values', { u: undefined, list: [undefined, 1] }],
    [
      'strings with special chars',
      { s: 'héllo "quotes" <tags> & üñíçødé 🚀\\n\\t' }
    ],
    [
      'mixed structures',
      [
        1,
        'x',
        null,
        true,
        { nested: { deep: [new Date(0), /re/g, new Map([['k', 'v']])] } }
      ]
    ]
  ];

  for (const [name, value] of cases) {
    it(`encodes ${name} byte-identically to @rdevis/turbo-stream`, async () => {
      const [vendored, real] = await Promise.all([
        streamToText(vendoredEncode(value)),
        streamToText(realEncode(value))
      ]);
      expect(vendored).to.equal(real);
    });
  }
});
