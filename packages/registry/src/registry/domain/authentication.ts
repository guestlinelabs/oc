import strings from '../../resources/';
import type { Authentication, PublishAuthConfig } from '../../types';
import type { ConnectMiddleware, OcResponse } from './http-server/types';

type BasicAuthCheck = (user: string, pass: string) => boolean;

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const DEFAULT_REALM = 'Authorization Required';

/**
 * Drop-in replacement for the `basic-auth-connect` package (removed with the
 * Express layer). Preserves its observable behaviour: 401 +
 * `WWW-Authenticate` when credentials are missing or rejected, a 400 error
 * passed to `next` for malformed Authorization headers, and `req.user` set to
 * the authenticated username.
 */
function basicAuth(
  check: BasicAuthCheck,
  realm: string = DEFAULT_REALM
): ConnectMiddleware {
  return (req, res, next) => {
    const authorization = req.headers.authorization;

    if (req.user) {
      next();
      return;
    }
    if (!authorization) {
      unauthorized(res, realm);
      return;
    }

    const parts = authorization.split(' ');
    if (parts.length !== 2) {
      next(badRequestError());
      return;
    }

    const scheme = parts[0];
    const credentials = Buffer.from(parts[1], 'base64').toString();
    const index = credentials.indexOf(':');

    if (scheme !== 'Basic' || index < 0) {
      next(badRequestError());
      return;
    }

    const user = credentials.slice(0, index);
    const pass = credentials.slice(index + 1);

    if (check(user, pass)) {
      req.user = user;
      next();
    } else {
      unauthorized(res, realm);
    }
  };
}

function unauthorized(res: OcResponse, realm: string) {
  res.statusCode = HTTP_UNAUTHORIZED;
  res.setHeader('WWW-Authenticate', `Basic realm="${realm}"`);
  res.end('Unauthorized');
}

function badRequestError(): Error & { status: number } {
  const err = new Error('Bad Request') as Error & { status: number };
  err.status = HTTP_BAD_REQUEST;
  return err;
}

const basicAuthentication: Authentication<
  | {
      username: string;
      password: string;
    }
  | { logins: Array<{ username: string; password: string }> }
> = {
  validate(authConfig) {
    const logins = 'logins' in authConfig ? authConfig.logins : [authConfig];

    const isValid =
      logins.length > 0 &&
      logins.every((login) => !!login.username && !!login.password);

    return {
      isValid,
      message: isValid
        ? ''
        : strings.errors.registry
            .CONFIGURATION_PUBLISH_BASIC_AUTH_CREDENTIALS_MISSING
    };
  },
  middleware(authConfig) {
    const logins = 'logins' in authConfig ? authConfig.logins : [authConfig];

    return basicAuth((user, pass) =>
      logins.some((login) => login.username === user && login.password === pass)
    );
  }
};

const builtin: Record<string, Authentication> = {
  basic: basicAuthentication
};

let scheme: Authentication;

export function validate(authConfig: PublishAuthConfig) {
  if (typeof authConfig.type !== 'string') {
    scheme = authConfig.type;
  } else if (builtin[authConfig.type]) {
    scheme = builtin[authConfig.type];
  } else {
    const moduleName = `oc-auth-${authConfig.type}`;

    try {
      scheme = require(moduleName);
    } catch {
      return {
        isValid: false,
        message:
          strings.errors.registry.CONFIGURATION_PUBLISH_AUTH_MODULE_NOT_FOUND(
            moduleName
          )
      };
    }
  }

  return scheme.validate(authConfig);
}

export function middleware(authConfig: unknown): ConnectMiddleware {
  return scheme.middleware(authConfig) as ConnectMiddleware;
}
