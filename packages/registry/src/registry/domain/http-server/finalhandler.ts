/**
 * Ports of `finalhandler` (404 + last-resort error responses) and
 * `errorhandler` (development error pages, enabled via `local` mode),
 * adapted to the `OcRequest`/`OcResponse` compat objects.
 */

import { inspect } from 'node:util';
import { preferredType } from './accept';
import { encodeUrl } from './encodeurl';
import { escapeHtml } from './escape-html';
import type { OcRequestImpl } from './request';
import type { OcResponseImpl } from './response';
import { STATUS_CODES } from './statuses';

const objectToString = Object.prototype.toString;

// -- finalhandler --------------------------------------------------------

function createHtmlDocument(message: string): string {
  const body = escapeHtml(message)
    .replaceAll('\n', '<br>')
    .replaceAll('  ', ' &nbsp;');

  return (
    '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<title>Error</title>\n' +
    '</head>\n' +
    '<body>\n' +
    '<pre>' +
    body +
    '</pre>\n' +
    '</body>\n' +
    '</html>\n'
  );
}

interface HttpErrorLike {
  status?: unknown;
  statusCode?: unknown;
  headers?: unknown;
  stack?: unknown;
  toString?: () => string;
}

const getErrorStatusCode = (err: unknown): number | undefined => {
  const e = err as HttpErrorLike;
  if (typeof e?.status === 'number' && e.status >= 400 && e.status < 600) {
    return e.status;
  }
  if (
    typeof e?.statusCode === 'number' &&
    e.statusCode >= 400 &&
    e.statusCode < 600
  ) {
    return e.statusCode;
  }
  return undefined;
};

const getErrorHeaders = (err: unknown): Record<string, string> | undefined => {
  const headers = (err as HttpErrorLike)?.headers;
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }
  return { ...(headers as Record<string, string>) };
};

const getErrorMessage = (err: unknown, status: number, env: string): string => {
  let msg: string | undefined;

  if (env !== 'production') {
    const e = err as HttpErrorLike;
    msg = typeof e?.stack === 'string' ? e.stack : undefined;
    if (
      !msg &&
      typeof (err as { toString?: () => string })?.toString === 'function'
    ) {
      msg = String(err);
    }
  }

  return msg || STATUS_CODES[status] || String(status);
};

const getResponseStatusCode = (res: OcResponseImpl): number => {
  const status = res.statusCode;
  if (typeof status !== 'number' || status < 400 || status > 599) {
    return 500;
  }
  return status;
};

const getResourceName = (req: OcRequestImpl): string => {
  try {
    // parseurl.original(req).pathname — path portion of originalUrl
    const url = req.originalUrl || req.url || '';
    const q = url.indexOf('?');
    return q === -1 ? url : url.slice(0, q);
  } catch {
    return 'resource';
  }
};

function sendFinal(
  req: OcRequestImpl,
  res: OcResponseImpl,
  status: number,
  headers: Record<string, string> | undefined,
  message: string
): void {
  const body = createHtmlDocument(message);

  res.statusCode = status;

  res.removeHeader('Content-Encoding');
  res.removeHeader('Content-Language');
  res.removeHeader('Content-Range');

  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }
  }

  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', String(Buffer.byteLength(body, 'utf8')));

  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body, 'utf8');
}

/**
 * finalhandler: respond 404 for unmatched requests or render the last-resort
 * error page. Call only when no response has been committed.
 */
export function finalhandler(
  req: OcRequestImpl,
  res: OcResponseImpl,
  err?: unknown
): void {
  const env = process.env['NODE_ENV'] || 'development';

  let status: number;
  let headers: Record<string, string> | undefined;
  let msg: string;

  if (!err) {
    status = 404;
    msg = `Cannot ${req.method} ${encodeUrl(getResourceName(req))}`;
  } else {
    const errStatus = getErrorStatusCode(err);
    if (errStatus === undefined) {
      status = getResponseStatusCode(res);
    } else {
      status = errStatus;
      headers = getErrorHeaders(err);
    }
    msg = getErrorMessage(err, status, env);
  }

  sendFinal(req, res, status, headers, msg);
}

// -- errorhandler ---------------------------------------------------------

