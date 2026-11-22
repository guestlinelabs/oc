import path from 'node:path';

async function put(
  urlPath: string,
  files: string | string[],
  headers: Record<string, string | string[] | undefined>
): Promise<string> {
  const form = new FormData();

  if (!Array.isArray(files)) {
    files = [files];
  }

  for (const file of files) {
    const fileName = path.basename(file);
    form.append(
      fileName,
      new File([Bun.file(file)], fileName, {
        type: 'application/gzip'
      })
    );
  }

  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    normalizedHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  const res = await fetch(urlPath, {
    method: 'PUT',
    headers: normalizedHeaders,
    body: form
  });

  const response = await res.text();
  if (res.status !== 200) {
    throw response;
  }

  return response;
}

export default put;
