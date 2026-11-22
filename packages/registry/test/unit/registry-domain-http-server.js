const expect = require('chai').expect;

const { createHttpServer } =
  require('../../dist/registry/domain/http-server/server');

describe('registry : domain : http-server', () => {
  describe('createHttpServer', () => {
    it('supports promise-based listen and close', async () => {
      const server = createHttpServer();

      await server.listen({ port: 0, timeout: 120000 });
      expect(server.isListening()).to.equal(true);

      await server.close();
      expect(server.isListening()).to.equal(false);
    });

    it('exposes the bound port through httpServer()', async () => {
      const server = createHttpServer();

      await server.listen({ port: 0, timeout: 120000 });
      const port = server.httpServer().port;

      expect(port).to.be.a('number').and.to.be.greaterThan(0);
      await server.close();
    });

    it('serves requests through registry.app routes', async () => {
      const server = createHttpServer();

      server.app.get('/health', () => 'ok');
      server.route('get', '/oc-route', 'oc-route', [
        (_req, res) => res.send('oc-ok')
      ]);

      await server.listen({ port: 0, timeout: 120000 });
      const port = server.httpServer().port;

      try {
        const hostResponse = await fetch(`http://127.0.0.1:${port}/health`);
        expect(hostResponse.status).to.equal(200);
        expect(await hostResponse.text()).to.equal('ok');

        const ocResponse = await fetch(`http://127.0.0.1:${port}/oc-route`);
        expect(ocResponse.status).to.equal(200);
        expect(await ocResponse.text()).to.equal('oc-ok');

        const missing = await fetch(`http://127.0.0.1:${port}/nope`);
        expect(missing.status).to.equal(404);
      } finally {
        await server.close();
      }
    });

    it('lets onRequest hooks short-circuit requests', async () => {
      const server = createHttpServer();

      server.app.onRequest((_req, ctx) => {
        if (ctx.path === '/blocked') {
          return new Response('blocked', { status: 403 });
        }
      });
      server.app.get('/open', () => 'open');

      await server.listen({ port: 0, timeout: 120000 });
      const port = server.httpServer().port;

      try {
        const blocked = await fetch(`http://127.0.0.1:${port}/blocked`);
        expect(blocked.status).to.equal(403);
        expect(await blocked.text()).to.equal('blocked');

        const open = await fetch(`http://127.0.0.1:${port}/open`);
        expect(open.status).to.equal(200);
        expect(await open.text()).to.equal('open');
      } finally {
        await server.close();
      }
    });
  });
});
