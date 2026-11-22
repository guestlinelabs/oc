// Minimal source map consumer: decodes the VLQ `mappings` field and
// answers originalPositionFor / sourceContentFor. Replaces the source-map
// package for the single use case in format-error-stack.

interface MappingSegment {
  generatedColumn: number;
  sourceIndex: number;
  originalLine: number; // 1-based
  originalColumn: number; // 0-based
  nameIndex?: number;
}

interface SourceMapJson {
  sources?: (string | null)[];
  names?: string[];
  mappings?: string;
  sourcesContent?: (string | null)[];
}

export interface OriginalPosition {
  source: string | null;
  line: number | null;
  column: number | null;
  name: string | null;
}

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES = new Map<string, number>(
  [...BASE64_CHARS].map((char, index) => [char, index])
);

// Reads one base64 VLQ value starting at state.index, advancing it.
const readVlq = (line: string, state: { index: number }): number => {
  let result = 0;
  let shift = 0;
  let digit: number;

  do {
    const char = line[state.index];
    digit = char === undefined ? -1 : (BASE64_VALUES.get(char) ?? -1);
    if (digit < 0) {
      throw new Error('Invalid character in source map mappings');
    }
    state.index += 1;
    result += (digit & 31) * 2 ** shift;
    shift += 5;
  } while (digit & 32);

  const negative = result % 2 === 1;
  const value = Math.floor(result / 2);
  return negative ? -value : value;
};

// mappings: ';' separates generated lines, ',' separates segments.
// All fields except generatedColumn are delta-encoded relative to the
// previous segment (across lines).
const parseMappings = (mappings: string): MappingSegment[][] => {
  const lines: MappingSegment[][] = [];
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;

  for (const line of mappings.split(';')) {
    const segments: MappingSegment[] = [];
    let generatedColumn = 0;

    if (line) {
      const state = { index: 0 };
      while (state.index < line.length) {
        const fields: number[] = [];
        while (state.index < line.length && line[state.index] !== ',') {
          fields.push(readVlq(line, state));
        }
        // skip the ',' separator (or run off the end of the line)
        if (line[state.index] === ',') {
          state.index += 1;
        }

        generatedColumn += fields[0];
        if (fields.length >= 4) {
          sourceIndex += fields[1];
          originalLine += fields[2];
          originalColumn += fields[3];
          let name: number | undefined;
          if (fields.length >= 5) {
            nameIndex += fields[4];
            name = nameIndex;
          }
          segments.push({
            generatedColumn,
            sourceIndex,
            originalLine: originalLine + 1,
            originalColumn,
            nameIndex: name
          });
        }
        // segments with a single field are unmapped and skipped
      }
    }

    lines.push(segments);
  }

  return lines;
};

const NULL_POSITION: OriginalPosition = {
  source: null,
  line: null,
  column: null,
  name: null
};

export class SourceMapConsumer {
  private readonly map: SourceMapJson;
  private readonly segments: MappingSegment[][];

  constructor(rawSourceMap: string | SourceMapJson) {
    this.map =
      typeof rawSourceMap === 'string'
        ? JSON.parse(rawSourceMap)
        : rawSourceMap;
    this.segments = parseMappings(this.map.mappings ?? '');
  }

  originalPositionFor(position: {
    line: number;
    column: number;
  }): OriginalPosition {
    const segments = this.segments[position.line - 1];
    if (!segments || segments.length === 0) {
      return NULL_POSITION;
    }

    // greatest lower bound: last segment starting at or before the column
    let low = 0;
    let high = segments.length - 1;
    let match: MappingSegment | undefined;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (segments[mid].generatedColumn <= position.column) {
        match = segments[mid];
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (!match) {
      return NULL_POSITION;
    }

    const sources = this.map.sources ?? [];
    const names = this.map.names ?? [];
    return {
      source: sources[match.sourceIndex] ?? null,
      line: match.originalLine,
      column: match.originalColumn,
      name:
        match.nameIndex === undefined ? null : (names[match.nameIndex] ?? null)
    };
  }

  sourceContentFor(
    source: string,
    returnNullOnMissing?: boolean
  ): string | null {
    const index = (this.map.sources ?? []).indexOf(source);
    const content = index === -1 ? undefined : this.map.sourcesContent?.[index];

    if (content == null) {
      if (returnNullOnMissing) {
        return null;
      }
      throw new Error(`"${source}" is not in the SourceMap.`);
    }
    return content;
  }

  destroy(): void {}
}
