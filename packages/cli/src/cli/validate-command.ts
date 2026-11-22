import strings from '@guestlinelabs/oc-registry/resources';
import commands from './commands';

type CommandArgv = {
  _: (string | number)[];
};

export default function validateCommand(
  argv: CommandArgv,
  level: number
): true {
  let keys = Object.keys(commands.commands);
  if (level === 1) {
    keys = Object.keys(
      (commands as any).commands[String(argv._[0])]?.commands || {}
    );
  }

  if (argv._.length > level && !keys.includes(String(argv._[level]))) {
    throw new Error(
      strings.messages.cli.NO_SUCH_COMMAND(String(argv._[level]))
    );
  }

  return true;
}
