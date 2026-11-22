import type { Plugin } from 'vite';

const cssLangs = `\\.(css|less|sass|scss|styl|stylus|pcss|postcss)($|\\?)`;
const importRE =
  /import\s+([\S]+)\s+from\s+('|")([\S]+)\.(css|less|sass|scss|styl|stylus|postcss)(\?[\S]*)?('|")/;
const jsRE = /\.(js|mjs|ts|jsx|tsx)/;
const cssLangRE = new RegExp(cssLangs);
const cssModuleRE = new RegExp(`\\.module${cssLangs}`);

/**
 * Rewrites `import x from './foo.css'` to `import x from './foo.css?.module.css'`
 * so Vite treats every CSS import with bindings as a CSS module (OC semantics:
 * all CSS imports are CSS modules). Ported from `oc-vite-compiler`'s
 * `cssModulesPlugin.ts`, replacing the Babel transform with a regex pass —
 * same gate (`jsRE && importRE`) and same rewrite rule as the upstream
 * `ImportDeclaration` visitor (specifiers required, `.module.*` skipped).
 */
export default function cssModulesPlugin(): Plugin {
  const name = 'vite-plugin-transform-css-modules';
  return {
    name,
    transform(code: string, id: string) {
      if (!jsRE.test(id) || !importRE.test(code)) {
        return undefined;
      }
      // Match `import <specifiers> from '<path>'` where <specifiers> is
      // non-empty (side-effect imports are left alone, like upstream).
      const rewritten = code.replace(
        /\bimport\s+(?:type\s+)?([\w$*{}\s,]*[\w$*][\w$*{}\s,]*)\s+from\s*(['"])([^'"]+?)\2/g,
        (match, _specifiers: string, quote: string, cssFile: string) => {
          if (
            !cssLangRE.test(cssFile) ||
            cssModuleRE.test(cssFile) ||
            cssFile.startsWith('\0')
          ) {
            return match;
          }
          const extension = cssFile.split('.').pop() ?? 'css';
          const rewrittenPath =
            cssFile +
            (cssFile.indexOf('?') > -1 ? '&' : '?') +
            `.module.${extension}`;
          return `import ${_specifiers} from ${quote}${rewrittenPath}${quote}`;
        }
      );
      if (rewritten === code) {
        return undefined;
      }
      return {
        code: rewritten,
        // The regex rewrite does not track positions; upstream returned the
        // Babel-generated map. A null map only affects dev sourcemaps of the
        // rewritten import specifier.
        map: null
      };
    }
  };
}
