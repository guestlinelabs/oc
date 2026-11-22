/**
 * Express `ServerResponse`-compatible response object backed by the
 * hand-written `Bun.serve` pipeline. Replicates the Express 5.3
 * `res.send`/`res.json`/`res.redirect`/`res.cookie`/`res.set` semantics the
 * registry routes rely on: content-type charset handling, strong ETags,
 * freshness (304), Content-Length, 204/205/304 stripping and HEAD bodies.
 */

import type { Config } from '../../../types';
import { preferredType } from './accept';
import { serialize as serializeCookie } from './cookies';
import { encodeUrl } from './encodeurl';
import { escapeHtml } from './escape-html';
import { etag as generateETag } from './etag';
import { fresh } from './fresh';
import { contentType as mimeContentType, lookup as mimeLookup } from './mime';
import { STATUS_CODES } from './statuses';
import type { CookieOptions, OcRequest, OcResponse } from './types';

export type ResponseBody =
  | { kind: 'empty' }
  | { kind: 'bytes'; data: Uint8Array }
  | { kind: 'stream'; stream: ReadableStream<Uint8Array> };

type HeaderValue = string | string[];

interface HeaderEntry {
  /** casing of the most recent set for this header */
  name: string;
  value: HeaderValue;
}

/**
 * Parse a `Content-Type` header value and return it with `charset`
 * replaced/added — the `setCharset` helper from Express utils.
 */
const setCharset = (type: string, charset: string): string => {
  if (!type || !charset) {
    return type;
  }
  const semi = type.indexOf(';');
  const essence = (semi === -1 ? type : type.slice(0, semi)).trim();
  const rest = semi === -1 ? '' : type.slice(semi);
  if (/;\s*charset\s*=/i.test(rest)) {
    return (
      essence + rest.replace(/charset\s*=\s*"?[^;"]*"?/i, `charset=${charset}`)
    );
  }
  return `${essence}${rest}; charset=${charset}`;
};

export class OcResponseImpl implements OcResponse {
  /** Registry configuration, attached by the first middleware. */
  conf!: Config;
  errorCode?: string;
  errorDetails?: string;

  statusCode = 200;

  /** Headers accumulated during the request lifecycle. */
  private headersMap = new Map<string, HeaderEntry>();

  /** Final body payload, set by send/json/end/stream/redirect. */
  private body: ResponseBody = { kind: 'empty' };
  private finished = false;
  private resolveDone!: (response: Response) => void;
  private readonly done: Promise<Response>;

  /** Set by the server pipeline once the request is fully dispatched. */
  onFinish?: (res: OcResponseImpl) => Response;

  constructor(public readonly req: OcRequest) {
    this.done = new Promise<Response>((resolve) => {
      this.resolveDone = resolve;
    });
  }

  get headersSent(): boolean {
    return this.finished;
  }

  /** Promise resolving to the final `Response` once the body is committed. */
  get response(): Promise<Response> {
    return this.done;
  }

  /** Header view used by `fresh()` checks. */
  private responseHeaders(): Record<string, string | string[] | undefined> {
    const out: Record<string, string | string[] | undefined> = {};
    for (const [key, entry] of this.headersMap) {
      out[key] = entry.value;
    }
    return out;
  }

  /** Whether the request is fresh (GET/HEAD/QUERY + 2xx/304 + matching
   *  ETag/Last-Modified), mirroring `req.fresh` in Express. */
  private isFresh(): boolean {
    const method = this.req.method;
    if (method !== 'GET' && method !== 'HEAD' && method !== 'QUERY') {
      return false;
    }
    const status = this.statusCode;
    if (!((status >= 200 && status < 300) || status === 304)) {
      return false;
    }
    return fresh(this.req.headers, this.responseHeaders());
  }

  // -- status -----------------------------------------------------------

  status(code: number): this {
    // Express does not validate the status code here; out-of-range values
    // are clamped when the web Response is constructed.
    this.statusCode = code;
    return this;
  }

  // -- headers ----------------------------------------------------------

  setHeader(name: string, value: string | number | string[]): this {
    const str = Array.isArray(value) ? value.map(String) : String(value);
    this.headersMap.set(name.toLowerCase(), { name, value: str });
    return this;
  }

  getHeader(name: string): string | string[] | number | undefined {
    const entry = this.headersMap.get(name.toLowerCase());
    return entry?.value;
  }

  removeHeader(name: string): this {
    this.headersMap.delete(name.toLowerCase());
    return this;
  }

  set(field: string | Record<string, string>, value?: string | string[]): this {
    if (typeof field === 'object' && field !== null) {
      for (const key of Object.keys(field)) {
        this.set(key, field[key]);
      }
      return this;
    }

    const fieldName = field as string;
    let val = value;

    if (val === undefined) {
      return this;
    }

    if (fieldName.toLowerCase() === 'content-type') {
      if (Array.isArray(val)) {
        throw new TypeError('Content-Type cannot be set to an Array');
      }
      const resolved = mimeContentType(val);
      val = resolved || val;
    }

    this.setHeader(fieldName, val);
    return this;
  }

