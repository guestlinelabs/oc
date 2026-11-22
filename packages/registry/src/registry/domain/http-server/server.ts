/**
 * Hand-written `Bun.serve` HTTP server replacing the Express adapter.
 *
 * Replicates the middleware/route pipeline the registry relied on:
 *
 *   use-handlers + enable* steps → onRequest hooks → host routes
 *   (registry.app) → OC routes → finalhandler 404
 *
 * Errors thrown anywhere jump to the error handler (`errorhandler` in
 * `local` mode, `finalhandler` otherwise), mirroring Express error
 * semantics. Responses that are never committed stay pending, matching
 * Express behaviour for handlers that respond asynchronously.
 */

import { type Server as BunServer, serve } from 'bun';
import { jsonBodyParser, urlencodedBodyParser } from './body';
import { jsonCookie, parse as parseCookieHeader } from './cookies';
import { errorHandler, finalhandler } from './finalhandler';
import { matchPath } from './match';
import { parseMultipart, shouldParseUploads } from './multipart';
import { buildRequest, type OcRequestImpl } from './request';
import { OcResponseImpl } from './response';
import type {
  ConnectMiddleware,
  HostRequestContext,
  HostRequestHook,
  HostRouteHandler,
  HostRouteResult,
  HttpServer,
  HttpServerListenOptions,
  Method,
  OcHandler,
  OcRequest,
  OcResponse,
  RegistryApp
} from './types';

const CONNECT_MIDDLEWARE = Symbol('ocConnectMiddleware');

type ConnectMarkedHandler = OcHandler & {
  [CONNECT_MIDDLEWARE]?: ConnectMiddleware;
};

type PipelineStep =
  | { kind: 'handler'; handler: OcHandler }
  | { kind: 'cookies' }
  | { kind: 'body'; limit?: number | string }
  | {
      kind: 'uploads';
      tempDir: string;
      filename: (originalName: string) => string;
    }
  | { kind: 'timing' }
  | { kind: 'logging' };

interface OcRouteLayer {
  id: string;
  path: string;
  handlers: OcHandler[];
}

interface HostRouteLayer {
  path: string;
  handler: HostRouteHandler;
}

interface HostMatch {
  response: Response;
  ctx: HostRequestContext;
}

class RegistryAppImpl implements RegistryApp {
  private readonly routes: Record<Method, HostRouteLayer[]> = {
    get: [],
    post: [],
    put: [],
    patch: [],
    head: [],
    delete: []
  };
  private readonly hooks: HostRequestHook[] = [];

  get(path: string, handler: HostRouteHandler): void {
    this.routes.get.push({ path, handler });
  }
  post(path: string, handler: HostRouteHandler): void {
    this.routes.post.push({ path, handler });
  }
  put(path: string, handler: HostRouteHandler): void {
    this.routes.put.push({ path, handler });
  }
  delete(path: string, handler: HostRouteHandler): void {
    this.routes.delete.push({ path, handler });
  }
  /** Internal convenience — not part of the public `RegistryApp` surface. */
  patch(path: string, handler: HostRouteHandler): void {
    this.routes.patch.push({ path, handler });
  }
  head(path: string, handler: HostRouteHandler): void {
    this.routes.head.push({ path, handler });
  }
  onRequest(hook: HostRequestHook): void {
    this.hooks.push(hook);
  }

  async runHooks(
    raw: Request,
    makeCtx: () => HostRequestContext
  ): Promise<HostMatch | undefined> {
    for (const hook of this.hooks) {
      const ctx = makeCtx();
      const result = await hook(raw, ctx);
      if (result instanceof Response) {
        return { response: result, ctx };
      }
    }
    return undefined;
  }

  async runRoute(
    method: string,
    pathname: string,
    raw: Request,
    makeCtx: (params: Record<string, string>) => HostRequestContext
  ): Promise<HostMatch | undefined> {
    const verb = method.toLowerCase() as Method;
    // Express maps HEAD onto GET routes when no HEAD route exists
    const candidates: Method[] = verb === 'head' ? ['head', 'get'] : [verb];

    for (const m of candidates) {
      for (const layer of this.routes[m] ?? []) {
        const match = matchPath(layer.path, pathname);
        if (!match) continue;
        const ctx = makeCtx(match.params);
        const result = await layer.handler(raw, ctx);
        if (result instanceof Response) {
          return { response: result, ctx };
        }
        if (result !== null && result !== undefined) {
          return { response: hostResultToResponse(result), ctx };
        }
        // null/undefined → keep scanning other matching host routes
      }
    }
    return undefined;
  }
}

