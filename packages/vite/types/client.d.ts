// Types entry for `@guestlinelabs/oc-vite/client`.
//
// `dist/client.d.ts` (emitted from src/client.ts) carries the runtime
// export signatures and the `declare global` OC/Window types. This wrapper
// additionally pulls in `dist/client-ambient.d.ts`, which holds the
// wildcard stylesheet `declare module` blocks that cannot live inside a
// module file.
/// <reference path="../dist/client-ambient.d.ts" />
export * from '../dist/client.js';