  header(
    field: string | Record<string, string>,
    value?: string | string[]
  ): this {
    return this.set(field, value);
  }

  get(field: string): string | undefined {
    const value = this.getHeader(field);
    if (value === undefined) return undefined;
    return Array.isArray(value) ? value.join(', ') : String(value);
  }

  append(field: string, val: string | string[]): this {
    const prev = this.getHeader(field);
    let value: string | string[];
    if (prev) {
      const prevArr = Array.isArray(prev) ? prev : [String(prev)];
      const valArr = Array.isArray(val) ? val.map(String) : [String(val)];
      value = prevArr.concat(valArr);
    } else {
      value = val;
    }
    return this.set(field, value);
  }

  vary(field: string): this {
    const header = this.getHeader('Vary');
    const headers = header === undefined ? '' : String(header);
    if (headers === '*') {
      return this;
    }
    const values = headers
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    if (!values.includes(field.toLowerCase())) {
      this.setHeader('Vary', headers ? `${headers}, ${field}` : field);
    }
    return this;
  }

  type(mime: string): this {
    const ct = mime.indexOf('/') === -1 ? mimeLookup(mime) || mime : mime;
    return this.set('Content-Type', ct as string);
  }

  // -- body -------------------------------------------------------------

  json(obj: unknown): void {
    const body = JSON.stringify(obj);
    if (!this.get('Content-Type')) {
      this.set('Content-Type', 'application/json');
    }
    this.send(body);
  }

  send(body?: unknown): this {
    let chunk = body as string | Uint8Array | undefined;
    let encoding: BufferEncoding | undefined;
    const req = this.req;

    switch (typeof chunk) {
      case 'string':
        encoding = 'utf8';
        {
          const type = this.get('Content-Type');
          if (typeof type === 'string') {
            this.set('Content-Type', setCharset(type, 'utf-8'));
          } else {
            this.type('html');
          }
        }
        break;
      case 'boolean':
      case 'number':
      case 'object': {
        if (chunk === null) {
          chunk = '';
        } else if (
          chunk instanceof Uint8Array ||
          ArrayBuffer.isView(chunk as object)
        ) {
          if (!this.get('Content-Type')) {
            this.type('bin');
          }
        } else {
          this.json(chunk);
          return this;
        }
        break;
      }
    }

    // determine if ETag should be generated (strong etag always enabled)
    const generate = !this.get('ETag');

    let len: number | undefined;
    if (chunk !== undefined) {
      if (chunk instanceof Uint8Array && !(chunk instanceof Buffer)) {
        chunk = Buffer.from(chunk);
      }
      if (Buffer.isBuffer(chunk)) {
        len = chunk.length;
      } else if (
        !generate &&
        typeof chunk === 'string' &&
        chunk.length < 1000
      ) {
        len = Buffer.byteLength(chunk, encoding);
      } else {
        chunk = Buffer.from(chunk as string, encoding);
        encoding = undefined;
        len = chunk.length;
      }

      // Content-Length and Transfer-Encoding can't coexist
      if (!this.get('Transfer-Encoding')) {
        this.set('Content-Length', String(len));
      }
    }

    // populate ETag
    if (generate && len !== undefined && chunk !== undefined) {
      const buf =
        typeof chunk === 'string'
          ? Buffer.from(chunk, encoding || 'utf8')
          : chunk;
      this.set('ETag', generateETag(buf));
    }

    // freshness
    if (this.isFresh()) {
      this.status(304);
    }

    // strip irrelevant headers
    if (this.statusCode === 204 || this.statusCode === 304) {
      this.removeHeader('Content-Type');
      this.removeHeader('Content-Length');
      this.removeHeader('Transfer-Encoding');
      chunk = '';
    }

    // alter headers for 205
    if (this.statusCode === 205) {
      this.set('Content-Length', '0');
      this.removeHeader('Transfer-Encoding');
      chunk = '';
    }

    if (req.method === 'HEAD') {
      this.end();
    } else {
      this.end(chunk, encoding);
    }

    return this;
  }

  redirect(url: unknown, statusArg?: unknown): void {
    let address = url;
    let status = 302;

    // Express 5 accepts redirect(status, url); tolerate (url, status) too
    if (typeof url === 'number' && statusArg !== undefined) {
      status = url as number;
      address = statusArg;
    } else if (typeof statusArg === 'number') {
      status = statusArg;
    }

    if (!address) {
      throw new TypeError('redirect url is required');
    }
    if (typeof address !== 'string') {
      throw new TypeError('redirect url must be a string');
    }
    if (typeof status !== 'number') {
      throw new TypeError('redirect status must be a number');
    }

    // Set location header (encodeUrl applied by location())
    this.set('Location', encodeUrl(address));
    const location = this.get('Location') as string;

    let body: string;
    const acceptHeader = this.req.headers['accept'];
    const accept = Array.isArray(acceptHeader) ? acceptHeader[0] : acceptHeader;
    const message = STATUS_CODES[status] || String(status);

    const key = preferredType(accept, ['text', 'html']);
    this.vary('Accept');

    if (key === 'text') {
      this.set('Content-Type', 'text/plain');
      body = `${message}. Redirecting to ${location}`;
    } else if (key === 'html') {
      this.set('Content-Type', 'text/html');
      const u = escapeHtml(location);
      body =
        '<!DOCTYPE html><head><title>' +
        message +
        '</title></head>' +
        '<body><p>' +
        message +
        '. Redirecting to ' +
        u +
        '</p></body>';
    } else {
      // format default
      body = '';
    }

    this.status(status);
    this.set('Content-Length', String(Buffer.byteLength(body)));

    if (this.req.method === 'HEAD') {
      this.end();
    } else {
      this.end(body);
    }
  }

