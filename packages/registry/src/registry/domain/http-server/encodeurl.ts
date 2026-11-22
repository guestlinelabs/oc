/**
 * Port of `encodeurl` (https://github.com/pillarjs/encodeurl, MIT licensed).
 * Encodes a URL to percent-encoded form, excluding already-encoded
 * sequences, without throwing on malformed input.
 */

const ENCODE_CHARS_REGEXP =
  /(?:[^\x21\x23-\x3B\x3D\x3F-\x5F\x61-\x7A\x7C\x7E]+|%+(?![0-9A-Fa-f]{2})){1,1024}/g;

const SURROGATE_REGEXP = /([\uD800-\uDBFF][\uDC00-\uDFFF])|[\uD800-\uDFFF]/g;

export function encodeUrl(url: string): string {
  return String(url)
    .replace(SURROGATE_REGEXP, (_match, pair) => pair || '�')
    .replace(ENCODE_CHARS_REGEXP, encodeURI);
}
