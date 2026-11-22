import { Server } from '@guestlinelabs/oc-vite';
export const server = new Server()
  .handler(async (params: { siteId: string }) => ({
    site: params.siteId,
    count: 1
  }))
  .action('save', async (input: { name: string }) => ({
    ok: true as const,
    name: input.name
  }));
declare module '@guestlinelabs/oc-vite' {
  interface Register {
    server: typeof server;
  }
}
