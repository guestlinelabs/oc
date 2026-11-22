# @guestlinelabs/oc-vite

Vite plugin and runtime for OpenComponents components. `vite build` (or
`oc package` from [`@guestlinelabs/oc`](../cli)) writes `_package/` with the
`template.js`, `server.js`, static files and `package.json` an OC registry
expects, as an `oc-template-esm` component.

- **Runtime:** Bun ≥ 1.4.3
- **Peer dependency:** `vite` 6, 7 or 8

## Entry points

| Import | Contents |
| --- | --- |
| `@guestlinelabs/oc-vite` | `Server`, `ServerError` and the data-provider types |
| `@guestlinelabs/oc-vite/client` | `serverClient`, `getInitialData`, `getSettings`, `InitialData`, `ActionOutput`, `window.oc` and CSS module types |
| `@guestlinelabs/oc-vite/renderer` | `createComponent`, `getShadowRoot` |
| `@guestlinelabs/oc-vite/plugin` | `oc()` Vite plugin (also the default export) |

## Usage

```ts
// vite.config.ts
import { oc } from '@guestlinelabs/oc-vite/plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), oc()],
  build: { rollupOptions: { external: ['react', 'react-dom/client'] } }
});
```

```ts
// src/server.ts
import { Server } from '@guestlinelabs/oc-vite';

export const server = new Server()
  .withParameters({
    name: { type: 'string', mandatory: true, example: 'World' }
  })
  .handler(async ({ name }) => ({ greeting: `Hello ${name}` }));

declare module '@guestlinelabs/oc-vite' {
  interface Register {
    server: typeof server;
  }
}
```

The component's `package.json` points `oc.files.data` at the server entry and
`oc.files.template.src` at a client entry that exports
`createComponent({ mount, unmount })` from `@guestlinelabs/oc-vite/renderer`.

`bunx --bun vite` starts a single-component dev server: preview page, data
provider, actions, mocked plugins from `oc.json` and HMR. It must run under
Bun.

## License

MIT
