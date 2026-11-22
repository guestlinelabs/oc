import strings from '@guestlinelabs/oc-registry/resources';
import commands from './commands';
import validateCommand from './validate-command';

/**
 * Minimal command-line parser replacing yargs.
 *
 * The parser is driven entirely by the declarative command tree in
 * `commands.ts` and reproduces the subset of yargs behaviour the CLI relies
 * on:
 *
 * - positionals declared in each command's `cmd` signature
 *   (`dev <dirPath> [port] [baseUrl]`)
 * - option types (`boolean`, `array`) and `default` values
 * - `--opt value`, `--opt=value`, boolean `--no-<opt>` negation and
 *   `--bool false` literal values
 * - camelCase and kebab-case spellings for every option
 *   (`--skipPackage` / `--skip-package`)
 * - greedy consumption of values by `array` options
 *   (`--components a b` -> `['a', 'b']`, `--components=a,b` -> `['a,b']`)
 * - number coercion identical to yargs-parser (`3001` -> 3001,
 *   `0300` -> '0300', `-5` -> -5)
 * - `--` terminates option parsing; trailing tokens stay in `_` without
 *   being assigned to named positionals
 * - duplicate non-array options collapse into an array
 *   (`--prefix /a --prefix /b` -> `['/a', '/b']`)
 * - unknown commands fail with the same `No such command '<name>'` message
 *   as `validate-command.ts`; unknown options are tolerated
 */

export interface OptionSpec {
  description?: string;
  boolean?: boolean;
  array?: boolean;
  default?: unknown;
}

export interface PositionalSpec {
  name: string;
  required: boolean;
}

export interface ExampleSpec {
  cmd: string;
  description?: string;
}

export interface CommandNode {
  name: string;
  /** Command path segments, e.g. `['registry', 'add']`. */
  path: string[];
  /** Positional signature without the command names, e.g. `<dirPath> [port]`. */
  signature: string;
  description: string;
  usage: string;
  example?: ExampleSpec;
  options: Record<string, OptionSpec>;
  positionals: PositionalSpec[];
  children: Record<string, CommandNode>;
}

export interface CommandTree {
  usage: string;
  commands: Record<string, CommandNode>;
}

export type CliArgv = {
  _: (string | number)[];
  $0: string;
  [key: string]: unknown;
};

export type ParseResult =
  | { type: 'run'; node: CommandNode; argv: CliArgv }
  | { type: 'help'; node: CommandNode | null }
  | { type: 'version' }
  | { type: 'error'; message: string; node: CommandNode | null };

interface RawCommand {
  cmd?: string;
  description: string;
  usage: string;
  example?: { cmd: string; description?: string };
  options?: Record<string, OptionSpec>;
  commands?: Record<string, RawCommand>;
}

const rawRoot = commands as unknown as {
  usage: string;
  commands: Record<string, RawCommand>;
};

function kebabToCamel(text: string): string {
  return text.replace(/-([a-zA-Z0-9])/g, (_match, chr: string) =>
    chr.toUpperCase()
  );
}

function camelToKebab(text: string): string {
  return text.replace(/[A-Z]/g, (chr) => `-${chr.toLowerCase()}`);
}

/** Same numeric detection as yargs-parser's `looksLikeNumber`. */
function looksLikeNumber(value: string): boolean {
  if (value === '') return false;
  // hexadecimal.
  if (/^0x[0-9a-f]+$/i.test(value)) return true;
  // don't treat 0123 as a number; as it drops the leading '0'.
  if (/^0[^.]/.test(value)) return false;
  return /^[-]?(?:\d+(?:\.\d*)?|\.\d+)(e[-+]?\d+)?$/i.test(value);
}

function coerce(value: string): string | number {
  return looksLikeNumber(value) ? Number(value) : value;
}

/** A token that starts an option (`--x`, `-x`) rather than a positional. */
function isOptionToken(token: string): boolean {
  return token.length > 1 && token.startsWith('-') && !looksLikeNumber(token);
}

