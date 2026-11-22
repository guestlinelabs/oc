# @guestlinelabs/oc

The OpenComponents `oc` CLI for Bun. It builds components with the
component's own Vite and the `oc()` plugin from
[`@guestlinelabs/oc-vite`](../vite), and talks to any OC registry at `0.50.x`.

- **Runtime:** Bun ≥ 1.4.3
- **Binary:** `oc`

## Install

```bash
bun add -d @guestlinelabs/oc @guestlinelabs/oc-vite vite
```

## Commands

```bash
oc dev <dir> [port] --components my-component --prefix /registry/ --fallbackRegistryUrl https://components.example.com/
oc package <component> [--compress]
oc validate <component> --registries https://components.example.com/ [--skipPackage]
oc publish <component> --registries https://components.example.com/ [--token <token>] [--skipPackage] [--dryRun]
oc mock plugin <name> <value>
oc preview <href>
oc registry add|ls|remove <url>
```

Only components that use the `oc()` Vite plugin (`oc-template-esm`) can be
built with this CLI. Components on the older template compilers keep using the
upstream `oc` CLI; the registry serves both.

See the repository [MIGRATION.md](../../MIGRATION.md) for setting up a component.

## License

MIT
