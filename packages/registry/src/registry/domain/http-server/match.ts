/**
 * Express-style path pattern matching for the registry router.
 *
 * Supported syntax (the subset used by `router.ts` and `registry.app`):
 * - literal segments
 * - `:name`  – single path segment (`[^/]+`)
 * - `*name`  – trailing wildcard (`.*`)
 *
 * Matching is case-insensitive and allows one optional trailing slash,
 * mirroring Express defaults (`case sensitive routing` and
 * `strict routing` disabled).
 */

export interface RouteMatch {
  params: Record<string, string>;
}

interface CompiledPattern {
  regex: RegExp;
  paramNames: string[];
}

const PARAM_SEGMENT = /^:([A-Za-z0-9_]+)$/;
const WILDCARD_SEGMENT = /^\*([A-Za-z0-9_]*)$/;

const escapeRegExp = (str: string): string =>
  str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const compile = (pattern: string): CompiledPattern => {
  // A trailing slash on the pattern is insignificant (strict routing off)
  let p = pattern;
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }

  const segments = p.split('/').slice(1); // drop leading ''
  const paramNames: string[] = [];
  let wildcard = false;
  const parts: string[] = [];

  for (const segment of segments) {
    const wild = WILDCARD_SEGMENT.exec(segment);
    const param = PARAM_SEGMENT.exec(segment);

    if (wild) {
      wildcard = true;
      paramNames.push(wild[1] || 'splat');
      parts.push('(.*)');
      continue;
    }
    if (param) {
      paramNames.push(param[1]);
      parts.push('([^/]+)');
      continue;
    }
    parts.push(escapeRegExp(segment));
  }

  const inner = parts.join('/');
  const source = inner === '' ? '^/$' : `^/${inner}${wildcard ? '' : '/?'}$`;

  return {
    regex: new RegExp(source, 'i'),
    paramNames
  };
};

const cache = new Map<string, CompiledPattern>();

const getCompiled = (pattern: string): CompiledPattern => {
  let compiled = cache.get(pattern);
  if (!compiled) {
    compiled = compile(pattern);
    cache.set(pattern, compiled);
  }
  return compiled;
};

/**
 * Match `pathname` against `pattern`. Returns decoded params or `null`.
 * Params are URI-decoded like Express does.
 */
export function matchPath(
  pattern: string,
  pathname: string
): RouteMatch | null {
  const compiled = getCompiled(pattern);
  const result = compiled.regex.exec(pathname);
  if (!result) {
    return null;
  }

  const params: Record<string, string> = {};
  for (let i = 0; i < compiled.paramNames.length; i++) {
    const raw = result[i + 1];
    const name = compiled.paramNames[i];
    if (raw === undefined) {
      params[name] = '';
      continue;
    }
    try {
      params[name] = decodeURIComponent(raw);
    } catch {
      params[name] = raw;
    }
  }

  return { params };
}
