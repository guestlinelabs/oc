// Parses .env file content into a key/value map.
// Mirrors dotenv.parse(): KEY=VALUE (or KEY: VALUE) lines, optional
// `export` prefix, single/double/backtick quoted values, inline comments,
// and \n / \r expansion inside double quotes.
const LINE =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;

export function parseEnvFile(src: string): Record<string, string> {
  const obj: Record<string, string> = {};

  // Convert buffer to string and normalise line breaks
  const lines = src.replace(/\r\n?/gm, '\n');

  for (const match of lines.matchAll(LINE)) {
    const key = match[1];

    // Default undefined or null to empty string
    let value = match[2] || '';

    // Remove whitespace
    value = value.trim();

    // Check if quoted
    const maybeQuote = value[0];

    // Remove surrounding quotes
    value = value.replace(/^(['"`])([\s\S]*)\1$/gm, '$2');

    // Expand newlines if double quoted
    if (maybeQuote === '"') {
      value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    }

    obj[key] = value;
  }

  return obj;
}
