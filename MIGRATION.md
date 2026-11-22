# Migrating from upstream OpenComponents

This repository publishes a Bun-based fork of the OpenComponents toolchain:

| Package | Replaces | Purpose |
| --- | --- | --- |
| `@guestlinelabs/oc-registry` | `oc` (registry) | Embeddable OC registry server |
| `@guestlinelabs/oc` | `oc` (CLI) | `oc` CLI (`dev`, `package`, `publish`, `validate`, …) |
| `@guestlinelabs/oc-vite` | `oc-server`, `oc-template-esm-compiler` | Vite plugin, `Server` runtime and client helpers |

The packages are published at version `1.0.0-alpha.0` but remain **wire
compatible with OC registry protocol `0.50.x`**: the registry reports
`ocVersion: "0.50.67"` (see `OC_VERSION` in
`@guestlinelabs/oc-registry/version`), and the CLI sends the
`oc-cli-0.50.67/…` user agent so existing registries keep accepting it.

## Runtime requirements

- **Bun ≥ 1.4.3** is required (`engines.bun`). Both packages are CommonJS and
  are intended to run under `bun` / `bunx`. Node.js is not a supported
  runtime for the registry server or the CLI.
- The CLI binary is `oc` (`#!/usr/bin/env bun`), e.g. `bunx oc --help` or
  `bunx @guestlinelabs/oc publish …`.

## Registry hosts

### Install

```bash
bun add @guestlinelabs/oc-registry
```

For Azure Blob Storage, install the peer dependencies and import the
bundled adapter from the `./azure` subpath:

```bash
bun add @azure/identity @azure/storage-blob
```

### Minimal example (local development registry)

```ts
import { Registry } from '@guestlinelabs/oc-registry';

const registry = Registry({
  local: true,
  port: 3000,
  baseUrl: 'http://localhost:3000/',
  path: './components', // local mode: folder with component sources
  discovery: { validate: true }
});

const { app, server } = await registry.start();
console.log(`registry on ${server.port}`);

// later: await registry.close();
```

### Production example (non-local, Azure storage)

```ts
import { Registry } from '@guestlinelabs/oc-registry';
import azureAdapter from '@guestlinelabs/oc-registry/azure';

const registry = Registry({
  local: false,
  port: 8080,
  baseUrl: 'https://components.example.com/',
  prefix: '/',
  storage: {
    adapter: azureAdapter,
    options: {
      componentsDir: 'components',
      path: 'https://cdn.example.com/', // public URL prefix for static files
      publicContainerName: 'oc-public',
      privateContainerName: 'oc-private',
      accountName: '<storage-account>'
      // accountKey omitted -> DefaultAzureCredential is used
    }
  },
  publishAuth: {
    type: 'basic',
    logins: [{ username: 'ci', password: process.env.PUBLISH_PASSWORD! }]
  },
  publishValidation: (pkgJson, { user }) => ({ isValid: true })
});

await registry.start();
```

`Registry(options)` returns `{ start, close, on, register, app }`.
`start()` resolves to `{ app, server }` where `server` is the Bun.serve
`Server`. `close()` stops accepting requests and closes the repository.

### Storage adapters

`storage.adapter` is a **factory** `(options) => StorageAdapter`; the
adapter object must implement:

```ts
interface StorageAdapter {
  adapterType: string;
  maxConcurrentRequests: number;
  isValid(): boolean;
  getFile(filePath: string, force?: boolean): Promise<string>;
  getJson<T = unknown>(filePath: string, force?: boolean): Promise<T>;
  getUrl(componentName: string, version: string, fileName: string): string;
  listSubDirectories(dir: string): Promise<string[]>;
  putDir(dirInput: string, dirOutput: string, isPrivateFile?: (p: string) => boolean): Promise<unknown>;
  putFile(filePath: string, fileName: string, isPrivate: boolean): Promise<unknown>;
  putFileContent(data: string | Buffer, fileName: string, isPrivate: boolean): Promise<unknown>;
  removeDir(dir: string): Promise<unknown>;
  removeFile(filePath: string, isPrivate: boolean): Promise<unknown>;
}
```

`storage.options` must contain `componentsDir` (blob/prefix under which
`<name>/<version>/` trees live, plus `components.json` /
`components-details.json` indexes) and `path` (public URL prefix used to
build component file URLs). Files classified as private (`server.js`,
dot-files) are stored in the private container and are never served over
HTTP.

Static files are **not** proxied by the registry in non-local mode: requests
to `/:component/:version/static/*` answer `302` to
`${storage.options.path}${componentsDir}/<name>/<version>/<file>`, i.e. your
CDN/blob public URL must serve that prefix.

### Removed / changed options

The registry configuration validator rejects these upstream `oc-registry`
options with a dedicated migration error — remove them or replace with the
listed alternative:

| Removed option | Replacement |
| --- | --- |
| `metadata` | component `package.json` `oc` fields |
| `routes` | `app`/`server` from `start()`; add your own Bun routes |
| `beforePublish` | `publishValidation` / `publishAuth` |
| `baseUrlFunc`, `discoveryFunc` | fixed `baseUrl` + `discovery` options |
| `customHeadersToSkipOnWeakVersion` | not supported |
| `tarExtractMode` | not supported (ustar archives only) |
| `preload` | not supported |
| `s3` | bring your own `StorageAdapter` (see above) |
| `server` | HTTP layer is the built-in Bun.serve server |
| `keepAliveTimeout` | not supported (Bun.serve manages keep-alive) |