/** A token that can be consumed as an option value or positional. */
function isValueToken(token: string): boolean {
  return !isOptionToken(token);
}

/**
 * Flags that never consume a following value while scanning for the command
 * path with an empty option spec.
 */
const GLOBAL_VALUELESS_FLAGS = new Set([
  '--help',
  '--version',
  '--no-help',
  '--no-version'
]);

function parseSignature(cmd: string | undefined): {
  signature: string;
  positionals: PositionalSpec[];
} {
  if (!cmd) return { signature: '', positionals: [] };
  const tokens = cmd.trim().split(/\s+/);
  // The first token is the command name itself.
  const rest = tokens.slice(1);
  const positionals: PositionalSpec[] = [];
  for (const token of rest) {
    const required = /^<([^>]+)>$/.exec(token);
    const optional = /^\[([^\]]+)\]$/.exec(token);
    if (required) {
      positionals.push({ name: required[1], required: true });
    } else if (optional) {
      positionals.push({ name: optional[1], required: false });
    }
  }
  return { signature: rest.join(' '), positionals };
}

function buildNode(name: string, path: string[], raw: RawCommand): CommandNode {
  const { signature, positionals } = parseSignature(raw.cmd);
  const node: CommandNode = {
    name,
    path,
    signature,
    description: raw.description,
    usage: raw.usage,
    example: raw.example,
    options: raw.options || {},
    positionals,
    children: {}
  };
  if (raw.commands) {
    for (const [childName, childRaw] of Object.entries(raw.commands)) {
      node.children[childName] = buildNode(
        childName,
        [...path, childName],
        childRaw
      );
    }
  }
  return node;
}

let cachedTree: CommandTree | null = null;

export function getCommandTree(): CommandTree {
  if (!cachedTree) {
    const commandsMap: Record<string, CommandNode> = {};
    for (const [name, raw] of Object.entries(rawRoot.commands)) {
      commandsMap[name] = buildNode(name, [name], raw);
    }
    cachedTree = { usage: rawRoot.usage, commands: commandsMap };
  }
  return cachedTree;
}

interface ResolvedOption {
  /** Canonical (camelCase) key under which the value is stored. */
  key: string;
  spec?: OptionSpec;
  negated: boolean;
}

function resolveOption(
  rawName: string,
  spec: Record<string, OptionSpec>
): ResolvedOption {
  const camel = kebabToCamel(rawName);
  const direct = spec[camel];
  if (direct) {
    return { key: camel, spec: direct, negated: false };
  }

  // Boolean negation: `--no-watch`, `--noWatch`.
  let candidate: string | undefined;
  if (rawName.startsWith('no-')) {
    candidate = kebabToCamel(rawName.slice(3));
  } else if (/^no[A-Z]/.test(camel)) {
    candidate = camel[2].toLowerCase() + camel.slice(3);
  }
  if (candidate) {
    const negatedSpec = spec[candidate];
    if (negatedSpec?.boolean) {
      return { key: candidate, spec: negatedSpec, negated: true };
    }
  }

  return { key: camel, negated: false };
}

function boolValue(raw: string): boolean {
  if (raw === 'false' || raw === '0') return false;
  if (raw === 'true' || raw === '1') return true;
  if (looksLikeNumber(raw)) return Number(raw) !== 0;
  return raw !== '';
}

function pushValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  const existing = target[key];
  if (Array.isArray(existing)) {
    (existing as unknown[]).push(value);
  } else {
    target[key] = [existing, value];
  }
}

function setValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  spec: OptionSpec | undefined
): void {
  if (spec?.array) {
    if (!Object.hasOwn(target, key)) {
      target[key] = [];
    }
    (target[key] as unknown[]).push(value);
    return;
  }
  if (spec?.boolean) {
    // Boolean flags are idempotent; the last occurrence wins.
    target[key] = value;
    return;
  }
  if (Object.hasOwn(target, key)) {
    // yargs collapses duplicate non-array options into an array.
    pushValue(target, key, value);
    return;
  }
  target[key] = value;
}