function hostResultToResponse(
  result: Exclude<HostRouteResult, Response | null | undefined>
): Response {
  if (typeof result === 'string') {
    return new Response(result, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

interface RequestLocals {
  timingStart?: [number, number];
  loggingStart?: [number, number];
  loggingArmed: boolean;
}

export class HttpServerImpl implements HttpServer {
  readonly app = new RegistryAppImpl();

  private readonly steps: PipelineStep[] = [];
  private readonly ocRoutes: Partial<Record<Method, OcRouteLayer[]>> = {};
  private serverErrorHandlers: Array<(err: Error) => void> = [];

  private timingCallback?: (
    req: OcRequest,
    res: OcResponse,
    ms: number
  ) => void;
  private loggingSkip?: (req: OcRequest, res: OcResponse) => boolean;
  private localErrorHandler = false;

  private bunServer?: BunServer<undefined>;
  private listening = false;

  // -- registration ------------------------------------------------------

  enableBodyParser(opts: { limit?: number | string }): void {
    this.steps.push({ kind: 'body', limit: opts.limit });
  }

  enableCookies(): void {
    this.steps.push({ kind: 'cookies' });
  }

  enableFileUploads(opts: {
    tempDir: string;
    filename: (originalName: string) => string;
  }): void {
    this.steps.push({ kind: 'uploads', ...opts });
  }

  enableRequestTiming(
    onDone: (req: OcRequest, res: OcResponse, ms: number) => void
  ): void {
    this.steps.push({ kind: 'timing' });
    this.timingCallback = onDone;
  }

  enableLogging(opts: {
    skip: (req: OcRequest, res: OcResponse) => boolean;
  }): void {
    this.steps.push({ kind: 'logging' });
    this.loggingSkip = opts.skip;
  }

  enableErrorHandler(): void {
    // errorhandler is the terminal error middleware — its position in the
    // stack does not affect which errors reach it.
    this.localErrorHandler = true;
  }

  use(handler: OcHandler): void {
    this.steps.push({ kind: 'handler', handler });
  }

  route(method: Method, path: string, id: string, handlers: OcHandler[]): void {
    let list = this.ocRoutes[method];
    if (!list) {
      list = [];
      this.ocRoutes[method] = list;
    }
    list.push({ id, path, handlers });
  }

  fromConnect(handler: ConnectMiddleware): OcHandler {
    const wrapped: ConnectMarkedHandler = (req, res) =>
      new Promise<void>((resolve, reject) => {
        handler(req, res, (err?: unknown) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          } else {
            resolve();
          }
        });
      });
    wrapped[CONNECT_MIDDLEWARE] = handler;
    return wrapped;
  }

  onServerError(cb: (err: Error) => void): void {
    this.serverErrorHandlers.push(cb);
    // Bun.serve has no post-listen 'error' event equivalent; bind failures
    // surface through listen() which notifies these handlers.
  }

  isListening(): boolean {
    return this.listening;
  }

  httpServer(): BunServer<undefined> {
    if (!this.bunServer) {
      throw new Error('HTTP server has not been started');
    }
    return this.bunServer;
  }

  listen(opts: HttpServerListenOptions): Promise<void> {
    const port = typeof opts.port === 'string' ? Number(opts.port) : opts.port;

    try {
      this.bunServer = serve({
        port,
        // Bun's idleTimeout is a per-request seconds budget; the registry's
        // `timeout` option (ms) maps onto it.
        ...(opts.timeout
          ? { idleTimeout: Math.max(1, Math.ceil(opts.timeout / 1000)) }
          : {}),
        fetch: (raw, server) => this.handleRequest(raw, server)
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const cb of this.serverErrorHandlers) {
        try {
          cb(error);
        } catch {
          // ignore handler errors
        }
      }
      return Promise.reject(error);
    }

    this.listening = true;
    return Promise.resolve();
  }

  close(): Promise<void> {
    if (!this.listening || !this.bunServer) {
      return Promise.resolve();
    }
    this.listening = false;
    this.bunServer.stop();
    return Promise.resolve();
  }

  // -- request pipeline ----------------------------------------------------

  private handleRequest(
    raw: Request,
    server: BunServer<undefined>
  ): Promise<Response> {
    const { ocRequest: req, pathname } = buildRequest(raw, server);
    const res = new OcResponseImpl(req);
    const locals: RequestLocals = { loggingArmed: false };

    res.onFinish = (r) => this.finalize(req, r, locals);

    const respond = res.response;

    void this.dispatch(req, res, pathname, locals).catch((err) => {
      // last-resort: dispatch itself failed outside its own try/catch
      if (!res.headersSent) {
        this.respondWithError(req, res, err);
      }
    });

    return respond;
  }

  private finalize(
    req: OcRequestImpl,
    res: OcResponseImpl,
    locals: RequestLocals
  ): Response {
    const response = res.buildResponse();
    this.emitTiming(req, res, locals);
    this.emitLogging(req, res, locals);
    return response;
  }

  private emitTiming(
    req: OcRequestImpl,
    res: OcResponseImpl,
    locals: RequestLocals
  ): void {
    if (!this.timingCallback || !locals.timingStart) {
      return;
    }
    try {
      this.timingCallback(req, res, responseTimeMs(locals.timingStart));
    } catch {
      // timing callbacks must not break responses
    }
  }

  private emitLogging(
    req: OcRequestImpl,
    res: OcResponseImpl,
    locals: RequestLocals
  ): void {
    if (!locals.loggingArmed || !this.loggingSkip) {
      return;
    }
    if (this.loggingSkip(req, res)) {
      return;
    }

    const status = res.statusCode;
    const color =
      status >= 500
        ? 31
        : status >= 400
          ? 33
          : status >= 300
            ? 36
            : status >= 200
              ? 32
              : 0;
    const cl = res.getHeader('content-length');
    const clValue = cl === undefined ? '-' : String(cl);
    // morgan's response-time token measures from when the logging
    // middleware was entered until the response finished.
    const rt = locals.loggingStart
      ? responseTimeMs(locals.loggingStart).toFixed(3)
      : '-';

    let line: string;
    if (process.stdout.isTTY && !process.env['NO_COLOR']) {
      line =
        `\x1b[0m${req.method} ${req.originalUrl} ` +
        `\x1b[${color}m${status}\x1b[0m ${rt} ms - ${clValue}\x1b[0m`;
    } else {
      line = `${req.method} ${req.originalUrl} ${status} ${rt} ms - ${clValue}`;
    }
    process.stdout.write(line + '\n');
  }

  private async dispatch(
    req: OcRequestImpl,
    res: OcResponseImpl,
    pathname: string,
    locals: RequestLocals
  ): Promise<void> {
    try {
      // 1. middleware pipeline (use-handlers + enable* steps)
      for (const step of this.steps) {
        if (res.headersSent) return;
        await this.runStep(step, req, res, locals);
      }
      if (res.headersSent) return;

      const makeCtx = (params: Record<string, string>): HostRequestContext => ({
        params,
        query: req.query,
        cookies: req.cookies,
        ip: req.ip,
        url: req.originalUrl,
        path: pathname,
        method: req.method,
        headers: req.raw.headers,
        set: { headers: new Headers() }
      });

      // 2. onRequest hooks (host short-circuit)
      const hookMatch = await this.app.runHooks(req.raw, () => makeCtx({}));
      if (hookMatch) {
        this.finishExternal(req, res, locals, hookMatch);
        return;
      }
      if (res.headersSent) return;

      // 3. host routes (registry.app)
      const hostMatch = await this.app.runRoute(
        req.method,
        pathname,
        req.raw,
        makeCtx
      );
      if (hostMatch) {
        this.finishExternal(req, res, locals, hostMatch);
        return;
      }
      if (res.headersSent) return;

      // 4. OC routes
      const matched = this.matchOcRoute(req, pathname);
      if (matched) {
        req.params = matched.params;
        req.routeId = matched.id;
        await this.runRouteHandlers(matched.handlers, req, res);
        // If nothing was sent the request stays pending — OC handlers may
        // respond asynchronously (e.g. component rendering callbacks).
        return;
      }

      // 5. OPTIONS auto-response (Express router parity): when the path
      //    matches OC routes for other methods, answer with the Allow list
      //    instead of a 404.
      if (req.method === 'OPTIONS') {
        const allow = this.optionsAllow(pathname);
        if (allow !== null) {
          res.set('Allow', allow);
          res.set('Content-Type', 'text/plain');
          res.set('X-Content-Type-Options', 'nosniff');
          res.set('Content-Length', String(Buffer.byteLength(allow)));
          res.end(allow);
          return;
        }
      }

      // 6. nothing matched → finalhandler 404
      finalhandler(req, res);
    } catch (err) {
      this.respondWithError(req, res, err);
    }
  }

  private respondWithError(
    req: OcRequestImpl,
    res: OcResponseImpl,
    err: unknown
  ): void {
    if (res.headersSent) {
      return;
    }
    if (this.localErrorHandler) {
      errorHandler(req, res, err);
    } else {
      finalhandler(req, res, err);
    }
  }

  private finishExternal(
    req: OcRequestImpl,
    res: OcResponseImpl,
    locals: RequestLocals,
    match: HostMatch
  ): void {
    const { response, ctx } = match;

    // Reflect the actual response status for timing/logging observers
    res.statusCode = response.status;

    // Merge precedence: registry middleware headers < ctx.set.headers
    // < the Response's own headers.
    const headers = new Headers();
    res.writeHeaders(headers);
    for (const [key, value] of ctx.set.headers.entries()) {
      headers.set(key, value);
    }
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') return;
      headers.set(key, value);
    });
    for (const cookie of response.headers.getSetCookie()) {
      headers.append('set-cookie', cookie);
    }

    const merged = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });

    this.emitTiming(req, res, locals);
    this.emitLogging(req, res, locals);
    res.resolveWith(merged);
  }

  /**
   * Build the `Allow` header value for an OPTIONS request: the sorted,
   * unique set of methods with a route matching `pathname`. GET routes
   * implicitly allow HEAD (unless a HEAD route exists), mirroring
   * Express's `route._methods()`.
   */
  private optionsAllow(pathname: string): string | null {
    const methods = new Set<string>();
    for (const [method, layers] of Object.entries(this.ocRoutes)) {
      for (const layer of layers ?? []) {
        if (matchPath(layer.path, pathname)) {
          methods.add(method.toUpperCase());
        }
      }
    }
    if (methods.size === 0) {
      return null;
    }
    if (methods.has('GET') && !methods.has('HEAD')) {
      methods.add('HEAD');
    }
    return [...methods].sort().join(', ');
  }

  private matchOcRoute(
    req: OcRequestImpl,
    pathname: string
  ): {
    id: string;
    params: Record<string, string>;
    handlers: OcHandler[];
  } | null {
    const method = req.method.toLowerCase() as Method;
    const candidates: Method[] = method === 'head' ? ['head', 'get'] : [method];

    for (const m of candidates) {
      const layers = this.ocRoutes[m];
      if (!layers) continue;
      for (const layer of layers) {
        const match = matchPath(layer.path, pathname);
        if (match) {
          return {
            id: layer.id,
            params: match.params,
            handlers: layer.handlers
          };
        }
      }
    }
    return null;
  }

  private async runRouteHandlers(
    handlers: OcHandler[],
    req: OcRequest,
    res: OcResponse
  ): Promise<void> {
    for (const handler of handlers) {
      if (res.headersSent) return;
      const connectMw = (handler as ConnectMarkedHandler)[CONNECT_MIDDLEWARE];
      if (connectMw) {
        await runConnect(connectMw, req, res);
        continue;
      }

      // Plain OC route handler — terminal (does not auto-advance)
      await handler(req, res);
      return;
    }
  }

  private async runStep(
    step: PipelineStep,
    req: OcRequestImpl,
    res: OcResponseImpl,
    locals: RequestLocals
  ): Promise<void> {
    switch (step.kind) {
      case 'handler': {
        const connectMw = (step.handler as ConnectMarkedHandler)[
          CONNECT_MIDDLEWARE
        ];
        if (connectMw) {
          await runConnect(connectMw, req, res);
          return;
        }
        await step.handler(req, res);
        // use-handlers auto-advance unless they committed a response
        return;
      }
      case 'cookies': {
        const header = req.headers['cookie'];
        const value = Array.isArray(header) ? header[0] : header;
        const parsed = parseCookieHeader(value);
        const cookies: Record<string, unknown> = {};
        for (const [name, val] of Object.entries(parsed)) {
          cookies[name] = jsonCookie(val);
        }
        req.cookies = cookies as Record<string, string>;
        return;
      }
      case 'body': {
        await jsonBodyParser({ limit: step.limit })(req);
        await urlencodedBodyParser({ limit: step.limit })(req);
        return;
      }
      case 'uploads': {
        if (!shouldParseUploads(req)) return;
        await parseMultipart(req, {
          tempDir: step.tempDir,
          filename: step.filename
        });
        return;
      }
      case 'timing': {
        locals.timingStart = process.hrtime();
        return;
      }
      case 'logging': {
        locals.loggingArmed = true;
        locals.loggingStart = process.hrtime();
        return;
      }
    }
  }
}

function responseTimeMs(start: [number, number]): number {
  const diff = process.hrtime(start);
  return diff[0] * 1e3 + diff[1] * 1e-6;
}

function runConnect(
  middleware: ConnectMiddleware,
  req: OcRequest,
  res: OcResponse
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const next = (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      } else {
        resolve();
      }
    };
    try {
      // ConnectMiddleware is typed void, but async connect-style
      // middlewares may return a promise — treat it as thenable.
      const ret = middleware(req, res, next) as unknown;
      if (ret && typeof (ret as Promise<void>).then === 'function') {
        (ret as Promise<void>).catch(next);
      }
    } catch (err) {
      next(err);
    }
  });
}

export function createHttpServer(): HttpServer {
  return new HttpServerImpl();
}
