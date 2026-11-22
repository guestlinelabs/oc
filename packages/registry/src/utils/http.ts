// Minimal fetch-based drop-in for the subset of undici's `request()` used
// across the registry and cli. Resolves with { statusCode, headers, body }
// where `headers` is a plain lowercase-keyed object (`set-cookie` kept as an
// array) and `body` exposes `json()` and `text()`.

export type HttpHeaders = Record<string, string | string[] | undefined>;

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: {
    json(): Promise<any>;
    text(): Promise<string>;
  };
}

export interface HttpRequestOptions {
  method?: string;
  headers?: HttpHeaders;
  body?: BodyInit | null;
}

const normalizeHeaders = (headers: HttpHeaders): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    normalized[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return normalized;
};

export async function request(
  url: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse> {
  const { method = 'GET', headers = {}, body } = options;
  const response = await fetch(url, {
    method,
    headers: normalizeHeaders(headers),
    body
  });

  const responseHeaders: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') {
      responseHeaders[key] = value;
    }
  });
  if (typeof response.headers.getSetCookie === 'function') {
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) {
      responseHeaders['set-cookie'] = cookies;
    }
  }

  return {
    statusCode: response.status,
    headers: responseHeaders,
    body: {
      json: () => response.json(),
      text: () => response.text()
    }
  };
}
