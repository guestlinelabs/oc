// Minimal drop-in for the subset of undici's `request()` used by the
// acceptance tests. Resolves with { statusCode, headers, body } where
// `headers` is a plain lowercase-keyed object (`set-cookie` kept as an
// array, like undici) and `body` exposes `json()` and `text()`.
// `throwHttpErrors` is accepted for signature compatibility; fetch never
// throws on HTTP error statuses.
async function request(url, options = {}) {
  const { method = 'GET', headers = {}, body } = options;
  const response = await fetch(url, { method, headers, body });

  const responseHeaders = {};
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

module.exports = { request };
