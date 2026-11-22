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

All three packages share one version and are released together with one
command, from a clean `main` that matches `origin/main`, logged in to npm
with publish access to the `@guestlinelabs` scope (`npm login`):

```bash
bun run release              # publish the current version (first release)
bun run release prerelease   # 1.0.0-alpha.0 -> 1.0.0-alpha.1
bun run release patch        # or minor / major; 1.0.0-alpha.3 -> 1.0.0
bun run release 1.2.0        # an explicit version
bun run release patch --dry-run
```

The script ([scripts/release.ts](scripts/release.ts)):

1. runs `release:check` (lint, tests, type-check, dry-run pack);
2. sets the new version in every package and `bun.lock`, commits
   `Release vX` and tags `vX`;
3. runs `bun publish --recursive`, which publishes in dependency order,
   replaces `workspace:*` with the real version and skips versions already
   on npm. Prereleases go to their dist-tag (`alpha`), others to `latest`;
4. pushes the commit and the tag.

With npm two-factor auth, pass `--otp <code>` or answer the prompt. If a
publish fails part-way, fix the cause and run `bun run release` again; it
resumes from the local release commit and only publishes what is missing.
Running `bun run release` again once everything is on npm does nothing.

## License

[MIT](LICENSE). Derived from [OpenComponents](https://github.com/opencomponents/oc).
