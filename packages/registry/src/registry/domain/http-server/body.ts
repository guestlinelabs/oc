/**
 * `application/json` and `application/x-www-form-urlencoded` body parsers
 * replicating body-parser@2 semantics as used by the old Express adapter:
 * content-type matching, charset validation, content-encoding inflation,
 * size limits (413), strict JSON shape (400) and qs "extended" urlencoded
 * parsing (nested keys, `[]` arrays, parameter/depth limits).
 */

import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { createError, type HttpError } from './http-error';
import * as qs from './qs';
import type { OcRequest } from './types';

const FIRST_NON_WHITESPACE_REGEXP =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — mirrors body-parser's JSON whitespace skip
  /^[\x20\x09\x0a\x0d]*([^\x20\x09\x0a\x0d]|$)/;

const hasBody = (req: OcRequest): boolean => {
  const headers = req.headers;
  const contentLength = headers['content-length'];
  const length = Array.isArray(contentLength)
    ? contentLength[0]
    : contentLength;
  return (
    headers['transfer-encoding'] !== undefined ||
    (typeof length === 'string' &&
      length !== '' &&
      !Number.isNaN(Number(length)))
  );
};

interface ContentTypeInfo {
  type: string;
  parameters: Record<string, string>;
}

const parseContentType = (
  header: string | undefined
): ContentTypeInfo | null => {
  if (!header) return null;
  const parts = header.split(';');
  const type = parts[0].trim().toLowerCase();
  const parameters: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    parameters[key] = value;
  }
  return { type, parameters };
};

const contentTypeMatches = (req: OcRequest, expected: string): boolean => {
  const info = parseContentType(
    req.headers['content-type'] as string | undefined
  );
  return !!info && info.type === expected.toLowerCase();
};

const getCharset = (req: OcRequest): string | undefined => {
  const info = parseContentType(
    req.headers['content-type'] as string | undefined
  );
  const charset = info?.parameters['charset'];
  return charset ? charset.toLowerCase() : undefined;
};

/** `bytes.parse` equivalent for the `limit` option. */
export function parseLimit(limit: number | string | undefined): number | null {
  if (typeof limit === 'undefined' || limit === null) {
    return 102400; // 100kb default
  }
  if (typeof limit === 'number') {
    return limit;
  }

  const match = /^\s*(-|\+)?(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(limit);
  if (!match) return null;

  const num = parseFloat(match[2]);
  const unit = (match[3] || 'b').toLowerCase();
  const mul =
    unit === 'b' || unit === ''
      ? 1
      : unit.startsWith('k')
        ? 1024
        : unit.startsWith('m')
          ? 1024 ** 2
          : unit.startsWith('g')
            ? 1024 ** 3
            : unit.startsWith('t')
              ? 1024 ** 4
              : unit.startsWith('p')
                ? 1024 ** 5
                : unit.startsWith('e')
                  ? 1024 ** 6
                  : null;

  if (mul === null) return null;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * num * mul;
}

const decodeBody = (bytes: Uint8Array, charset: string): string => {
  const label = charset.toLowerCase();

  if (label === 'utf-8' || label === 'utf8') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  if (
    label === 'utf-16le' ||
    label === 'utf16le' ||
    label === 'ucs2' ||
    label === 'utf-16-le'
  ) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (label === 'utf-16be' || label === 'utf16be' || label === 'utf-16-be') {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  if (label === 'utf-16' || label === 'utf16') {
    // iconv-lite utf-16 is BOM-aware, defaulting to LE
    if (bytes.length >= 2) {
      if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(bytes.subarray(2));
      }
      if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(bytes.subarray(2));
      }
    }
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (
    label === 'iso-8859-1' ||
    label === 'latin1' ||
    label === 'latin-1' ||
    label === 'iso8859-1' ||
    label === 'iso88591' ||
    label === 'l1' ||
    label === 'ibm819' ||
    label === 'csisolatin1'
  ) {
    // iconv-lite's iso-8859-1 is true Latin-1 (unlike WHATWG's
    // windows-1252 mapping for the same label)
    let out = '';
    for (const b of bytes) {
      out += String.fromCharCode(b);
    }
    return out;
  }

  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    throw createError(415, `unsupported charset "${charset.toUpperCase()}"`, {
      charset,
      type: 'charset.unsupported'
    });
  }
};

