/**
 * Tiny SSE-based live-reload server replacing the `livereload` package.
 *
 * The registry injects
 * `<script src="http://localhost:<liveReloadPort>/livereload.js?snipver=1">`
 * into preview pages (see `registry/routes/component-preview.ts`), so this
 * server must answer `GET /livereload.js` with a browser snippet and keep
 * `GET /events` open as a Server-Sent Events stream. `refresh()` broadcasts
 * a reload message to every connected client.
 */

const CLIENT_SNIPPET = `(function () {
  var src = (document.currentScript && document.currentScript.src) || '';
  var origin = src ? src.replace(/\\/livereload\\.js[^]*$/, '') : '';
  if (!origin) return;
  var events = new EventSource(origin + '/events');
  events.onmessage = function () {
    window.location.reload();
  };
})();
`;

const PING_INTERVAL_MS = 25000;

export interface LiveReloadServer {
  /** Actual port the server is bound to. */
  port: number;
  /** Broadcast a reload event to all connected clients. */
  refresh: () => void;
  /** Stop the server and close all client streams. */
  stop: () => void;
}

export function createLiveReloadServer(port: number): LiveReloadServer {
  const encoder = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    fetch(request) {
      const { pathname } = new URL(request.url);

      if (pathname === '/livereload.js') {
        return new Response(CLIENT_SNIPPET, {
          headers: {
            'content-type': 'application/javascript; charset=utf-8',
            'access-control-allow-origin': '*'
          }
        });
      }

      if (pathname === '/events') {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            clients.add(controller);
            controller.enqueue(encoder.encode('retry: 1000\n\n'));
          },
          cancel(controller) {
            clients.delete(controller);
          }
        });
        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
            'access-control-allow-origin': '*'
          }
        });
      }

      return new Response('Not found', { status: 404 });
    }
  });

  const ping = setInterval(() => {
    if (clients.size === 0) return;
    const chunk = encoder.encode(': ping\n\n');
    for (const controller of clients) {
      try {
        controller.enqueue(chunk);
      } catch {
        clients.delete(controller);
      }
    }
  }, PING_INTERVAL_MS);
  ping.unref?.();

  return {
    port: server.port ?? port,
    refresh() {
      const chunk = encoder.encode('data: reload\n\n');
      for (const controller of clients) {
        try {
          controller.enqueue(chunk);
        } catch {
          clients.delete(controller);
        }
      }
    },
    stop() {
      clearInterval(ping);
      for (const controller of clients) {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
      clients.clear();
      server.stop(true);
    }
  };
}
