# OpenComponents for Bun

A Bun-only fork of the [OpenComponents](https://opencomponents.github.io)
toolchain with no external runtime dependencies. It stays wire compatible with
OC registries and CLIs at `0.50.x`, so components published with the upstream
toolchain keep working.

| Package | What it is |
| --- | --- |
| [`@guestlinelabs/oc-registry`](packages/registry) | Embeddable registry server on `Bun.serve`. Optional Azure Blob Storage adapter (`@guestlinelabs/oc-registry/azure`, with `@azure/storage-blob` and `@azure/identity` as optional peers). |
| [`@guestlinelabs/oc`](packages/cli) | The `oc` CLI: `dev`, `package`, `publish`, `validate`, `mock`, `preview`, `registry`. Builds components with Vite and the `oc()` plugin. |
| [`@guestlinelabs/oc-vite`](packages/vite) | Vite plugin that packages a component for the registry, plus the `Server` runtime, client helpers and `createComponent`. Its only peer dependency is `vite`. |

See [MIGRATION.md](MIGRATION.md) for moving a registry host or a component
from upstream OpenComponents.

## Requirements

- [Bun](https://bun.com) 1.4.3 or later. Node.js is not supported.

## Development

```bash
bun install
bun run build      # registry, then vite, then cli
bun run test       # builds first; tests run against dist/
bun run typecheck
bun run lint
```

## Releasing

All three packages are versioned together (currently `1.0.0-alpha.0`) and
publish with the `alpha` dist-tag (`publishConfig.tag`).

1. Bump `version` in `packages/registry`, `packages/vite` and `packages/cli`.
2. `bun run release:check` (tests, type-check and a dry-run pack of each
   package).
3. Publish in dependency order, logged in to npm with access to the
   `@guestlinelabs` scope:

   ```bash
   (cd packages/registry && bun publish)
   (cd packages/vite && bun publish)
   (cd packages/cli && bun publish)
   ```

   Use `bun publish` rather than `npm publish`: it replaces the
   `workspace:*` dependencies with the published versions. `prepublishOnly`
   rebuilds the whole workspace first.

## License

[MIT](LICENSE). Derived from [OpenComponents](https://github.com/opencomponents/oc).
