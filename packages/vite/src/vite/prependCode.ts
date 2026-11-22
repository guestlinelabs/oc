interface ChunkLike {
  fileName: string;
  code: string;
  map?: { mappings: string } | null;
}

interface BundleAsset {
  type: string;
  source?: string | Uint8Array;
}

/**
 * Prepend whole lines to an emitted chunk from `generateBundle`, keeping its
 * source map aligned: every added line becomes an empty mapping line (`;`).
 * With `build.sourcemap: true` the map has already been emitted as the
 * `<chunk>.map` asset by then, so that asset is updated as well as
 * `chunk.map`. Without this, the map points one line per prepended line too
 * far, which in minified output (few, very long lines) lands in unrelated
 * code.
 */
export function prependLines(
  chunk: ChunkLike,
  prefix: string,
  bundle?: Record<string, BundleAsset | unknown>
): void {
  if (!prefix) return;
  const lines = prefix.endsWith('\n') ? prefix : `${prefix}\n`;
  const empty = ';'.repeat(lines.split('\n').length - 1);
  chunk.code = lines + chunk.code;
  if (chunk.map && typeof chunk.map.mappings === 'string') {
    chunk.map.mappings = empty + chunk.map.mappings;
  }
  const asset = bundle?.[`${chunk.fileName}.map`] as BundleAsset | undefined;
  if (asset?.type === 'asset' && asset.source !== undefined) {
    const text =
      typeof asset.source === 'string'
        ? asset.source
        : new TextDecoder().decode(asset.source);
    const map = JSON.parse(text) as { mappings: string };
    map.mappings = empty + map.mappings;
    asset.source = JSON.stringify(map);
  }
}
