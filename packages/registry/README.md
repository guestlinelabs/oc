# @guestlinelabs/oc-registry

OpenComponents registry server — a Bun-based fork of `oc-registry`,
wire-compatible with the OC registry protocol `0.50.x`.

- **Runtime:** Bun ≥ 1.4.3 (CommonJS; Node.js is not supported)
- **CLI counterpart:** [`@guestlinelabs/oc`](../cli) (`oc dev`, `oc package`,
  `oc publish`, …)

## Usage

```ts
import { Registry } from '@guestlinelabs/oc-registry';

const registry = Registry({
  local: true,
  port: 3000,
  baseUrl: 'http://localhost:3000/',
  path: './components'
});

const { app, server } = await registry.start();
// …
await registry.close();
```

`Registry(options)` returns `{ start, close, on, register, app }`.
`start()` / `close()` / `register()` are promise-based.

## Documentation

See [`MIGRATION.md`](../../MIGRATION.md) at the repository root for the full
guide: configuration options (including the removed upstream options and
their replacements), storage adapters, plugins, events, and entry points.

## License

MIT
