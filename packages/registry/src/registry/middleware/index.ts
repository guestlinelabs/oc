import type { Config } from '../../types';
import eventsHandler, { type RequestData } from '../domain/events-handler';
import type { HttpServer } from '../domain/http-server/types';
import cors from './cors';

const normaliseFileName = (x: string) =>
  x.replace('.tar.gz', '').replace(/\W+/g, '-').toLowerCase();

export const bind = (server: HttpServer, options: Config): HttpServer => {
  server.use((_req, res) => {
    res.conf = options;
  });

  server.enableRequestTiming((req, res, time) => {
    if (!eventsHandler.hasListeners('request')) {
      return;
    }

    const data: RequestData = {
      body: req.body,
      duration: time,
      headers: req.headers,
      ip: req.ip,
      method: req.method,
      path: req.path,
      relativeUrl: req.originalUrl,
      query: req.query,
      url: req.protocol + '://' + req.get('host') + req.originalUrl,
      statusCode: res.statusCode
    };

    if (res.errorDetails) {
      data.errorDetails = res.errorDetails;
    }

    if (res.errorCode) {
      data.errorCode = res.errorCode;
    }

    eventsHandler.fire('request', data);
  });
  server.enableCookies();
  server.enableBodyParser({ limit: options.postRequestPayloadSize });
  server.use(cors);
  if (!options.local) {
    server.enableFileUploads({
      tempDir: options.tempDir,
      filename: (originalName) =>
        `${normaliseFileName(originalName)}-${Date.now()}.tar.gz`
    });
  }
  if (options.verbosity) {
    server.enableLogging({
      skip: (req, res) => {
        // Hide logging development console calls
        return req.url.startsWith(
          `${res.conf?.prefix ?? ''}~actions/$$__oc__server___console__$$`
        );
      }
    });
  }

  if (options.local) {
    server.enableErrorHandler();
  }

  return server;
};
