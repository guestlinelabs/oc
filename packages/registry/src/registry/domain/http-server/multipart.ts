/**
 * Minimal `multer` (`upload.any()` + `diskStorage`) replacement for the
 * registry's single `PUT` publish endpoint.
 *
 * Parses `multipart/form-data` bodies via `Request.formData()`, writes file
 * parts to `tempDir` under the generated filename, enforces busboy's
 * `fieldSize: 10` / `fieldNameSize: 100` byte limits as `MulterError`s and
 * populates `req.files` / `req.body`.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OcRequest, UploadedFile } from './types';

// multer was configured with `limits: { fieldSize: 10 }`; busboy's
// fieldNameSize default (100 bytes) also applies.
const FIELD_SIZE_LIMIT = 10;
const FIELD_NAME_SIZE_LIMIT = 100;

class MulterError extends Error {
  code: string;
  field?: string;

  constructor(code: string, message: string, field?: string) {
    super(message);
    this.name = 'MulterError';
    this.code = code;
    this.field = field;
  }
}

const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

const hasBoundary = (req: OcRequest): boolean => {
  const contentType = req.headers['content-type'];
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  return typeof value === 'string' && /boundary=/i.test(value);
};

/**
 * Parse the request body as multipart/form-data and populate
 * `req.files`/`req.body`. Throws on unsupported content types and on
 * limit violations (surfaces as a 500 via the error handler, matching
 * multer/busboy behaviour).
 */
export async function parseMultipart(
  req: OcRequest,
  opts: {
    tempDir: string;
    filename: (originalName: string) => string;
  }
): Promise<void> {
  const contentType = req.headers['content-type'];
  const value = Array.isArray(contentType) ? contentType[0] : contentType;

  if (typeof value !== 'string' || !/^multipart\//i.test(value.trim())) {
    throw new Error('Unsupported content type');
  }
  if (!hasBoundary(req)) {
    throw new Error('Multipart: Boundary not found');
  }

  const formData = await req.raw.formData();

  const files: UploadedFile[] = [];
  const body: Record<string, unknown> = {};

  // Bun's `FormData.entries()` is typed as `[string, string]` but file parts
  // are `File` instances at runtime — widen the iterator value type.
  const entries = formData.entries() as unknown as Iterable<
    [string, Bun.FormDataEntryValue]
  >;

  for (const [fieldname, entry] of entries) {
    if (byteLength(fieldname) > FIELD_NAME_SIZE_LIMIT) {
      throw new MulterError(
        'LIMIT_FIELD_KEY',
        `Field name too long: ${fieldname}`,
        fieldname
      );
    }

    if (typeof entry === 'string') {
      if (byteLength(entry) > FIELD_SIZE_LIMIT) {
        throw new MulterError(
          'LIMIT_FIELD_VALUE',
          `Field value too long for field "${fieldname}"`,
          fieldname
        );
      }
      const existing = body[fieldname];
      if (existing === undefined) {
        body[fieldname] = entry;
      } else if (Array.isArray(existing)) {
        existing.push(entry);
      } else {
        body[fieldname] = [existing, entry];
      }
      continue;
    }

    // File part
    const originalname = entry.name || 'blob';
    const filename = opts.filename(originalname);
    const destination = opts.tempDir;
    const filePath = path.join(destination, filename);

    const data = new Uint8Array(await entry.arrayBuffer());
    try {
      await mkdir(destination, { recursive: true });
      await writeFile(filePath, data);
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }

    files.push({
      fieldname,
      originalname,
      encoding: '7bit',
      mimetype: entry.type || 'application/octet-stream',
      size: entry.size ?? data.byteLength,
      destination,
      filename,
      path: filePath
    });
  }

  req.files = files;
  req.body = body;
}

/**
 * Whether the request should be handled by the multipart parser.
 * multer ran on every PUT — non-multipart PUTs surface a busboy
 * "Unsupported content type" error, which `parseMultipart` reproduces.
 */
export function shouldParseUploads(req: OcRequest): boolean {
  return req.method === 'PUT';
}
