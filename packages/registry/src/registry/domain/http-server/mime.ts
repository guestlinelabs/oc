/**
 * Minimal `mime-types` replacement covering the lookups the registry's
 * response helpers need: `contentType()` (Content-Type header values with
 * charset), `lookup()` (extension/shorthand -> MIME type) and `charset()`.
 *
 * The charset table mirrors mime-db entries that declare a charset; the
 * extension table covers the common static-asset and shorthand types.
 */

// mime-db entries declaring an explicit charset (mime-db@1.54).
const CHARSET_MAP: Record<string, string> = {
  'application/3gpdash-qoe-report+xml': 'UTF-8',
  'application/beep+xml': 'UTF-8',
  'application/cda+xml': 'UTF-8',
  'application/elm+json': 'UTF-8',
  'application/emergencycalldata.cap+xml': 'UTF-8',
  'application/fhir+json': 'UTF-8',
  'application/fhir+xml': 'UTF-8',
  'application/hl7v2+xml': 'UTF-8',
  'application/im-iscomposing+xml': 'UTF-8',
  'application/javascript': 'UTF-8',
  'application/json': 'UTF-8',
  'application/manifest+json': 'UTF-8',
  'application/msc-ivr+xml': 'UTF-8',
  'application/msc-mixer+xml': 'UTF-8',
  'application/news-checkgroups': 'US-ASCII',
  'application/news-groupinfo': 'US-ASCII',
  'application/pidf+xml': 'UTF-8',
  'application/pidf-diff+xml': 'UTF-8',
  'application/poc-settings+xml': 'UTF-8',
  'application/prs.cyn': '7-BIT',
  'application/vnd.fdsn.stationxml+xml': 'XML-BASED',
  'application/vnd.omads-email+xml': 'UTF-8',
  'application/vnd.omads-file+xml': 'UTF-8',
  'application/vnd.omads-folder+xml': 'UTF-8',
  'application/vnd.syncml+xml': 'UTF-8',
  'application/vnd.syncml.dm+wbxml': 'UTF-8',
  'application/vnd.syncml.dm+xml': 'UTF-8',
  'application/vnd.syncml.dmddf+xml': 'UTF-8',
  'application/vnd.syncml.dmtnds+xml': 'UTF-8',
  'application/vnd.wap.wbxml': 'UTF-8',
  'text/css': 'UTF-8',
  'text/javascript': 'UTF-8',
  'text/n3': 'UTF-8',
  'text/parameters': 'UTF-8',
  'text/provenance-notation': 'UTF-8',
  'text/turtle': 'UTF-8',
  'text/vnd.debian.copyright': 'UTF-8',
  'text/vnd.esmertec.theme-descriptor': 'UTF-8',
  'text/vnd.sun.j2me.app-descriptor': 'UTF-8',
  'text/vnd.trolltech.linguist': 'UTF-8',
  'text/vtt': 'UTF-8'
};

// extension -> MIME type (common subset of mime-db)
const EXTENSION_MAP: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  shtml: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  map: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain',
  text: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gzip: 'application/gzip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  wasm: 'application/wasm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  svgz: 'image/svg+xml',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  bin: 'application/octet-stream',
  dat: 'application/octet-stream',
  exe: 'application/octet-stream',
  dll: 'application/octet-stream',
  so: 'application/octet-stream',
  dmg: 'application/octet-stream',
  iso: 'application/octet-stream',
  img: 'application/octet-stream',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ics: 'text/calendar',
  vcf: 'text/vcard',
  webmanifest: 'application/manifest+json',
  ts: 'video/mp2t',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  flv: 'video/x-flv',
  swf: 'application/x-shockwave-flash',
  avifs: 'image/avif-sequence',
  heic: 'image/heic',
  heif: 'image/heif',
  jxl: 'image/jxl',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  m4v: 'video/x-m4v',
  m4p: 'video/mp4',
  m4b: 'audio/mp4',
  opus: 'audio/opus',
  mid: 'audio/midi',
  midi: 'audio/midi',
  kar: 'audio/midi',
  rtf: 'application/rtf',
  epub: 'application/epub+zip',
  mobi: 'application/x-mobipocket-ebook',
  azw: 'application/vnd.amazon.ebook',
  sqlite: 'application/vnd.sqlite3',
  db: 'application/octet-stream',
  sql: 'application/sql',
  graphql: 'application/graphql',
  proto: 'application/protobuf',
  weba: 'audio/webm'
};

const EXTRACT_TYPE_REGEXP = /^\s*([^;\s]*)(?:;|\s|$)/;
const TEXT_TYPE_REGEXP = /^text\//i;

/** Default charset for a MIME type (`false` when none). */
export function charset(type: string): string | false {
  if (!type || typeof type !== 'string') {
    return false;
  }

  const match = EXTRACT_TYPE_REGEXP.exec(type);
  const mime = match?.[1].toLowerCase();

  if (mime && CHARSET_MAP[mime]) {
    return CHARSET_MAP[mime];
  }

  // default text/* to utf-8
  if (match && TEXT_TYPE_REGEXP.test(match[1])) {
    return 'UTF-8';
  }

  return false;
}

/** Look up the MIME type for a file path/extension or shorthand. */
export function lookup(path: string): string | false {
  if (!path || typeof path !== 'string') {
    return false;
  }

  // get the extension ("ext" or ".ext" or full path)
  const extension = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const dot = extension.lastIndexOf('.');
  const ext = dot === -1 ? extension : extension.slice(dot + 1);

  return EXTENSION_MAP[ext] || false;
}

/**
 * Create a full Content-Type header value given a MIME type or extension,
 * appending the charset when the type declares one (like mime-types).
 */
export function contentType(str: string): string | false {
  if (!str || typeof str !== 'string') {
    return false;
  }

  let mime = str.indexOf('/') === -1 ? lookup(str) : str;

  if (!mime) {
    return false;
  }

  if (mime.indexOf('charset') === -1) {
    const cs = charset(mime);
    if (cs) {
      mime += '; charset=' + cs.toLowerCase();
    }
  }

  return mime;
}
