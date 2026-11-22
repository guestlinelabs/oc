import { getInitialData, serverClient } from '@guestlinelabs/oc-vite/client';
import './server';

const data = getInitialData();
const site: string = data.site;
const count: number = data.count;
async function f() {
  const r = await serverClient.save({ name: 'x' });
  const ok: true = r.ok;
  return [site, count, ok];
}
// @ts-expect-error unknown action must not type-check
serverClient.nope;

export { f };