const ZSTD_SUPPORTED =
  typeof (Bun as { zstdDecompressSync?: unknown }).zstdDecompressSync ===
    'function' ||
  typeof (require('node:zlib') as { zstdDecompressSync?: unknown })
    .zstdDecompressSync === 'function';

const SUPPORTED_ENCODINGS = new Set(['gzip', 'deflate', 'br']);
if (ZSTD_SUPPORTED) {
  SUPPORTED_ENCODINGS.add('zstd');
}

const decompress = (bytes: Uint8Array, encoding: string): Uint8Array => {
  switch (encoding) {
    case 'gzip':
      return gunzipSync(bytes);
    case 'deflate':
      return inflateSync(bytes);
    case 'br':
      return brotliDecompressSync(bytes);
    case 'zstd': {
      const zstd = (
        Bun as { zstdDecompressSync?: (b: Uint8Array) => Uint8Array }
      ).zstdDecompressSync;
      if (zstd) return zstd(bytes);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const zlib = require('node:zlib') as typeof import('node:zlib');
      if (typeof zlib.zstdDecompressSync === 'function') {
        return zlib.zstdDecompressSync(bytes);
      }
      throw createError(415, `unsupported content encoding "${encoding}"`, {
        encoding,
        type: 'encoding.unsupported'
      });
    }
    default:
      throw createError(415, `unsupported content encoding "${encoding}"`, {
        encoding,
        type: 'encoding.unsupported'
      });
  }
};

interface ReadOptions {
  limit: number;
  isValidCharset?: (charset: string) => boolean;
  parse: (body: string, charset: string) => unknown;
}

const readBody = async (req: OcRequest, opts: ReadOptions): Promise<void> => {
  if (req.body !== undefined || !hasBody(req)) {
    return;
  }

  const headers = req.headers;

  const contentEncodingHeader = headers['content-encoding'];
  const contentEncoding =
    (Array.isArray(contentEncodingHeader)
      ? contentEncodingHeader[0]
      : contentEncodingHeader
    )?.toLowerCase() || 'identity';

  // body-parser validates charset and content-encoding before reading
  const charset = getCharset(req) || 'utf-8';

  if (opts.isValidCharset && !opts.isValidCharset(charset)) {
    throw createError(415, `unsupported charset "${charset.toUpperCase()}"`, {
      charset,
      type: 'charset.unsupported'
    });
  }

  if (
    contentEncoding !== 'identity' &&
    !SUPPORTED_ENCODINGS.has(contentEncoding)
  ) {
    throw createError(
      415,
      `unsupported content encoding "${contentEncoding}"`,
      { encoding: contentEncoding, type: 'encoding.unsupported' }
    );
  }

  // raw-body only knows the content length for identity bodies; for
  // compressed bodies the limit applies to the decompressed stream.
  const contentLengthHeader = headers['content-length'];
  const contentLength =
    contentLengthHeader === undefined ||
    Number.isNaN(Number(contentLengthHeader))
      ? null
      : parseInt(String(contentLengthHeader), 10);
  const length = contentEncoding === 'identity' ? contentLength : null;

  // raw-body checks the declared length before reading anything
  if (length !== null && length > opts.limit) {
    throw createError(413, 'request entity too large', {
      expected: length,
      length,
      limit: opts.limit,
      type: 'entity.too.large'
    });
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.raw.arrayBuffer());
  } catch (err) {
    throw createError(400, err as Error);
  }

  let received = bytes;
  if (contentEncoding !== 'identity') {
    try {
      received = decompress(bytes, contentEncoding);
    } catch (err) {
      if ((err as HttpError).status === 415) throw err;
      throw createError(400, err as Error);
    }
  }

  if (received.length > opts.limit) {
    throw createError(413, 'request entity too large', {
      limit: opts.limit,
      received: received.length,
      type: 'entity.too.large'
    });
  }

  if (length !== null && received.length !== length) {
    throw createError(400, 'request size did not match content length', {
      expected: length,
      length,
      received: received.length,
      type: 'request.size.invalid'
    });
  }

  const body = decodeBody(received, charset);

  try {
    req.body = opts.parse(body, charset);
  } catch (err) {
    throw createError(400, err as Error, {
      body,
      type: (err as HttpError).type || 'entity.parse.failed'
    });
  }
};

