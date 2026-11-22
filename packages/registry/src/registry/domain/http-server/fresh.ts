/**
 * Port of `fresh` (https://github.com/jshttp/fresh, MIT licensed): determines
 * whether a response is still fresh for the given request headers.
 */

const CACHE_CONTROL_NO_CACHE_REGEXP = /(?:^|,)\s*?no-cache\s*?(?:,|$)/;

export function fresh(
  reqHeaders: Record<string, string | string[] | undefined>,
  resHeaders: Record<string, string | string[] | undefined>
): boolean {
  const modifiedSince = reqHeaders['if-modified-since'];
  const noneMatch = reqHeaders['if-none-match'];

  // unconditional request
  if (!modifiedSince && !noneMatch) {
    return false;
  }

  // Always return stale when Cache-Control: no-cache
  const cacheControl = reqHeaders['cache-control'];
  const cacheControlStr = Array.isArray(cacheControl)
    ? cacheControl.join(',')
    : cacheControl;
  if (cacheControlStr && CACHE_CONTROL_NO_CACHE_REGEXP.test(cacheControlStr)) {
    return false;
  }

  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  // if-none-match takes precedent over if-modified-since
  const noneMatchStr = first(noneMatch);
  if (noneMatchStr) {
    if (noneMatchStr === '*') {
      return true;
    }
    const etag = first(resHeaders['etag']);
    if (!etag) {
      return false;
    }

    const matches = parseTokenList(noneMatchStr);
    for (const match of matches) {
      if (match === etag || match === 'W/' + etag || 'W/' + match === etag) {
        return true;
      }
    }

    return false;
  }

  // if-modified-since
  const modifiedSinceStr = first(modifiedSince);
  if (modifiedSinceStr) {
    const lastModified = first(resHeaders['last-modified']);
    const modifiedStale =
      !lastModified ||
      !(parseHttpDate(lastModified) <= parseHttpDate(modifiedSinceStr));
    if (modifiedStale) {
      return false;
    }
  }

  return true;
}

function parseHttpDate(date: string): number {
  const timestamp = date && Date.parse(date);
  return typeof timestamp === 'number' ? timestamp : NaN;
}

function parseTokenList(str: string): string[] {
  const list: string[] = [];
  let start = 0;
  let end = 0;

  for (let i = 0, len = str.length; i < len; i++) {
    switch (str.charCodeAt(i)) {
      case 0x20 /*   */:
        if (start === end) {
          start = end = i + 1;
        }
        break;
      case 0x2c /* , */:
        list.push(str.substring(start, end));
        start = end = i + 1;
        break;
      default:
        end = i + 1;
        break;
    }
  }

  list.push(str.substring(start, end));
  return list;
}
