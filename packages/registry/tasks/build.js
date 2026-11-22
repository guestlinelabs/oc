// Assembles dist/components/oc-client/_package from the vendored published
// artifacts in assets/oc-client. app-start.ts and repository.ts read
// _package/package.json, template.js and server.js from disk at runtime,
// so this must run after `tsc` on every build.
const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.join(__dirname, '..');
const source = path.join(packageRoot, 'assets', 'oc-client');
const target = path.join(
  packageRoot,
  'dist',
  'components',
  'oc-client',
  '_package'
);

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });

console.log(`oc-client _package assembled at ${target}`);

// src/vendor/oc-client-browser is excluded from tsc (its dynamic import()
// must survive verbatim for the browser bundle), so copy it to dist for
// src/registry/domain/compile-client.ts to bundle at registry startup.
const vendoredClientSource = path.join(
  packageRoot,
  'src',
  'vendor',
  'oc-client-browser'
);
const vendoredClientTarget = path.join(
  packageRoot,
  'dist',
  'vendor',
  'oc-client-browser'
);

fs.rmSync(vendoredClientTarget, { recursive: true, force: true });
fs.cpSync(
  path.join(vendoredClientSource, 'src'),
  path.join(vendoredClientTarget, 'src'),
  {
    recursive: true
  }
);
fs.copyFileSync(
  path.join(vendoredClientSource, 'package.json'),
  path.join(vendoredClientTarget, 'package.json')
);
fs.copyFileSync(
  path.join(vendoredClientSource, 'LICENSE.md'),
  path.join(vendoredClientTarget, 'LICENSE.md')
);

console.log(
  `oc-client-browser vendored sources assembled at ${vendoredClientTarget}`
);

// @kitajs/html is kept as a devDependency for its types only. tsc emits
// `require("@kitajs/html...")` for the JSX runtime import and the
// layout.tsx Fragment import; rewrite those specifiers to the vendored
// runtime compiled from src/vendor/kitajs-html into dist/vendor/kitajs-html.
const kitajsDir = path.join(packageRoot, 'dist', 'vendor', 'kitajs-html');
const kitajsTargets = {
  '@kitajs/html/jsx-runtime': path.join(kitajsDir, 'jsx-runtime.js'),
  '@kitajs/html': path.join(kitajsDir, 'index.js')
};

const rewriteKitajsRequires = (filePath) => {
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('@kitajs/html')) {
    return;
  }

  const dir = path.dirname(filePath);
  let rewritten = content;
  for (const [specifier, target] of Object.entries(kitajsTargets)) {
    let relative = path.relative(dir, target).split(path.sep).join('/');
    if (!relative.startsWith('.')) {
      relative = './' + relative;
    }
    rewritten = rewritten
      .split(`require("${specifier}")`)
      .join(`require("${relative}")`)
      .split(`require('${specifier}')`)
      .join(`require('${relative}')`);
  }
  fs.writeFileSync(filePath, rewritten);
};

const distDir = path.join(packageRoot, 'dist');
const walkJsFiles = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(entryPath);
    } else if (entry.name.endsWith('.js')) {
      rewriteKitajsRequires(entryPath);
    }
  }
};
walkJsFiles(distDir);

// Vendored packages keep their licences next to the compiled output so the
// published tarball (files: ["dist"]) still carries them.
const vendorSourceDir = path.join(packageRoot, 'src', 'vendor');
for (const entry of fs.readdirSync(vendorSourceDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const vendorDistDir = path.join(distDir, 'vendor', entry.name);
  if (!fs.existsSync(vendorDistDir)) continue;
  for (const file of fs.readdirSync(path.join(vendorSourceDir, entry.name))) {
    if (/^licen[cs]e/i.test(file)) {
      fs.copyFileSync(
        path.join(vendorSourceDir, entry.name, file),
        path.join(vendorDistDir, file)
      );
    }
  }
}
