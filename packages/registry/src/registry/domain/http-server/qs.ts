/**
 * Small `qs`-compatible parser for `application/x-www-form-urlencoded`
 * bodies, matching the option set body-parser uses for `extended: true`:
 * `{ allowPrototypes: true, arrayLimit: max(100, paramCount), depth: 32,
 *    charset: 'utf-8', parameterLimit: 1000, strictDepth: true }`.
 *
 * It implements bracket nesting (`a[b][0]=x`), `[]` array appends, duplicate
 * key combining, numeric-index overflow into objects and the depth/array
 * limits. Adversarial merge edge cases may differ from `qs` in corner cases;
 * the shapes produced for ordinary form bodies are identical.
 */

const hasOwn = Object.prototype.hasOwnProperty;

const decode = (str: string, charset?: string): string => {
  if (str.indexOf('%') === -1) {
    return str.indexOf('+') === -1 ? str : str.replace(/\+/g, ' ');
  }
  const strWithoutPlus = str.replace(/\+/g, ' ');
  if (charset === 'iso-8859-1') {
    // byte-wise percent decoding, like qs's unescape() path
    return strWithoutPlus.replace(/%[0-9a-f]{2}/gi, (hex) =>
      String.fromCharCode(parseInt(hex.slice(1), 16))
    );
  }
  try {
    return decodeURIComponent(strWithoutPlus);
  } catch {
    return strWithoutPlus;
  }
};

interface QsOptions {
  arrayLimit: number;
  depth: number;
  charset?: string;
  parameterLimit?: number;
  strictDepth?: boolean;
}

class QsRangeError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'RangeError';
  }
}

const isArray = Array.isArray;
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !isArray(v);

const setProperty = (
  obj: Record<string, unknown>,
  key: string,
  value: unknown
): void => {
  if (key === '__proto__') {
    Object.defineProperty(obj, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true
    });
  } else {
    obj[key] = value;
  }
};

const arrayToObject = (source: unknown[]): Record<string, unknown> => {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < source.length; ++i) {
    if (typeof source[i] !== 'undefined') {
      obj[i] = source[i];
    }
  }
  return obj;
};

// overflow objects (arrays that exceeded arrayLimit) track their max index
const overflowIndex = new WeakMap<object, number>();
const isOverflow = (v: unknown): v is object =>
  typeof v === 'object' && v !== null && overflowIndex.has(v);
const getMaxIndex = (v: object): number => overflowIndex.get(v) ?? -1;
const markOverflow = <T extends object>(v: T, maxIndex: number): T => {
  overflowIndex.set(v, maxIndex);
  return v;
};

// conflict pairs produced by strictMerge track their next free index
const conflictIndex = new WeakMap<object, number>();
const isConflict = (v: unknown): v is object =>
  typeof v === 'object' && v !== null && conflictIndex.has(v);
const getConflictIndex = (v: object): number => conflictIndex.get(v) ?? -1;
const markConflict = <T extends object>(v: T, maxIndex: number): T => {
  conflictIndex.set(v, maxIndex);
  return v;
};

const countElements = (arr: unknown[]): number => {
  let count = 0;
  for (let i = 0; i < arr.length; ++i) {
    if (hasOwn.call(arr, i)) count += 1;
  }
  return count;
};

const arrayLimitError = (arrayLimit: number): QsRangeError =>
  new QsRangeError(
    `Array limit exceeded. Only ${arrayLimit} element${
      arrayLimit === 1 ? '' : 's'
    } allowed in an array.`
  );

const combine = (a: unknown, b: unknown, arrayLimit: number): unknown => {
  if (isOverflow(a)) {
    const bValues = isArray(b) ? b : [b];
    let newIndex = getMaxIndex(a);
    const target = a as Record<string, unknown>;
    for (const v of bValues) {
      newIndex += 1;
      target[newIndex] = v;
    }
    markOverflow(target, newIndex);
    return target;
  }

  const result = ([] as unknown[]).concat(a as never, b as never);
  if (result.length > arrayLimit) {
    return markOverflow(arrayToObject(result), result.length - 1);
  }
  return result;
};