Other notable options: `publishAuth` (`{ type: 'basic', username, password }`,
`{ type: 'basic', logins: [...] }`, or `{ type: '<name>', … }` resolved from an
`oc-auth-<name>` module), `publishValidation(pkgJson, { user })`,
`discovery` (`{ ui, api, validate, robots, transformInfo }` or `false`),
`cors`, `dataProvider.enabled`, `plugins`, `templates` (extra
`Template` renderers), `prefix`, `tempDir`, `compileClient`,
`executionTimeout`, `postRequestPayloadSize`,
`pollingInterval`, `refreshInterval`, `liveReloadPort`, `hotReloading`,
`fallbackClient`, `fallbackRegistryUrl`, `onComponentRequest`.

### Events and plugins

```ts
registry.on('component-published', ({ componentName, componentVersion }) => {});
registry.on('request', (req) => {});
registry.on('error', (err) => {});
```

Available events: `start`, `request`, `component-retrieved`,
`data-provider-error`, `component-published`, `cache-poll`, `error`.
Plugins are registered with `await registry.register(plugin)`.

### Entry points

| Import | Contents |
| --- | --- |
| `@guestlinelabs/oc-registry` | `Registry`, `OC_VERSION`, all public types |
| `@guestlinelabs/oc-registry/types` | `Config`, `Component`, `Template`, … |
| `@guestlinelabs/oc-registry/version` | `OC_VERSION` constant |
| `@guestlinelabs/oc-registry/azure` | Azure Blob `StorageAdapter` factory |
| `@guestlinelabs/oc-registry/testing` | Test helpers (`version-handler` fns, `getComponent`, `repository`) |
| `@guestlinelabs/oc-registry/resources` (+ `/*`) | Settings/strings/resources |
| `@guestlinelabs/oc-registry/utils/*` | Shared utilities (`ocConfig`, `http`, `put`, …) |
| `@guestlinelabs/oc-registry/registry/domain/validators` | Package/component validators |
| `@guestlinelabs/oc-registry/registry/domain/url-builder` | URL builder helpers |
| `@guestlinelabs/oc-registry/dist/*` | Escape hatch to any compiled file |

`@guestlinelabs/oc-registry/testing` replaces the deep
`oc/dist/registry/...` imports host test suites used with upstream `oc`.

## Component authors

Existing components do not have to change. Components built with the
upstream `oc` CLI and template compilers (`oc-template-react`,
`oc-template-typescript-react`, `oc-template-es6`, `oc-template-solid`,
`oc-template-esm`) keep publishing to, and being served by,
`@guestlinelabs/oc-registry`.

The `@guestlinelabs/oc` CLI only builds components through Vite with the
`oc()` plugin from `@guestlinelabs/oc-vite`, which emits `oc-template-esm`
packages. To move a component over:

1. Make the client entry (`oc.files.template.src`) an ESM component and set
   `oc.files.template.type` to `oc-template-esm`:

   ```tsx
   import { createComponent } from '@guestlinelabs/oc-vite/renderer';
   import { createRoot, type Root } from 'react-dom/client';
   import App from './App';

   export default createComponent(() => {
     let root: Root | undefined;
     return {
       mount(element, props) {
         root = createRoot(element);
         root.render(<App {...props} />);
       },
       unmount() {
         root?.unmount();
       }
     };
   });
   ```

2. Rename imports: `oc-server` → `@guestlinelabs/oc-vite`,
   `oc-server/client` → `@guestlinelabs/oc-vite/client`,
   `oc-template-esm-compiler/renderer` → `@guestlinelabs/oc-vite/renderer`,
   and `declare module 'oc-server'` → `declare module '@guestlinelabs/oc-vite'`.
3. Add the plugin to `vite.config.ts`; mark libraries the page provides via
   its import map as external:

   ```ts
   import { oc } from '@guestlinelabs/oc-vite/plugin';
   import react from '@vitejs/plugin-react';
   import { defineConfig } from 'vite';

   export default defineConfig({
     plugins: [react(), oc()],
     build: { rollupOptions: { external: ['react', 'react-dom/client'] } }
   });
   ```

4. Replace `oc`, `oc-server` and the `oc-template-*-compiler` devDependencies
   with `@guestlinelabs/oc`, `@guestlinelabs/oc-vite` and `vite`. Scripts keep
   using the `oc` binary:

   ```bash
   oc dev .. 3000 --components my-component
   oc package . --compress
   oc publish . --registries https://components.example.com/
   bunx --bun vite   # single-component dev server with HMR
   ```

- `oc.json` (`registries`, `development.*`) keeps the same format. In
  `oc dev`, `development.importmap.imports` is read from the component's own
  folder first, so a component can carry the import map its externals need.
- `publish` supports `--dryRun`, `--skipPackage`, `--registries`,
  `--username/--password/--token`.
- The CLI reports itself to registries as `oc-cli-0.50.67`, so publishing
  to a stock `oc-registry@0.50.x` still passes its CLI/node version
  validation.

## Known differences / limitations

- Bun-only runtime. `vite dev` with the plugin must run under Bun
  (`bunx --bun vite`).
- `.tgz` packages are written as POSIX ustar archives with explicit
  directory entries; extraction behaviour matches upstream `tar` output.
- No server-side rendering: rendered requests run the compiled template in a
  sandbox without framework globals.
- Registry HTTP handling is a handwritten Bun.serve adapter (no Express);
  `OcHandler`/`OcRequest`/`OcResponse` middleware types are exported for
  hosts that need them.
