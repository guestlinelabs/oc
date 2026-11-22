/**
 * Minimal `accepts`/`negotiator` replacement covering the media-type
 * negotiation `res.format()` (used by `res.redirect`) and the dev error
 * handler need: pick the client-preferred type out of a supplied list.
 */

import { lookup } from './mime';

interface MediaSpec {
  type: string;
  subtype: string;
  q: number;
  index: number;
}

const parseAccept = (header: string | undefined): MediaSpec[] => {
  if (!header) {
    return [{ type: '*', subtype: '*', q: 1, index: 0 }];
  }

  const specs: MediaSpec[] = [];
  const parts = header.split(',');

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;

    const [range, ...params] = part.split(';');
    const [type, subtype] = range.trim().toLowerCase().split('/');
    if (!type || !subtype) continue;

    let q = 1;
    for (const param of params) {
      const [key, value] = param.split('=');
      if (key?.trim().toLowerCase() === 'q') {
        const parsed = parseFloat(value ?? '');
        if (!Number.isNaN(parsed)) q = parsed;
      }
    }

    specs.push({
      type: type.trim(),
      subtype: subtype.trim(),
      q,
      index: i
    });
  }

  if (specs.length === 0) {
    return [{ type: '*', subtype: '*', q: 1, index: 0 }];
  }

  return specs
    .filter((s) => s.q > 0)
    .sort((a, b) => {
      if (b.q !== a.q) return b.q - a.q;
      // more specific media ranges win ties
      const specificity = (s: MediaSpec) =>
        (s.type !== '*' ? 2 : 0) + (s.subtype !== '*' ? 1 : 0);
      const diff = specificity(b) - specificity(a);
      if (diff !== 0) return diff;
      return a.index - b.index;
    });
};

const matches = (spec: MediaSpec, mime: string): boolean => {
  const [type, subtype] = mime.split('/');
  if (spec.type !== '*' && spec.type !== type) return false;
  if (spec.subtype !== '*' && spec.subtype !== subtype) return false;
  return true;
};

/**
 * Return the supplied type (original string) the client prefers, or
 * `false` when none of the supplied types are acceptable.
 */
export function preferredType(
  acceptHeader: string | undefined,
  types: string[]
): string | false {
  if (types.length === 0) return false;

  const specs = parseAccept(acceptHeader);
  const normalized = types.map((t) => normalizeTypeSafe(t));

  for (const spec of specs) {
    for (let i = 0; i < types.length; i++) {
      if (matches(spec, normalized[i])) {
        return types[i];
      }
    }
  }

  return false;
}

const normalizeTypeSafe = (t: string): string => {
  if (typeof t !== 'string') return 'application/octet-stream';
  if (t.includes('/')) return t.toLowerCase();
  const looked = lookup(t);
  return looked ? String(looked).toLowerCase() : 'application/octet-stream';
};