interface SpecParse {
  positionals: string[];
  literal: string[];
  options: Record<string, unknown>;
}

/**
 * Parse `args` against a command's option spec. Command-name tokens are
 * still present in `args` and are treated like any other positional; the
 * caller drops the first `commandTokenCount` positionals afterwards, which
 * mirrors yargs keeping command names inside `_`.
 */
function parseWithSpec(
  args: string[],
  spec: Record<string, OptionSpec>
): SpecParse {
  const positionals: string[] = [];
  const literal: string[] = [];
  const options: Record<string, unknown> = {};
  let afterSeparator = false;

  for (let i = 0; i < args.length; i++) {
    const token = args[i];

    if (afterSeparator) {
      literal.push(token);
      continue;
    }
    if (token === '--') {
      afterSeparator = true;
      continue;
    }
    if (!isOptionToken(token)) {
      positionals.push(token);
      continue;
    }

    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      const rawName = eq === -1 ? body : body.slice(0, eq);
      const inline = eq === -1 ? undefined : body.slice(eq + 1);
      const resolved = resolveOption(rawName, spec);
      const optionSpec = resolved.spec;

      if (optionSpec?.array) {
        // Array options greedily consume following non-option tokens,
        // including after an `=value` first element.
        if (!Object.hasOwn(options, resolved.key)) {
          options[resolved.key] = [];
        }
        if (inline !== undefined) {
          (options[resolved.key] as unknown[]).push(coerce(inline));
        }
        while (i + 1 < args.length && isValueToken(args[i + 1])) {
          i++;
          (options[resolved.key] as unknown[]).push(coerce(args[i]));
        }
      } else if (optionSpec?.boolean) {
        let value = !resolved.negated;
        if (inline !== undefined) {
          value = resolved.negated ? !boolValue(inline) : boolValue(inline);
        } else if (
          !resolved.negated &&
          (args[i + 1] === 'true' || args[i + 1] === 'false')
        ) {
          i++;
          value = args[i] === 'true';
        }
        setValue(options, resolved.key, value, optionSpec);
      } else {
        let value: unknown = true;
        if (inline !== undefined) {
          value = coerce(inline);
        } else if (i + 1 < args.length && isValueToken(args[i + 1])) {
          i++;
          value = coerce(args[i]);
        }
        setValue(options, resolved.key, value, optionSpec);
      }
      continue;
    }

    // Short options: `-h` and `-v` are handled by the caller; anything
    // else is recorded as a boolean flag.
    for (const char of token.slice(1)) {
      options[char] = true;
    }
  }

  return { positionals, literal, options };
}

function setArgvKey(
  argv: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  argv[key] = value;
  const alternate = key.includes('-') ? kebabToCamel(key) : camelToKebab(key);
  if (alternate !== key) {
    argv[alternate] = value;
  }
}

/**
 * Collect the positional tokens using an empty option spec. This mirrors the
 * first yargs pass that locates the command: every unknown `--opt` consumes
 * the following non-option token as its value.
 */
function scanPositionals(args: string[]): string[] {
  const positionals: string[] = [];
  let afterSeparator = false;

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (afterSeparator) {
      positionals.push(token);
      continue;
    }
    if (token === '--') {
      afterSeparator = true;
      continue;
    }
    if (!isOptionToken(token)) {
      positionals.push(token);
      continue;
    }
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      // Unknown long options consume the next non-option token, unless the
      // token is a global boolean flag or already carries `=value`.
      if (
        eq === -1 &&
        !GLOBAL_VALUELESS_FLAGS.has(token) &&
        i + 1 < args.length &&
        isValueToken(args[i + 1])
      ) {
        i++;
      }
    }
    // Short options never consume a following value in this CLI.
  }
  return positionals;
}

