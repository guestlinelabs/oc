import type { IncomingHttpHeaders } from 'node:http';
import type { Server } from 'bun';
import type { Config } from '../../../types';

export interface CookieOptions {
  domain?: string;
  encode?: (value: string) => string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  partitioned?: boolean;
  path?: string;
  priority?: 'low' | 'medium' | 'high';
  sameSite?: boolean | 'lax' | 'strict' | 'none';
  secure?: boolean;
  signed?: boolean;
}

export type Method = 'get' | 'post' | 'put' | 'patch' | 'head' | 'delete';

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer?: Buffer;
  stream?: NodeJS.ReadableStream;
  truncated?: boolean;
}

export interface OcRequest {
  method: string;
  url: string;
  path: string;
  originalUrl: string;
  protocol: string;
  secure: boolean;
  ip: string;
  headers: IncomingHttpHeaders;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: any;
  cookies: Record<string, string>;
  files?: UploadedFile[] | Record<string, UploadedFile[]>;
  user?: string;
  routeId: string;
  get(header: string): string | undefined;
  /** The underlying Bun `Request` the OcRequest was created from. */
  raw: Request;
}

export interface OcResponse {
  conf: Config;
  errorCode?: string;
  errorDetails?: string;
  statusCode: number;
  /** Whether the response body has been committed. */
  readonly headersSent: boolean;
  status(code: number): this;
  json(body: unknown): void;
  send(body: unknown): void;
  set(field: string | Record<string, string>, value?: string | string[]): this;
  header(name: string, value: string | string[]): this;
  setHeader(name: string, value: string | number | string[]): this;
  getHeader(name: string): string | string[] | number | undefined;
  get(field: string): string | undefined;
  removeHeader(name: string): this;
  append(field: string, value: string | string[]): this;
  vary(field: string): this;
  type(mime: string): this;
  cookie(name: string, value: string, opts?: CookieOptions): this;
  redirect(url: string, status?: number): void;
  end(chunk?: unknown, encoding?: string): void;
  stream(readable: NodeJS.ReadableStream): void;
}

export type OcHandler = (
  req: OcRequest,
  res: OcResponse
) => void | Promise<void>;

/**
 * Connect/Express-style middleware signature `(req, res, next)`. Used for
 * `publishAuth` schemes and anything wrapped through `fromConnect`.
 */
export type ConnectMiddleware = (
  req: OcRequest,
  res: OcResponse,
  next: (err?: unknown) => void
) => void;

export interface HttpServerListenOptions {
  port: number | string;
  timeout: number;
}

/** Context handed to `registry.app` route handlers and `onRequest` hooks. */
export interface HostRequestContext {
  /** Route params captured by the matched pattern (`:name`, `*splat`). */
  params: Record<string, string>;
  /** Parsed URL query string (same shape as `req.query` on OC routes). */
  query: Record<string, unknown>;
  /** Parsed `Cookie` header. */
  cookies: Record<string, string>;
  /** Client IP address. */
  ip: string;
  /** Request URL (path + query). */
  url: string;
  /** Request pathname. */
  path: string;
  method: string;
  headers: Headers;
  /**
   * Mutable response headers. Values set here are applied to the final
   * response unless the handler/hook already set the same header.
   */
  set: {
    headers: Headers;
  };
}

export type HostRouteResult =
  | Response
  | string
  | Record<string, unknown>
  | null
  | undefined;

export type HostRouteHandler = (
  req: Request,
  ctx: HostRequestContext
) => HostRouteResult | Promise<HostRouteResult>;

type MaybePromise<T> = T | Promise<T>;

export type HostRequestHook = (
  req: Request,
  ctx: HostRequestContext
  // biome-ignore lint/suspicious/noConfusingVoidType: hooks that only inspect the request return nothing
) => MaybePromise<Response | void>;

/**
 * `registry.app` — the host-facing router. Routes may be registered before
 * or after `start()`; `onRequest` hooks run before host and OC routes and
 * may short-circuit by returning a `Response`.
 */
export interface RegistryApp {
  get(path: string, handler: HostRouteHandler): void;
  post(path: string, handler: HostRouteHandler): void;
  put(path: string, handler: HostRouteHandler): void;
  delete(path: string, handler: HostRouteHandler): void;
  onRequest(hook: HostRequestHook): void;
}

/**
 * Internal HTTP server contract used by the registry middleware and router.
 * Implemented by the hand-written `Bun.serve` server in `./server`.
 */
export interface HttpServer {
  /** Host-facing router exposed as `registry.app`. */
  app: RegistryApp;
  enableBodyParser(opts: { limit?: number | string }): void;
  enableCookies(): void;
  enableFileUploads(opts: {
    tempDir: string;
    filename: (originalName: string) => string;
  }): void;
  enableRequestTiming(
    onDone: (req: OcRequest, res: OcResponse, ms: number) => void
  ): void;
  enableLogging(opts: {
    skip: (req: OcRequest, res: OcResponse) => boolean;
  }): void;
  enableErrorHandler(): void;
  use(handler: OcHandler): void;
  route(method: Method, path: string, id: string, handlers: OcHandler[]): void;
  fromConnect(handler: ConnectMiddleware): OcHandler;
  onServerError(cb: (err: Error) => void): void;
  isListening(): boolean;
  listen(opts: HttpServerListenOptions): Promise<void>;
  close(): Promise<void>;
  httpServer(): Server<undefined>;
}
