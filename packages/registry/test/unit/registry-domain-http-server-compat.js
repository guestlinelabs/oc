const expect = require('chai').expect;
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createHttpServer } =
  require('../../dist/registry/domain/http-server/server');
const sanitise =
  require('../../dist/registry/domain/options-sanitiser').default;
const middleware = require('../../dist/registry/middleware');

const request = (
  port,
  { method = 'GET', path: reqPath = '/', headers = {}, body } = {}
) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        method,
        path: reqPath,
        port,
        headers
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
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });

const startServer = async ({
  options = {},
  ocRoutes = [],
  hostRoutes = [],
  hooks = []
} = {}) => {
  const server = createHttpServer();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-http-compat-'));
  const conf = sanitise({
    baseUrl: 'http://registry.example.com/',
    compileClient: false,
    local: true,
    tempDir,
    ...options
  });

  middleware.bind(server, conf);

  for (const hook of hooks) {
    server.app.onRequest(hook);
  }
  for (const [method, routePath, handler] of hostRoutes) {
    server.app[method](routePath, handler);
  }
  for (const [method, routePath, handler] of ocRoutes) {
    server.route(method, routePath, `${method}-${routePath}`, [handler]);
  }

  await server.listen({ port: 0, timeout: 5000 });
  return { server, port: server.httpServer().port, tempDir };
};

