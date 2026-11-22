/**
 * Minimal `http-errors` replacement: creates an `Error` carrying the
 * Express-style `status`/`statusCode`/`type`/`expose`/`headers` properties
 * the body parsers and final handler rely on.
 */

export interface HttpError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export function createError(
  status: number,
  message?: string | Error,
  props?: Record<string, unknown>
): HttpError {
  let err: HttpError | undefined;
  let msg: string | undefined;

  if (message instanceof Error) {
    err = message as HttpError;
    // preserve an existing valid status like http-errors does
    const existing = err.status ?? err.statusCode;
    if (typeof existing === 'number' && existing >= 400 && existing < 600) {
      status = existing;
    }
    msg = err.message;
  } else {
    msg = message;
  }

  if (!err) {
    err = new Error(msg ?? '') as HttpError;
  } else if (msg !== undefined && err.message === '') {
    err.message = msg;
  }

  err.expose = status < 500;
  err.status = status;
  err.statusCode = status;

  if (props) {
    for (const key of Object.keys(props)) {
      if (key !== 'status' && key !== 'statusCode') {
        (err as Record<string, unknown>)[key] = props[key];
      }
    }
  }

  return err;
}
