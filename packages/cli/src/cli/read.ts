/**
 * Replacement for the `read` package used when `oc publish` needs to prompt
 * for registry credentials.
 *
 * `read({})` reads one line from stdin (the terminal echoes it, like the
 * original package). `read({ silent: true })` reads a line without echoing
 * by switching stdin to raw mode, falling back to a normal line read when
 * stdin is not a TTY.
 */

const CTRL_C = String.fromCharCode(3);
const BACKSPACE = String.fromCharCode(127);
const DELETE = '\b';

function readLine(): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let data = '';

    const cleanup = () => {
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.off('error', onError);
      stdin.pause();
    };
    const onData = (chunk: Buffer | string) => {
      data += chunk.toString();
      const newline = data.indexOf('\n');
      if (newline >= 0) {
        cleanup();
        resolve(data.slice(0, newline).replace(/\r$/, ''));
      }
    };
    const onEnd = () => {
      cleanup();
      resolve(data.replace(/\r?\n$/, ''));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.on('error', onError);
    stdin.resume();
  });
}

function readSilent(): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return readLine();
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = stdin.isRaw;

    const cleanup = () => {
      stdin.off('data', onData);
      stdin.off('error', onError);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    };
    const finish = () => {
      cleanup();
      process.stdout.write('\n');
      resolve(value);
    };
    const onData = (chunk: Buffer | string) => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') {
          finish();
          return;
        }
        if (char === CTRL_C) {
          cleanup();
          process.stdout.write('\n');
          process.exit(130);
        }
        if (char === BACKSPACE || char === DELETE) {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= ' ') {
          value += char;
        }
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    stdin.on('data', onData);
    stdin.on('error', onError);
    stdin.setRawMode(true);
    stdin.resume();
  });
}

export default function read(
  options: { silent?: boolean } = {}
): Promise<string> {
  return options.silent ? readSilent() : readLine();
}
