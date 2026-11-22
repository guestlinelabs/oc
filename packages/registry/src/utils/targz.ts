import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// POSIX ustar writer. `Bun.Archive` cannot emit directory entries (a `null`
// value is serialised as the string "null"), while upstream `tar` archives
// `_package/` with explicit `typeflag '5'` directory entries — required for
// the published `.tgz` to extract cleanly.

const BLOCK_SIZE = 512;
const encoder = new TextEncoder();

interface TarEntry {
  /** Archive path with forward slashes; directories end with '/'. */
  name: string;
  /** Regular file contents; `undefined` for directories. */
  data?: Uint8Array;
  mode: number;
  /** Unix seconds. */
  mtime: number;
  directory: boolean;
}

async function collectEntries(
  dir: string,
  prefix: string,
  out: TarEntry[]
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const archivePath = `${prefix}/${entry.name}`;
    // fs.stat follows symlinks, matching how the previous implementation
    // archived the link target's contents.
    const stat = await fs.stat(fullPath);
    const mtime = Math.floor(stat.mtimeMs / 1000);
    const mode = stat.mode & 0o777;

    if (entry.isDirectory()) {
      out.push({
        name: `${archivePath}/`,
        mode,
        mtime,
        directory: true
      });
      await collectEntries(fullPath, archivePath, out);
    } else {
      out.push({
        name: archivePath,
        data: new Uint8Array(await Bun.file(fullPath).arrayBuffer()),
        mode,
        mtime,
        directory: false
      });
    }
  }
}

function writeBytes(
  header: Uint8Array,
  offset: number,
  bytes: Uint8Array,
  length: number
): void {
  header.set(bytes.subarray(0, length), offset);
}

function writeOctal(
  header: Uint8Array,
  offset: number,
  length: number,
  value: number
): void {
  const digits = Math.max(0, Math.floor(value)).toString(8);
  const field = digits.slice(-(length - 1)).padStart(length - 1, '0');
  writeBytes(header, offset, encoder.encode(field), length - 1);
  header[offset + length - 1] = 0;
}

function writeString(
  header: Uint8Array,
  offset: number,
  length: number,
  value: string
): void {
  writeBytes(header, offset, encoder.encode(value), length);
}

// Splits an archive path into the ustar `prefix`/`name` fields (100/155
// bytes). Throws when the path cannot be represented.
function splitTarName(name: string): {
  prefix: Uint8Array;
  name: Uint8Array;
} {
  const bytes = encoder.encode(name);
  if (bytes.length <= 100) {
    return { prefix: new Uint8Array(0), name: bytes };
  }

  for (let i = bytes.length - 1; i > 0; i--) {
    if (bytes[i] === 0x2f) {
      // '/'
      const prefixLength = i;
      const nameLength = bytes.length - i - 1;
      if (nameLength <= 100 && prefixLength <= 155) {
        return {
          prefix: bytes.slice(0, prefixLength),
          name: bytes.slice(i + 1)
        };
      }
    }
  }

  throw new Error(`path too long for tar entry: ${name}`);
}

let cachedUserName: string | undefined;
const getUserName = (): string => {
  if (cachedUserName === undefined) {
    try {
      cachedUserName = os.userInfo().username;
    } catch {
      cachedUserName = '';
    }
  }
  return cachedUserName;
};

function tarHeader(entry: TarEntry): Uint8Array {
  const header = new Uint8Array(BLOCK_SIZE);
  const size = entry.directory ? 0 : (entry.data?.byteLength ?? 0);
  const { prefix, name } = splitTarName(entry.name);

  writeBytes(header, 0, name, 100);
  writeOctal(header, 100, 8, entry.mode);
  writeOctal(header, 108, 8, process.getuid?.() ?? 0);
  writeOctal(header, 116, 8, process.getgid?.() ?? 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, entry.mtime);
  // chksum field (148-155) is filled with spaces for the checksum pass.
  header.fill(0x20, 148, 156);
  header[156] = entry.directory ? 0x35 : 0x30; // '5' or '0'
  writeString(header, 257, 8, 'ustar\0');
  writeString(header, 263, 2, '00');
  writeString(header, 265, 32, getUserName());
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  writeBytes(header, 345, prefix, 155);

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  const checksumField = `${checksum.toString(8).padStart(6, '0')}\0 `;
  writeString(header, 148, 8, checksumField);

  return header;
}

export async function compress(
  src: string,
  dest: string,
  prefix: string
): Promise<void> {
  const entries: TarEntry[] = [];
  await collectEntries(src, prefix, entries);

  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    parts.push(tarHeader(entry));
    if (entry.data && entry.data.byteLength > 0) {
      parts.push(entry.data);
      const padding =
        (BLOCK_SIZE - (entry.data.byteLength % BLOCK_SIZE)) % BLOCK_SIZE;
      if (padding > 0) {
        parts.push(new Uint8Array(padding));
      }
    }
  }
  // End of archive: two zero blocks.
  parts.push(new Uint8Array(BLOCK_SIZE), new Uint8Array(BLOCK_SIZE));

  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const tar = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    tar.set(part, offset);
    offset += part.byteLength;
  }

  await Bun.write(dest, Bun.gzipSync(tar));
}

export async function decompress(src: string, dest: string): Promise<void> {
  // Bun.Archive auto-detects gzip compression and creates the target
  // directory (including parents) during extraction.
  const archive = new Bun.Archive(await Bun.file(src).arrayBuffer());
  await archive.extract(dest);
}
