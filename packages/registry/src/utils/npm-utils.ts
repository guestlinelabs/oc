import path from 'node:path';
import stripVersion from './strip-version';

const buildInstallCommand = (options: {
  installPath: string;
  all?: boolean;
  save?: boolean;
  isDev?: boolean;
  usePrefix: boolean;
}) => {
  const args = ['install'];

  if (options.usePrefix) {
    args.push('--prefix', options.installPath);
  }

  if (options.all) return args;

  if (options.save) {
    args.push('--save-exact');
    args.push(options.isDev ? '--save-dev' : '--save');
  } else {
    args.push('--no-save');
  }

  return args;
};

const executeCommand = (options: {
  command: string[];
  path: string;
  silent?: boolean;
}) => {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(['npm', ...options.command, '--no-package-lock'], {
      cwd: options.path,
      stdio: options.silent
        ? ['ignore', 'ignore', 'ignore']
        : ['inherit', 'inherit', 'inherit']
    });
  } catch {
    return Promise.reject(new Error('error'));
  }

  return proc.exited.then((code) => {
    if (code !== 0) {
      throw code;
    }
  });
};

const getFullPath = ({
  installPath,
  dependency
}: {
  installPath: string;
  dependency: string;
}) => path.join(installPath, 'node_modules', stripVersion(dependency));

export const init = (options: {
  initPath: string;
  silent: boolean;
}): Promise<void> => {
  const { initPath, silent } = options;
  const npminit = ['init', '--yes'];
  const cmdOptions = { path: initPath, command: npminit, silent };

  return executeCommand(cmdOptions);
};

export const installDependencies = async (options: {
  dependencies?: string[];
  installPath: string;
  silent: boolean;
  usePrefix: boolean;
}): Promise<{ dest: string[] }> => {
  const { dependencies, installPath, silent } = options;
  const npmi = buildInstallCommand({
    ...options,
    all: !dependencies?.length
  });
  const cmdOptions = {
    command: [...npmi, ...(dependencies ?? [])],
    path: installPath,
    silent
  };

  const dest =
    dependencies?.map((dependency) =>
      getFullPath({ installPath, dependency })
    ) ?? [];

  await executeCommand(cmdOptions);

  return { dest };
};

export const installDependency = async (options: {
  dependency: string;
  installPath: string;
  silent?: boolean;
  usePrefix: boolean;
}): Promise<{ dest: string }> => {
  const { dependency, installPath, silent } = options;
  const npmi = buildInstallCommand(options);
  const cmdOptions = {
    command: [...npmi, dependency],
    path: installPath,
    silent
  };
  const dest = getFullPath({ installPath, dependency });

  await executeCommand(cmdOptions);

  return { dest };
};
