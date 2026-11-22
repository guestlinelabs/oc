import strings from '@guestlinelabs/oc-registry/resources';
import type { CommandNode, CommandTree, OptionSpec } from './parse-argv';

const HELP_HINT = strings.messages.cli.HELP_HINT;

function optionDisplay(spec: OptionSpec): string {
  const annotations: string[] = [];
  if (spec.boolean) {
    annotations.push('[boolean]');
  } else if (spec.array) {
    annotations.push('[array]');
  }
  if (spec.default !== undefined) {
    annotations.push(
      `[default: ${typeof spec.default === 'string' ? JSON.stringify(spec.default) : String(spec.default)}]`
    );
  }
  return annotations.length ? `  ${annotations.join(' ')}` : '';
}

function commandSignature(scriptName: string, node: CommandNode): string {
  const parts = [scriptName, ...node.path];
  if (node.signature) {
    parts.push(node.signature);
  }
  return parts.join(' ');
}

function renderOptions(node: CommandNode | null): string[] {
  const lines: string[] = ['Options:'];
  const rows: { label: string; description: string; annotation: string }[] = [
    { label: '-h, --help', description: 'Show help', annotation: '[boolean]' },
    {
      label: '    --version',
      description: 'Show version number',
      annotation: '[boolean]'
    }
  ];

  if (node) {
    for (const [name, spec] of Object.entries(node.options)) {
      rows.push({
        label: `    --${name}`,
        description: spec.description || '',
        annotation: optionDisplay(spec).trimStart()
      });
    }
  }

  const labelWidth = Math.max(...rows.map((row) => row.label.length));

  for (const row of rows) {
    let line = `  ${row.label.padEnd(labelWidth + 2)}${row.description}`;
    if (row.annotation) {
      line += `  ${row.annotation}`;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function renderCommands(scriptName: string, nodes: CommandNode[]): string[] {
  const lines = ['Commands:'];
  const rows = nodes.map((node) => ({
    signature: commandSignature(scriptName, node),
    description: node.description
  }));
  const width = Math.max(...rows.map((row) => row.signature.length));
  for (const row of rows) {
    lines.push(`  ${row.signature.padEnd(width + 2)}${row.description}`);
  }
  return lines;
}

/** Render the help text for the global CLI or a single command node. */
export function renderHelp(
  node: CommandNode | null,
  tree: CommandTree,
  scriptName: string
): string {
  const lines: string[] = [];

  if (node) {
    lines.push(node.usage.replace(/\$0/g, scriptName));
    lines.push('');
  } else {
    lines.push(tree.usage.replace(/\$0/g, scriptName));
    lines.push('');
    lines.push(...renderCommands(scriptName, Object.values(tree.commands)));
    lines.push('');
  }

  const hasChildren = node ? Object.keys(node.children).length > 0 : false;
  if (hasChildren) {
    lines.push(...renderCommands(scriptName, Object.values(node!.children)));
    lines.push('');
  }

  lines.push(...renderOptions(node));

  if (node?.example) {
    lines.push('');
    lines.push('Examples:');
    const exampleCmd = node.example.cmd.replace(/\$0/g, scriptName);
    lines.push(
      `  ${exampleCmd}  ${node.example.description || node.description}`
    );
  }

  if (!node || hasChildren) {
    lines.push('');
    lines.push(HELP_HINT);
  }

  return lines.join('\n');
}
