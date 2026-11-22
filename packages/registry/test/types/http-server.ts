import type { RegistryType } from '../../src/registry';
import type {
  ConnectMiddleware,
  HostRequestContext,
  HostRouteResult,
  OcHandler,
  OcRequest,
  OcResponse,
  RegistryApp
} from '../../src/registry/domain/http-server/types';

declare const server: {
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
  route(
    method: 'get' | 'post' | 'put' | 'patch' | 'head' | 'delete',
    path: string,
    id: string,
    handlers: OcHandler[]
  ): void;
  fromConnect(handler: ConnectMiddleware): OcHandler;
  onServerError(cb: (err: Error) => void): void;
  isListening(): boolean;
  listen(opts: { port: number | string; timeout: number }): Promise<void>;
  close(): Promise<void>;
  httpServer(): unknown;
};

server.enableBodyParser({ limit: '1mb' });
server.enableCookies();
server.enableFileUploads({
  tempDir: '/tmp',
  filename: (originalName) => originalName
});
server.enableRequestTiming((_req, res, ms) => {
  res.statusCode;
  ms;
});
server.enableLogging({
  skip: (_req, res) => res.conf?.prefix === '/'
});
server.enableErrorHandler();
server.use((_req, res) => {
  void res.conf;
});
server.route('get', '/:name/:version?', 'component', [
  (req, res) => {
    req.params['name'];
    res.status(200).json({});
  }
]);
server.fromConnect((_req, _res, next) => {
  next();
});
server.onServerError((err) => err.message);
server.isListening();
server.listen({ port: 3000, timeout: 1000 });
server.close();
server.httpServer();

declare const registry: RegistryType;

registry.app.get('/health', (_req, ctx) => {
  ctx.params;
  ctx.query;
  ctx.cookies;
  ctx.ip;
  ctx.url;
  ctx.path;
  ctx.method;
  ctx.headers;
  ctx.set.headers.set('x-test', '1');
  return new Response('ok');
});

registry.app.post('/echo', async (_req, ctx): Promise<HostRouteResult> => {
  const body = await _req.json();
  return { body, path: ctx.path };
});

registry.app.put('/put', () => 'ok');
registry.app.delete('/delete', () => undefined);

registry.app.onRequest((_req, ctx) => {
  if (ctx.path === '/blocked') {
    return new Response('blocked', { status: 403 });
  }
  return undefined;
});

const headers: HostRequestContext['set']['headers'] = new Headers();
void headers;