const merge = (
  target: unknown,
  source: unknown,
  options: QsOptions
): unknown => {
  if (!source) {
    return target;
  }

  if (typeof source !== 'object' && typeof source !== 'function') {
    if (isArray(target)) {
      const nextIndex = target.length;
      if (countElements(target) >= options.arrayLimit) {
        return markOverflow(
          arrayToObject((target as unknown[]).concat(source)),
          nextIndex
        );
      }
      (target as unknown[])[nextIndex] = source;
    } else if (isPlainObject(target)) {
      if (isOverflow(target)) {
        const newIndex = getMaxIndex(target) + 1;
        setProperty(target, String(newIndex), source);
        markOverflow(target, newIndex);
      } else if (isConflict(target)) {
        const nextConflict = getConflictIndex(target) + 1;
        if (nextConflict >= options.arrayLimit) {
          throw arrayLimitError(options.arrayLimit);
        }
        (target as unknown[])[nextConflict] = source;
        markConflict(target as unknown[], nextConflict);
      } else {
        // strictMerge: wrap scalar/object conflicts into a marked pair
        const conflict = [target, source];
        return markConflict(conflict, 1);
      }
    } else {
      // scalar/scalar or undefined target
      const pair = [target, source];
      if (pair.length > options.arrayLimit) {
        return markOverflow(arrayToObject(pair), pair.length - 1);
      }
      return pair;
    }
    return target;
  }

  if (!target || typeof target !== 'object') {
    const combined = [target].concat(source as never);
    if (combined.length > options.arrayLimit) {
      return markOverflow(arrayToObject(combined), combined.length - 1);
    }
    return combined;
  }

  let mergeTarget: Record<string, unknown> | unknown[] = target as
    | Record<string, unknown>
    | unknown[];
  if (isArray(target) && !isArray(source)) {
    mergeTarget = arrayToObject(target as unknown[]);
    if (isConflict(target)) {
      markConflict(mergeTarget, (target as unknown[]).length - 1);
    }
  }

  if (isArray(target) && isArray(source)) {
    (source as unknown[]).forEach((item, i) => {
      const t = target as unknown[];
      if (hasOwn.call(t, i)) {
        const targetItem = t[i];
        if (
          targetItem &&
          typeof targetItem === 'object' &&
          item &&
          typeof item === 'object'
        ) {
          t[i] = merge(targetItem, item, options);
        } else {
          t[t.length] = item;
        }
      } else {
        t[i] = item;
      }
    });
    if (countElements(target as unknown[]) > options.arrayLimit) {
      return markOverflow(
        arrayToObject(target as unknown[]),
        (target as unknown[]).length - 1
      );
    }
    return target;
  }

  const sourceObj = source as Record<string, unknown>;
  for (const key of Object.keys(sourceObj)) {
    const value = sourceObj[key];
    const acc = mergeTarget as Record<string, unknown>;
    if (hasOwn.call(acc, key)) {
      setProperty(acc, key, merge(acc[key], value, options));
    } else {
      setProperty(acc, key, value);
    }
  }
  return mergeTarget;
};

const stripWrappingBrackets = (key: string): string =>
  key.charAt(0) === '[' && key.charAt(key.length - 1) === ']'
    ? key.slice(1, -1)
    : key;

const parseObject = (
  chain: string[],
  val: unknown,
  options: QsOptions
): unknown => {
  let leaf = val;

  for (let i = chain.length - 1; i >= 0; --i) {
    const root = chain[i];
    let obj: unknown;

    if (root === '[]') {
      obj = combine([], leaf, options.arrayLimit);
    } else {
      obj = {};
      const cleanRoot = stripWrappingBrackets(root);
      const decodedRoot = cleanRoot;
      const index = parseInt(decodedRoot, 10);
      const isValidArrayIndex =
        !Number.isNaN(index) &&
        root !== decodedRoot &&
        String(index) === decodedRoot &&
        index >= 0;

      if (isValidArrayIndex && index < options.arrayLimit) {
        const arr: unknown[] = [];
        arr[index] = leaf;
        obj = arr;
      } else if (isValidArrayIndex) {
        const overflowObj: Record<string, unknown> = {};
        overflowObj[index] = leaf;
        obj = markOverflow(overflowObj, index);
      } else if (decodedRoot !== '__proto__') {
        setProperty(obj as Record<string, unknown>, decodedRoot, leaf);
      }
    }

    leaf = obj;
  }

  return leaf;
};

