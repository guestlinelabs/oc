// Vendored from oc-client-browser@2.1.13 (MIT License, (c) OpenComponents
// community). See ../LICENSE.md. Reference implementation kept for
// documentation: upstream built the client bundle with esbuild + uglify-js.
// The registry now performs the same compilation with Bun.build in
// src/registry/domain/compile-client.ts, so these tasks are not executed.
const fs = require('node:fs/promises');
const path = require('node:path');
const { compile } = require('./compile');

async function build() {
  const distPath = '../dist/';
  const compiled = await compile();

  await fs.mkdir(path.join(__dirname, distPath), { recursive: true });
  await fs.writeFile(
    path.join(__dirname, distPath, 'oc-client.min.map'),
    compiled.map,
    'utf-8'
  );
  await fs.writeFile(
    path.join(__dirname, distPath, 'oc-client.min.js'),
    compiled.code,
    'utf-8'
  );
  await fs.writeFile(
    path.join(__dirname, distPath, 'oc-client.js'),
    compiled.dev,
    'utf-8'
  );
}

build().catch((err) => {
  console.error('Something went wrong:', err.message);
  process.exit(1);
});
