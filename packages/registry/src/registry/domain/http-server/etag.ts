/**
 * Port of `etag` (https://github.com/jshttp/etag, MIT licensed) covering the
 * strong entity-tag generation Express uses for `res.send` bodies.
 */

import { createHash } from 'node:crypto';

const EMPTY_ENTITY_TAG = '"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"';

function entityTag(entity: string | Uint8Array): string {
  if (entity.length === 0) {
    return EMPTY_ENTITY_TAG;
  }

  const buf = typeof entity === 'string' ? Buffer.from(entity, 'utf8') : entity;

  const hash = createHash('sha1').update(buf).digest('base64').substring(0, 27);

  return `"${buf.length.toString(16)}-${hash}"`;
}

/**
 * Generate a strong ETag for a string/Buffer body.
 */
export function etag(entity: string | Uint8Array): string {
  return entityTag(entity);
}
