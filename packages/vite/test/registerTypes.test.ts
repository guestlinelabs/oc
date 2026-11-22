import { expect, test } from 'bun:test';
import path from 'node:path';

// Components augment `Register` with `declare module '@guestlinelabs/oc-vite'`
// so `getInitialData()` and `serverClient` are typed from their Server. That
// only works while `Register` is an interface (type aliases cannot merge).
test('Register augmentation types serverClient and getInitialData', () => {
  const project = path.join(import.meta.dir, 'types/register');
  const tsc = Bun.spawnSync(
    [process.execPath, require.resolve('typescript/bin/tsc'), '-p', project],
    { stdout: 'pipe', stderr: 'pipe' }
  );
  expect(tsc.stdout.toString() + tsc.stderr.toString()).toBe('');
  expect(tsc.exitCode).toBe(0);
});
