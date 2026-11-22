// Semver helpers backed by Bun.semver. Bun only exposes satisfies() and
// order(), so the remaining npm-semver compatible helpers are derived here.

const VERSION_PATTERN =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const parse = (version: string) => {
  const match = VERSION_PATTERN.exec(version.trim());
  if (!match) {
    throw new TypeError(`Invalid Version: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]
  };
};

export function valid(version: string): string | null {
  const match = VERSION_PATTERN.exec(version.trim());
  if (!match) {
    return null;
  }
  return `${match[1]}.${match[2]}.${match[3]}${
    match[4] ? `-${match[4]}` : ''
  }${match[5] ? `+${match[5]}` : ''}`;
}

export function major(version: string): number {
  return parse(version).major;
}

export function minor(version: string): number {
  return parse(version).minor;
}

export function patch(version: string): number {
  return parse(version).patch;
}

export function compare(a: string, b: string): number {
  return Bun.semver.order(a, b);
}

export function rcompare(a: string, b: string): number {
  return Bun.semver.order(b, a);
}

export function eq(a: string, b: string): boolean {
  return Bun.semver.order(a, b) === 0;
}

export function lt(a: string, b: string): boolean {
  return Bun.semver.order(a, b) === -1;
}

export function lte(a: string, b: string): boolean {
  return Bun.semver.order(a, b) !== 1;
}

export function gt(a: string, b: string): boolean {
  return Bun.semver.order(a, b) === 1;
}

export function gte(a: string, b: string): boolean {
  return Bun.semver.order(a, b) !== -1;
}

// A partial version or x-range: 1, 1.2, 1.2.3, 1.x, *, v1.2.3, with
// optional -prerelease and +build suffixes.
const RANGE_PARTIAL =
  /^[v=]?(?:\d+|[xX*])(?:\.(?:\d+|[xX*]))?(?:\.(?:\d+|[xX*]))?(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const RANGE_COMPARATOR = /^(<=|>=|<|>|=|~|\^)/;

// Bun.semver.satisfies() treats unparseable ranges as matching everything,
// so ranges are validated against the npm semver range grammar first:
//   range    := rangeSet ( '||' rangeSet )*
//   rangeSet := comparator+ | partial '-' partial (hyphen range)
//   comparator := ('<'|'<='|'>'|'>='|'='|'~'|'^')? partial
const isValidRangeSet = (rangeSet: string): boolean => {
  const tokens = rangeSet.trim().split(/\s+/).filter(Boolean);
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];

    // hyphen range: `partial - partial`
    if (
      RANGE_PARTIAL.test(token) &&
      tokens[index + 1] === '-' &&
      tokens[index + 2] !== undefined &&
      RANGE_PARTIAL.test(tokens[index + 2])
    ) {
      index += 3;
      continue;
    }

    // comparator, possibly with whitespace between operator and partial
    let rest = token;
    const operator = RANGE_COMPARATOR.exec(rest);
    if (operator) {
      rest = rest.slice(operator[1].length);
      if (rest === '') {
        index += 1;
        rest = tokens[index] ?? '';
      }
    }

    if (!RANGE_PARTIAL.test(rest)) {
      return false;
    }
    index += 1;
  }

  return tokens.length > 0;
};

export function validRange(range: string): boolean {
  const trimmed = range.trim();
  if (trimmed === '') {
    return true;
  }
  return trimmed.split('||').every(isValidRangeSet);
}

export function satisfies(version: string, range: string): boolean {
  if (!validRange(range)) {
    return false;
  }
  try {
    return Bun.semver.satisfies(version, range);
  } catch {
    return false;
  }
}

export function maxSatisfying(
  versions: readonly string[],
  range: string
): string | undefined {
  let best: string | undefined;
  for (const version of versions) {
    if (!satisfies(version, range)) {
      continue;
    }
    if (best === undefined || Bun.semver.order(version, best) === 1) {
      best = version;
    }
  }
  return best;
}