describe('registry : domain : http-server : compatibility', () => {
  describe('ETag / freshness', () => {
    it('should return 304 for a matching If-None-Match', async () => {
      const { server, port } = await startServer({
        ocRoutes: [['get', '/etagged', (_req, res) => res.send('hello world')]]
      });

      try {
        const first = await request(port, { path: '/etagged' });
        expect(first.statusCode).to.equal(200);
        const etag = first.headers['etag'];
        expect(etag).to.be.a('string');

        const second = await request(port, {
          path: '/etagged',
          headers: { 'if-none-match': etag }
        });
        expect(second.statusCode).to.equal(304);
      } finally {
        await server.close();
      }
    });
  });

  describe('path normalization', () => {
    it('should collapse a leading // to / for host routes', async () => {
      const { server, port } = await startServer({
        hostRoutes: [['get', '/health', () => 'ok']]
      });

      try {
        const response = await request(port, { path: '//health' });
        expect(response.statusCode).to.equal(200);
        expect(response.body).to.equal('ok');
      } finally {
        await server.close();
      }
    });

    it('should collapse a leading // to / for OC routes', async () => {
      const { server, port } = await startServer({
        ocRoutes: [['get', '/oc-path', (_req, res) => res.send('oc-ok')]]
      });

      try {
        const response = await request(port, { path: '//oc-path' });
        expect(response.statusCode).to.equal(200);
        expect(response.body).to.equal('oc-ok');
      } finally {
        await server.close();
      }
    });
  });

  describe('request ip', () => {
    it('should expose the client ip on the host request context', async () => {
      const { server, port } = await startServer({
        hostRoutes: [
          [
            'get',
            '/ip',
            (_req, ctx) =>
              new Response(JSON.stringify({ ip: ctx.ip }), {
                headers: { 'content-type': 'application/json' }
              })
          ]
        ]
      });

      try {
        const response = await request(port, { path: '/ip' });
        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.ip).to.be.a('string').and.to.not.equal('');
      } finally {
        await server.close();
      }
    });
  });

  describe('query parsing', () => {
    it('should parse repeated keys as arrays and keep bracket keys literal (simple parser)', async () => {
      const { server, port } = await startServer({
        ocRoutes: [['get', '/query', (req, res) => res.json(req.query)]]
      });

      try {
        const response = await request(port, {
          path: '/query?a=1&a=2&b=c&d%5Be%5D=f'
        });
        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.a).to.eql(['1', '2']);
        expect(body.b).to.equal('c');
        expect(body['d[e]']).to.equal('f');
      } finally {
        await server.close();
      }
    });
  });

  describe('cookies', () => {
    it('should parse plain and j:-prefixed JSON cookies', async () => {
      const { server, port } = await startServer({
        ocRoutes: [['get', '/cookies', (req, res) => res.json(req.cookies)]]
      });

      try {
        const response = await request(port, {
          path: '/cookies',
          headers: {
            cookie: 'session=abc; theme=light; prefs=j:%7B%22a%22%3A1%7D'
          }
        });
        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.session).to.equal('abc');
        expect(body.theme).to.equal('light');
        expect(body.prefs).to.eql({ a: 1 });
      } finally {
        await server.close();
      }
    });
  });

  describe('urlencoded bodies', () => {
    it('should parse extended (qs) urlencoded bodies', async () => {
      const { server, port } = await startServer({
        ocRoutes: [['post', '/form', (req, res) => res.json(req.body)]]
      });

      try {
        const response = await request(port, {
          method: 'POST',
          path: '/form',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'name=oc&a%5Bb%5D=1&a%5Bb%5D=2&list%5B%5D=x&list%5B%5D=y'
        });
        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.name).to.equal('oc');
        expect(body.a).to.eql({ b: ['1', '2'] });
        expect(body.list).to.eql(['x', 'y']);
      } finally {
        await server.close();
      }
    });
  });

  describe('payload limit', () => {
    it('should respond 413 when the JSON body exceeds postRequestPayloadSize', async () => {
      const { server, port } = await startServer({
        options: { postRequestPayloadSize: '1kb' },
        ocRoutes: [['post', '/limited', (req, res) => res.json(req.body)]]
      });

      try {
        const response = await request(port, {
          method: 'POST',
          path: '/limited',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data: 'x'.repeat(2048) })
        });
        expect(response.statusCode).to.equal(413);
      } finally {
        await server.close();
      }
    });
  });

  describe('multipart uploads', () => {
    it('should populate req.files and req.body for PUT multipart requests', async () => {
      const { server, port, tempDir } = await startServer({
        options: { local: false },
        ocRoutes: [
          [
            'put',
            '/upload',
            (req, res) =>
              res.json({
                body: req.body,
                files: (req.files || []).map((file) => ({
                  fieldname: file.fieldname,
                  originalname: file.originalname,
                  mimetype: file.mimetype,
                  size: file.size,
                  filename: file.filename
                }))
              })
          ]
        ]
      });

      try {
        const form = new FormData();
        // multer's fieldSize limit is 10 bytes — keep the value short
        form.append('name', 'oc');
        form.append(
          'file',
          new File(['fake-tar-content'], 'component-1.0.0.tar.gz', {
            type: 'application/gzip'
          })
        );

        const response = await fetch(`http://127.0.0.1:${port}/upload`, {
          method: 'PUT',
          body: form
        });

        expect(response.status).to.equal(200);
        const body = await response.json();
        expect(body.body).to.eql({ name: 'oc' });
        expect(body.files).to.have.length(1);
        expect(body.files[0].fieldname).to.equal('file');
        expect(body.files[0].originalname).to.equal('component-1.0.0.tar.gz');
        expect(body.files[0].size).to.equal('fake-tar-content'.length);

        const written = path.join(tempDir, body.files[0].filename);
        expect(fs.existsSync(written)).to.equal(true);
        expect(fs.readFileSync(written, 'utf8')).to.equal('fake-tar-content');
      } finally {
        await server.close();
      }
    });
  });

  describe('OPTIONS preflight', () => {
    it('should answer OPTIONS with a sorted Allow header for matching routes', async () => {
      const { server, port } = await startServer({
        ocRoutes: [
          ['get', '/res', (_req, res) => res.send('ok')],
          ['post', '/res', (_req, res) => res.send('ok')]
        ]
      });

      try {
        const response = await request(port, {
          method: 'OPTIONS',
          path: '/res'
        });
        expect(response.statusCode).to.equal(200);
        expect(response.headers['allow']).to.equal('GET, HEAD, POST');
        expect(response.body).to.equal('GET, HEAD, POST');
      } finally {
        await server.close();
      }
    });

    it('should still 404 OPTIONS for unmatched paths', async () => {
      const { server, port } = await startServer({
        ocRoutes: [['get', '/res', (_req, res) => res.send('ok')]]
      });

      try {
        const response = await request(port, {
          method: 'OPTIONS',
          path: '/elsewhere'
        });
        expect(response.statusCode).to.equal(404);
      } finally {
        await server.close();
      }
    });
  });
});
