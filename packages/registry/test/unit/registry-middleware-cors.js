const expect = require('chai').expect;
const http = require('node:http');

const { createHttpServer } =
  require('../../dist/registry/domain/http-server/server');
const sanitise =
  require('../../dist/registry/domain/options-sanitiser').default;
const middleware = require('../../dist/registry/middleware');

const DEFAULT_ALLOWED_HEADERS =
  'Origin, X-Requested-With, Content-Type, Accept, traceparent';
const DEFAULT_METHODS = 'GET, OPTIONS, PUT, POST';

const request = (port, method = 'GET') =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        method,
        path: '/test',
        port
      },
      (res) => {
        const chunks = [];

        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            body: Buffer.concat(chunks).toString(),
            headers: res.headers,
            statusCode: res.statusCode
          })
        );
      }
    );

    req.on('error', reject);
    req.end();
  });

const startRegistry = async (cors) => {
  const server = createHttpServer();
  const options = sanitise({
    baseUrl: 'http://registry.example.com/',
    compileClient: false,
    local: true,
    cors
  });

  middleware.bind(server, options);
  server.route('get', '/test', 'test', [(_req, res) => res.send('ok')]);

  await server.listen({ port: 0, timeout: 1000 });

  return { server, port: server.httpServer().port };
};

const closeRegistry = (server) => server.close();

describe('registry : middleware : cors', () => {
  it('should preserve the default security headers across the HTTP server', async () => {
    const { server, port } = await startRegistry();

    try {
      const response = await request(port);

      expect(response.statusCode).to.equal(200);
      expect(response.body).to.equal('ok');
      expect(response.headers['access-control-allow-credentials']).to.equal(
        'true'
      );
      expect(response.headers['access-control-allow-origin']).to.equal('*');
      expect(response.headers['access-control-allow-headers']).to.equal(
        DEFAULT_ALLOWED_HEADERS
      );
      expect(response.headers['access-control-allow-methods']).to.equal(
        DEFAULT_METHODS
      );
      expect(response.headers['x-powered-by']).to.be.undefined;
    } finally {
      await closeRegistry(server);
    }
  });

  it('should apply custom security headers across the HTTP server', async () => {
    const { server, port } = await startRegistry({
      origin: 'https://app.example.com',
      credentials: false,
      allowedHeaders: ['Content-Type', 'X-Request-Id'],
      methods: ['GET', 'OPTIONS']
    });

    try {
      const response = await request(port, 'OPTIONS');

      expect(response.statusCode).to.equal(200);
      expect(response.headers['access-control-allow-credentials']).to.be
        .undefined;
      expect(response.headers['access-control-allow-origin']).to.equal(
        'https://app.example.com'
      );
      expect(response.headers['access-control-allow-headers']).to.equal(
        'Content-Type, X-Request-Id'
      );
      expect(response.headers['access-control-allow-methods']).to.equal(
        'GET, OPTIONS'
      );
      expect(response.headers['x-powered-by']).to.be.undefined;
    } finally {
      await closeRegistry(server);
    }
  });
});
