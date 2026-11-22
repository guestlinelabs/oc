import { spawn } from 'node:child_process';
import strings from '@guestlinelabs/oc-registry/resources';
import type { RegistryCli } from '../domain/registry';
import type { Logger } from '../logger';

function openUrl(url: string): Promise<void> {
  const [command, args] =
    process.platform === 'darwin'
      ? (['open', [url]] as const)
      : process.platform === 'win32'
        ? (['cmd', ['/c', 'start', '', url]] as const)
        : (['xdg-open', [url]] as const);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', reject);
    child.on('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

const preview =
  ({ logger, registry }: { logger: Logger; registry: RegistryCli }) =>
  async (opts: { componentHref: string }): Promise<string> => {
    try {
      const href = await registry.getComponentPreviewUrlByUrl(
        opts.componentHref
      );
      await openUrl(href);
      return href;
    } catch {
      logger.err(strings.errors.cli.COMPONENT_HREF_NOT_FOUND);
      throw strings.errors.cli.COMPONENT_HREF_NOT_FOUND;
    }
  };

export default preview;