const STYLESHEET = `* {
  margin: 0;
  padding: 0;
  outline: 0;
}

body {
  padding: 80px 100px;
  font: 13px "Helvetica Neue", "Lucida Grande", "Arial";
  background: #ECE9E9 -webkit-gradient(linear, 0% 0%, 0% 100%, from(#fff), to(#ECE9E9));
  background: #ECE9E9 -moz-linear-gradient(top, #fff, #ECE9E9);
  background-repeat: no-repeat;
  color: #555;
  -webkit-font-smoothing: antialiased;
}
h1, h2 {
  font-size: 22px;
  color: #343434;
}
h1 em, h2 em {
  padding: 0 5px;
  font-weight: normal;
}
h1 {
  font-size: 60px;
}
h2 {
  margin-top: 10px;
}
ul li {
  list-style: none;
}
#stacktrace {
  margin-left: 60px;
}
`;

const TEMPLATE = `<html>
  <head>
    <meta charset='utf-8'> 
    <title>{error}</title>
    <style>{style}</style>
  </head>
  <body>
    <div id="wrapper">
      <h1>{title}</h1>
      <h2><em>{statusCode}</em> {error}</h2>
      <ul id="stacktrace">{stack}</ul>
    </div>
  </body>
</html>
`;

const TITLE = 'Connect';

const DOUBLE_SPACE_REGEXP = /\x20{2}/g;
const NEW_LINE_REGEXP = /\n/g;

function escapeHtmlBlock(str: string): string {
  return escapeHtml(str)
    .replace(DOUBLE_SPACE_REGEXP, ' &nbsp;')
    .replace(NEW_LINE_REGEXP, '<br>');
}

function stringify(val: unknown): string {
  const stack = (val as { stack?: unknown })?.stack;
  if (stack) {
    return String(stack);
  }
  const str = String(val);
  return str === objectToString.call(val) ? inspect(val) : str;
}

function acceptHeaderOf(req: OcRequestImpl): string | undefined {
  const header = req.headers['accept'];
  return Array.isArray(header) ? header[0] : header;
}

/**
 * errorhandler: development error page negotiating html/json/text.
 * `log` mirrors the module default (`NODE_ENV !== 'test'`).
 */
export function errorHandler(
  req: OcRequestImpl,
  res: OcResponseImpl,
  err: unknown
): void {
  const env = process.env['NODE_ENV'] || 'development';
  const log = env !== 'test';

  const e = err as HttpErrorLike;

  // respect err.statusCode / err.status
  if (e?.statusCode) {
    res.statusCode = e.statusCode as number;
  }
  if (e?.status) {
    res.statusCode = e.status as number;
  }

  // default status code to 500
  if (res.statusCode < 400) {
    res.statusCode = 500;
  }

  // log the error (deferred like errorhandler does)
  const str = stringify(err);
  if (log) {
    setImmediate(() => console.error(str || (err as Error)?.stack));
  }

  // cannot actually respond — headers already committed; nothing we can do
  if (res.headersSent) {
    return;
  }

  // negotiate
  const type = preferredType(acceptHeaderOf(req), ['html', 'json', 'text']);

  // Security header for content sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (type === 'html') {
    const isInspect =
      !(err as { stack?: unknown })?.stack &&
      String(err) === objectToString.call(err);
    const errorHtml = !isInspect
      ? escapeHtmlBlock(String(str).split('\n', 1)[0] || 'Error')
      : 'Error';
    const stackLines = !isInspect ? String(str).split('\n').slice(1) : [str];
    const stackHtml = stackLines
      .map((v) => '<li>' + escapeHtmlBlock(v) + '</li>')
      .join('');
    const body = TEMPLATE.replace('{style}', STYLESHEET)
      .replace('{stack}', stackHtml)
      .replace('{title}', escapeHtml(TITLE))
      .replace('{statusCode}', String(res.statusCode))
      .replace(/\{error\}/g, errorHtml);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(body);
  } else if (type === 'json') {
    const error: Record<string, unknown> = {
      message: (err as Error)?.message,
      stack: (err as Error)?.stack
    };
    for (const prop in err as Record<string, unknown>) {
      error[prop] = (err as Record<string, unknown>)[prop];
    }
    const json = JSON.stringify({ error }, null, 2);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(json);
  } else {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(str);
  }
}