const splitKeyIntoSegments = (
  originalKey: string,
  options: QsOptions
): string[] | undefined => {
  const key = originalKey;

  if (options.depth <= 0) {
    return [key];
  }

  const segments: string[] = [];

  const first = key.indexOf('[');
  const parent = first >= 0 ? key.slice(0, first) : key;
  if (parent) {
    segments.push(parent);
  }

  const n = key.length;
  let open = first;
  let collected = 0;

  while (open >= 0 && collected < options.depth) {
    let level = 1;
    let i = open + 1;
    let close = -1;

    while (i < n && close < 0) {
      const cu = key.charCodeAt(i);
      if (cu === 0x5b) {
        level += 1;
      } else if (cu === 0x5d) {
        level -= 1;
        if (level === 0) {
          close = i;
        }
      }
      i += 1;
    }

    if (close < 0) {
      segments.push('[' + key.slice(open) + ']');
      return segments;
    }

    segments.push(key.slice(open, close + 1));
    collected += 1;

    open = key.indexOf('[', close + 1);
  }

  if (open >= 0) {
    if (options.strictDepth === true) {
      throw new QsRangeError(
        `Input depth exceeded depth option of ${options.depth} and strictDepth is true`
      );
    }
    segments.push('[' + key.slice(open) + ']');
  }

  return segments;
};

const parseKeys = (
  givenKey: string,
  val: unknown,
  options: QsOptions
): unknown => {
  if (!givenKey) {
    return undefined;
  }

  const keys = splitKeyIntoSegments(givenKey, options);
  if (!keys) {
    return undefined;
  }

  return parseObject(keys, val, options);
};

const compact = (value: unknown): unknown => {
  if (isArray(value)) {
    const arr = value as unknown[];
    const compacted: unknown[] = [];
    for (const item of arr) {
      if (typeof item !== 'undefined') {
        compacted.push(compact(item));
      }
    }
    return compacted;
  }
  if (isPlainObject(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      obj[key] = compact(obj[key]);
    }
  }
  return value;
};

const parseValues = (
  str: string,
  options: QsOptions
): Record<string, unknown> => {
  const obj: Record<string, unknown> = Object.create(null);

  const cleanStr = str.replace(/%5B/gi, '[').replace(/%5D/gi, ']');
  // qs splits with the parameter limit so extra parameters are dropped
  const parts =
    options.parameterLimit !== undefined && options.parameterLimit !== Infinity
      ? cleanStr.split('&', options.parameterLimit)
      : cleanStr.split('&');

  for (const part of parts) {
    const bracketEqualsPos = part.indexOf(']=');
    const pos =
      bracketEqualsPos === -1 ? part.indexOf('=') : bracketEqualsPos + 1;

    const isEmptyBracketKey = pos > 1 && part.slice(pos - 2, pos) === '[]';

    let key: string;
    let val: unknown;
    if (pos === -1) {
      key = decode(part, options.charset);
      val = '';
    } else {
      key = decode(part.slice(0, pos), options.charset);
      val = decode(part.slice(pos + 1), options.charset);
    }

    if (isEmptyBracketKey && isArray(val)) {
      val = [val];
    }

    const existing = hasOwn.call(obj, key);
    if (existing) {
      obj[key] = combine(obj[key], val, options.arrayLimit);
    } else {
      obj[key] = val;
    }
  }

  return obj;
};

/**
 * Parse an urlencoded body. `parameterLimit` is enforced by the caller
 * (body-parser counts `&`-separated parts before calling qs).
 */
export function parse(
  body: string,
  opts: {
    arrayLimit: number;
    parameterLimit?: number;
    depth?: number;
    charset?: string;
    strictDepth?: boolean;
  }
): Record<string, unknown> {
  const options: QsOptions = {
    arrayLimit: opts.arrayLimit,
    depth: opts.depth ?? 32,
    charset: opts.charset,
    parameterLimit: opts.parameterLimit,
    strictDepth: opts.strictDepth
  };

  if (body === '') {
    return {};
  }

  const tempObj = parseValues(body, options);
  let obj: unknown = {};

  for (const key of Object.keys(tempObj)) {
    const newObj = parseKeys(key, tempObj[key], options);
    if (newObj !== undefined) {
      obj = merge(obj, newObj, options);
    }
  }

  return compact(obj) as Record<string, unknown>;
}
