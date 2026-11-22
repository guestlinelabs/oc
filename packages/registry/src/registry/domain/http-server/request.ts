import type { IncomingHttpHeaders } from 'node:http';
import querystring from 'node:querystring';
import type { Server } from 'bun';
import { preferredType } from './accept';
import type { OcRequest, UploadedFile } from './types';

/**
 * Express-style request object backed by a web `Request`.
 */
export class OcRequestImpl implements OcRequest {
  /** Raw web request */
  raw!: Request;
  /** Bun server (for requestIP) */
  server: Server<undefined> | null = null;

  method!: string;
  url!: string;
  originalUrl!: string;
  path!: string;
  protocol = 'http';
  secure = false;

  headers!: IncomingHttpHeaders;
  cookies: Record<string, string> = {};
  query: Record<string, unknown> = {};
  params: Record<string, string> = {};
  body: unknown;
  files: UploadedFile[] = [];
  user?: string;
  routeId = '';
  ip = '';

  private acceptHeader: string | undefined;

  constructor(raw: Request, server: Server<undefined> | null, url: URL) {
    this.raw = raw;
    this.server = server;
    this.method = raw.method.toUpperCase();
    this.url = url.pathname + url.search;
    this.originalUrl = this.url;
    this.path = url.pathname;
    this.headers = buildHeaders(raw);
    this.acceptHeader = raw.headers.get('accept') ?? undefined;
    this.ip = server?.requestIP(raw)?.address ?? '';
    this.query = buildQuery(url.search);
  }

  get(field: string): string | undefined {
    const value = this.headers[field.toLowerCase()];
    if (value === undefined) {
      return undefined;
    }
    return Array.isArray(value) ? value[0] : value;
  }

  accepts(types?: string | string[]): string | false | undefined {
    if (!this.acceptHeader) {
      // No Accept header → Express/negotiator returns the first type
      return Array.isArray(types) ? types[0] : (types ?? undefined);
    }
    if (types === undefined) {
      return this.acceptHeader.split(',')[0]?.trim().split(';')[0];
    }
    const list = Array.isArray(types) ? types : [types];
    return preferredType(this.acceptHeader, list);
  }
}

export interface BuiltRequest {
  ocRequest: OcRequestImpl;
  /** Pathname after collapsing a leading `//` to `/` */
  pathname: string;
  /** Parsed URL (search included) */
  url: URL;
}

export function buildRequest(
  raw: Request,
  server: Server<undefined> | null
): BuiltRequest {
  const url = new URL(raw.url);
  let pathname = url.pathname;
  // Collapse a leading '//' in the path to '/' (router normalization)
  if (pathname.startsWith('//')) {
    pathname = '/' + pathname.replace(/^\/+/, '');
    url.pathname = pathname;
  }

  const ocRequest = new OcRequestImpl(raw, server, url);
  return { ocRequest, pathname, url };
}

function buildHeaders(raw: Request): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {};
  raw.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    const existing = headers[lower];
    if (existing === undefined) {
      headers[lower] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      headers[lower] = [existing, value];
    }
  });

  // Node keeps set-cookie values as an array
  const setCookies = raw.headers.getSetCookie();
  if (setCookies.length > 0) {
    headers['set-cookie'] = setCookies;
  }

  return headers;
}

function buildQuery(search: string): Record<string, unknown> {
  // Express's default 'simple' query parser is Node's `querystring.parse`
  const qs = search.startsWith('?') ? search.slice(1) : search;
  return querystring.parse(qs) as Record<string, unknown>;
}