const firstNonWhitespaceChar = (str: string): string | undefined => {
  const match = FIRST_NON_WHITESPACE_REGEXP.exec(str);
  return match?.[1] ? match[1] : undefined;
};

const JSON_SYNTAX_CHAR = '#';
const JSON_SYNTAX_REGEXP = /#+/g;

/** Port of body-parser's `createStrictSyntaxError`. */
const createStrictSyntaxError = (str: string, char: string): SyntaxError => {
  const index = str.indexOf(char);
  let partial = '';

  if (index !== -1) {
    partial =
      str.substring(0, index) + JSON_SYNTAX_CHAR.repeat(str.length - index);
  }

  try {
    JSON.parse(partial);
    /* istanbul ignore next */
    throw new SyntaxError('strict violation');
  } catch (e) {
    const error = e as SyntaxError;
    error.message = error.message.replace(JSON_SYNTAX_REGEXP, (placeholder) =>
      str.substring(index, index + placeholder.length)
    );
    return error;
  }
};

const parseJson = (body: string): unknown => {
  if (body.length === 0) {
    return {};
  }

  if (body[0] !== '{' && body[0] !== '[') {
    const first = firstNonWhitespaceChar(body);
    if (first !== '{' && first !== '[') {
      // strict mode: mimic the native SyntaxError shape
      throw createStrictSyntaxError(body, first as string);
    }
  }

  return JSON.parse(body);
};

const parameterCount = (body: string, limit: number): number | undefined => {
  let count = 0;
  let index = -1;
  do {
    count++;
    if (count > limit) return undefined;
    index = body.indexOf('&', index + 1);
  } while (index !== -1);
  return count;
};

const parseUrlencoded = (body: string, charset: string): unknown => {
  if (!body.length) return {};

  const paramCount = parameterCount(body, 1000);
  if (paramCount === undefined) {
    throw createError(413, 'too many parameters', {
      type: 'parameters.too.many'
    });
  }

  const arrayLimit = Math.max(100, paramCount);

  try {
    return qs.parse(body, {
      allowPrototypes: true,
      arrayLimit,
      charset,
      depth: 32,
      parameterLimit: 1000,
      strictDepth: true
    } as never);
  } catch (err) {
    if (err instanceof RangeError) {
      throw createError(400, 'The input exceeded the depth', {
        type: 'querystring.parse.rangeError'
      });
    }
    throw err;
  }
};

export interface BodyParserOptions {
  limit?: number | string;
}

export const jsonBodyParser =
  (opts: BodyParserOptions) =>
  async (req: OcRequest): Promise<void> => {
    if (!contentTypeMatches(req, 'application/json')) {
      return;
    }
    const limit = parseLimit(opts.limit);
    if (limit === null) {
      throw new TypeError(`option limit "${String(opts.limit)}" is invalid`);
    }
    await readBody(req, {
      limit,
      isValidCharset: (charset) => charset.slice(0, 4) === 'utf-',
      parse: (body) => parseJson(body)
    });
  };

export const urlencodedBodyParser =
  (opts: BodyParserOptions) =>
  async (req: OcRequest): Promise<void> => {
    if (!contentTypeMatches(req, 'application/x-www-form-urlencoded')) {
      return;
    }
    const limit = parseLimit(opts.limit);
    if (limit === null) {
      throw new TypeError(`option limit "${String(opts.limit)}" is invalid`);
    }
    await readBody(req, {
      limit,
      isValidCharset: (charset) =>
        charset === 'utf-8' || charset === 'iso-8859-1',
      parse: (body, charset) => parseUrlencoded(body, charset)
    });
  };