  cookie(name: string, value: unknown, options?: CookieOptions): this {
    const opts: CookieOptions = { ...(options as CookieOptions) };
    const secret = undefined; // no cookie secret configured
    const signed = opts.signed;

    if (signed && !secret) {
      throw new Error('cookieParser("secret") required for signed cookies');
    }

    let val =
      typeof value === 'object' && value !== null
        ? 'j:' + JSON.stringify(value)
        : String(value);

    if (signed) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      val = 's:' + val; // signing unsupported without a secret
    }

    if (opts.maxAge != null) {
      const maxAge = (opts.maxAge as number) - 0;
      if (!Number.isNaN(maxAge)) {
        (opts as { expires?: Date }).expires = new Date(Date.now() + maxAge);
        opts.maxAge = Math.floor(maxAge / 1000);
      }
    }

    if (opts.path == null) {
      opts.path = '/';
    }

    this.append(
      'Set-Cookie',
      serializeCookie(name, String(val), opts as CookieOptions)
    );
    return this;
  }

  end(chunk?: unknown, encoding?: string): this {
    if (this.finished) {
      return this;
    }
    this.finished = true;

    if (chunk === undefined || chunk === null) {
      this.body = { kind: 'empty' };
    } else if (typeof chunk === 'string') {
      this.body = {
        kind: 'bytes',
        data: Buffer.from(chunk, (encoding as BufferEncoding) || 'utf8')
      };
    } else if (chunk instanceof Uint8Array) {
      this.body = {
        kind: 'bytes',
        data: chunk instanceof Buffer ? chunk : Buffer.from(chunk)
      };
    } else if (chunk instanceof ReadableStream) {
      this.body = { kind: 'stream', stream: chunk };
    } else {
      this.body = {
        kind: 'bytes',
        data: Buffer.from(String(chunk), 'utf8')
      };
    }

    this.commit();
    return this;
  }

  stream(readable: NodeJS.ReadableStream): this {
    // Node Readable -> web ReadableStream
    const nodeStream = readable as AsyncIterable<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of nodeStream) {
            controller.enqueue(
              chunk instanceof Uint8Array ? chunk : Buffer.from(chunk as never)
            );
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      }
    });
    return this.end(stream);
  }

  // -- commit -----------------------------------------------------------

  /**
   * Resolve the response promise with an externally built `Response`.
   * Used by the server pipeline for 404/error-handler responses that do
   * not go through `send`/`end`.
   */
  resolveWith(response: Response): void {
    if (!this.finished) {
      this.finished = true;
      this.body = { kind: 'empty' };
    }
    this.resolveDone(response);
  }

  private commit(): void {
    if (!this.onFinish) {
      // no pipeline attached (unit tests) — resolve with a bare response
      this.resolveDone(this.buildResponse());
      return;
    }
    const response = this.onFinish(this);
    this.resolveDone(response);
  }

  /** Build the web `Response` from accumulated state (also used directly
   *  by the server pipeline for error/404 responses). */
  buildResponse(): Response {
    const headers = new Headers();
    this.writeHeaders(headers);

    let body: BodyInit | null = null;
    const status = this.statusCode;
    const isNullBody =
      status === 204 ||
      status === 304 ||
      status === 205 ||
      this.req.method === 'HEAD';

    if (!isNullBody) {
      if (this.body.kind === 'bytes') {
        body = this.body.data as unknown as BodyInit;
      } else if (this.body.kind === 'stream') {
        body = this.body.stream;
      }
    }

    const safeStatus =
      Number.isInteger(status) && status >= 200 && status <= 599 ? status : 500;
    return new Response(body, { status: safeStatus, headers });
  }

  /** Copy accumulated headers into a `Headers` instance. */
  writeHeaders(headers: Headers): void {
    for (const [key, entry] of this.headersMap) {
      const value = entry.value;
      if (key === 'set-cookie' && Array.isArray(value)) {
        for (const v of value) {
          headers.append('set-cookie', v);
        }
      } else if (Array.isArray(value)) {
        headers.set(entry.name, value.join(', '));
      } else {
        headers.set(entry.name, value);
      }
    }
  }
}
