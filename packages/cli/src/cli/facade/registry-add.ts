import strings from '@guestlinelabs/oc-registry/resources';
import type { RegistryCli } from '../domain/registry';
import type { Logger } from '../logger';

const registryAdd =
  ({ registry, logger }: { logger: Logger; registry: RegistryCli }) =>
  async (opts: { registryUrl: string }): Promise<void> => {
    try {
      await registry.add(opts.registryUrl);
      logger.ok(strings.messages.cli.REGISTRY_ADDED);
    } catch (err) {
      logger.err(String(err));
      throw err;
    }
  };

export default registryAdd;
