import type { Server } from 'bun';
import type { Plugin, RegistryApp } from '../types';
import colors from '../utils/colors';
import appStart from './app-start';
import { compileClient } from './domain/compile-client';
import eventsHandler from './domain/events-handler';
import { createHttpServer } from './domain/http-server/server';
import sanitiseOptions, { RegistryOptions } from './domain/options-sanitiser';
import * as pluginsInitialiser from './domain/plugins-initialiser';
import Repository from './domain/repository';
import * as validator from './domain/validators';
import * as middleware from './middleware';
import { create as createRouter } from './router';

export { RegistryOptions };

type RegistryStartResult = { app: RegistryApp; server: Server<undefined> };
const SERVER_ERROR_CODE = 'SERVER_ERROR';

export interface RegistryType {
  close(): Promise<void>;
  on: typeof eventsHandler.on;
  register<T = any>(plugin: Plugin<T>): Promise<void>;
  start(): Promise<RegistryStartResult>;
  app: RegistryApp;
}

const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }

  const errorLike = error as { message?: unknown; msg?: unknown };
  const message = errorLike?.message ?? errorLike?.msg ?? error;
  return new Error(String(message));
};

export default function registry<T = any>(
  inputOptions: RegistryOptions<T>
): RegistryType {
  const validationResult =
    validator.validateRegistryConfiguration(inputOptions);
  if (!validationResult.isValid) {
    throw validationResult.message;
  }
  const options = sanitiseOptions(inputOptions);

  const plugins: Plugin[] = [];
  const server = middleware.bind(createHttpServer(), options);
  const app = server.app;
  const repository = Repository(options);

  const close = (): Promise<void> => {
    const closeRepository = (): Promise<void> =>
      Promise.resolve(repository.close?.()).catch(() => undefined);

    const closeServer = new Promise<void>((resolve, reject) => {
      if (!server.isListening()) {
        reject('not opened');
        return;
      }

      server.close().then(resolve, reject);
    });

    return closeServer.finally(closeRepository);
  };

  const register = <T = any>(plugin: Plugin<T>): Promise<void> => {
    plugins.push(plugin);
    return Promise.resolve();
  };

  const start = async (): Promise<RegistryStartResult> => {
    const ok = (msg: string) => console.log(colors.green(msg));

    try {
      options.plugins = await pluginsInitialiser.init(plugins);
      await compileClient(options);
      createRouter(server, options, repository);
      const componentsInfo = await repository.init();
      await appStart(repository, options);

      const listenPromise = server.listen({
        port: options.port,
        timeout: options.timeout
      });
      const serverError = new Promise<never>((_resolve, reject) => {
        server.onServerError((error) => {
          eventsHandler.fire('error', {
            code: SERVER_ERROR_CODE,
            message: error?.message ?? String(error)
          });
          reject(toError(error));
        });
      });
      void serverError.catch(() => undefined);

      await Promise.race([listenPromise, serverError]);
      eventsHandler.fire('start', {});

      if (options.verbosity) {
        ok(
          `Registry started at port http://localhost:${options.port}${options.prefix}`
        );

        if (componentsInfo) {
          const componentsNumber = Object.keys(
            componentsInfo.components
          ).length;
          const componentsReleases = Object.values(
            componentsInfo.components
          ).reduce((acc, component) => acc + Object.keys(component).length, 0);

          ok(
            `Registry serving ${componentsNumber} components for a total of ${componentsReleases} releases.`
          );
        }
      }

      return { app, server: server.httpServer() };
    } catch (err) {
      throw toError(err);
    }
  };

  return {
    close,
    on: eventsHandler.on,
    register,
    start,
    app
  };
}