function detectHelpVersion(args: string[]): {
  help: boolean;
  version: boolean;
} {
  let help = false;
  let version = false;
  for (const token of args) {
    if (token === '--') break;
    if (token === '-h' || token === '--help') {
      help = true;
    } else if (token === '-v' || token === '--version') {
      version = true;
    } else if (/^-[a-zA-Z]+$/.test(token)) {
      // Short clusters such as `-hv`.
      if (token.includes('h')) help = true;
      if (token.includes('v')) version = true;
    }
  }
  return { help, version };
}

/**
 * Parse `args` (everything after the executable name) against the
 * declarative command tree.
 */
export function parseArgv(args: string[], scriptName = 'oc'): ParseResult {
  const tree = getCommandTree();
  const positionals = scanPositionals(args);

  // Locate the command path. The first positional selects the top-level
  // command; for commands with children (registry) the second positional
  // may select a subcommand.
  const firstName = positionals[0];
  let topNode: CommandNode | null = null;
  let node: CommandNode | null = null;
  let commandTokenCount = 0;

  if (firstName !== undefined) {
    topNode = tree.commands[firstName] || null;
    node = topNode;
    if (topNode) {
      commandTokenCount = 1;
      const secondName = positionals[1];
      if (secondName !== undefined && topNode.children[secondName]) {
        node = topNode.children[secondName];
        commandTokenCount = 2;
      }
    }
  }

  const { help, version } = detectHelpVersion(args);
  if (help) {
    return { type: 'help', node };
  }
  if (version) {
    return { type: 'version' };
  }

  if (!node || !topNode) {
    if (firstName === undefined) {
      return { type: 'help', node: null };
    }
    return {
      type: 'error',
      message: strings.messages.cli.NO_SUCH_COMMAND(String(firstName)),
      node: null
    };
  }

  const parsed = parseWithSpec(args, node.options);

  // The first `commandTokenCount` positionals are the command names; they
  // stay inside `_` like yargs does. The rest fill the declared positionals.
  const underscore: (string | number)[] = [];
  for (const name of parsed.positionals.slice(0, commandTokenCount)) {
    underscore.push(name);
  }

  const realPositionals = parsed.positionals.slice(commandTokenCount);
  const namedCount = Math.min(realPositionals.length, node.positionals.length);

  const argv: Record<string, unknown> = { _: underscore, $0: scriptName };

  for (let i = 0; i < namedCount; i++) {
    const positional = node.positionals[i];
    setArgvKey(argv, positional.name, coerce(realPositionals[i]));
  }

  for (const value of realPositionals.slice(namedCount)) {
    underscore.push(coerce(value));
  }
  // Tokens after `--` land in `_` without filling named positionals.
  for (const value of parsed.literal) {
    underscore.push(coerce(value));
  }

  for (const [key, value] of Object.entries(parsed.options)) {
    setArgvKey(argv, key, value);
  }

  // Apply declared defaults for options that were not provided.
  for (const [name, optionSpec] of Object.entries(node.options)) {
    if (
      optionSpec.default !== undefined &&
      !Object.hasOwn(parsed.options, name)
    ) {
      setArgvKey(argv, name, optionSpec.default);
    }
  }

  const cliArgv = argv as CliArgv;

  // Same command validation as validate-command.ts.
  try {
    if (underscore.length > 0) {
      validateCommand(cliArgv, 0);
      if (Object.keys(topNode.children).length > 0) {
        validateCommand(cliArgv, 1);
      }
    }
  } catch (err) {
    return {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      node
    };
  }

  // Required positionals must be present.
  const required = node.positionals.filter((p) => p.required).length;
  const provided = realPositionals.length;
  if (provided < required) {
    return {
      type: 'error',
      message: `Not enough non-option arguments: got ${provided}, need at least ${required}`,
      node
    };
  }

  return { type: 'run', node, argv: cliArgv };
}
