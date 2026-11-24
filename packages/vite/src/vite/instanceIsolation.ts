import MagicString from 'magic-string';
import type { Plugin } from 'vite';

const FACTORY = '__$$oc_instance__';

type Node = {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
};

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression'
]);

function hasTopLevelAwait(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(hasTopLevelAwait);
  const n = node as Node;
  if (FUNCTION_TYPES.has(n.type)) return false;
  if (n.type === 'AwaitExpression') return true;
  if (n.type === 'ForOfStatement' && n['await']) return true;
  for (const key in n) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    if (hasTopLevelAwait(n[key])) return true;
  }
  return false;
}

function exportedName(node: { type: string; name?: string; value?: unknown }) {
  return node.type === 'Identifier' ? node.name! : String(node.value);
}

/**
 * Evaluates the component's code once per mounted instance, like the
 * function-based upstream templates (`oc-template-react`, `-es6`, …) did.
 *
 * An ES module is evaluated once per page, so without this every instance
 * of the same component version shares one module scope: the
 * `__$$oc_initialData__` / `__$$oc_Settings__` values the mount wrapper
 * assigns (read by `getInitialData()`, `getSettings()` and `serverClient`)
 * would always be the last-mounted instance's. Here `template.js`'s body
 * (everything but its `import`s, which are hoisted) moves into a factory
 * that declares its own copies of those two variables, and the exported
 * `mount` creates a fresh instance per call. Module-level state of the
 * component (stores, caches, i18n instances) is per instance as a result.
 *
 * Runs on the entry chunk only and leaves the chunk unchanged, with a
 * warning, when the shape is not one it can wrap safely: code-split
 * chunks, top-level `await`, re-exports, or exports other than `mount`.
 */
export function ocInstanceIsolationPlugin(options: {
  enabled: () => boolean;
}): Plugin {
  return {
    name: 'OcInstanceIsolation',
    apply: 'build',
    renderChunk: {
      order: 'post',
      handler(code, chunk, _outputOptions, meta) {
        if (
          !options.enabled() ||
          chunk.fileName !== 'template.js' ||
          !chunk.isEntry
        ) {
          return null;
        }
        const skip = (reason: string) => {
          this.warn(
            `template.js is not isolated per instance (${reason}); ` +
              'getInitialData()/getSettings() return the last-mounted ' +
              "instance's values when a page mounts this component more than once."
          );
          return null;
        };

        const chunks = (meta as { chunks?: Record<string, unknown> }).chunks;
        const internal = [...chunk.imports, ...chunk.dynamicImports].filter(
          (id) => (chunks ? id in chunks : !/^[a-z@]/i.test(id))
        );
        if (internal.length > 0) {
          return skip(`it imports other chunks: ${internal.join(', ')}`);
        }

        const program = this.parse(code) as unknown as { body: Node[] };
        const s = new MagicString(code);
        const exports: { local: string; exported: string }[] = [];
        let firstStatement: Node | undefined;

        for (const node of program.body) {
          switch (node.type) {
            case 'ImportDeclaration':
              if (firstStatement) s.move(node.start, node.end, 0);
              continue;
            case 'ExportAllDeclaration':
              return skip('it re-exports another module');
            case 'ExportNamedDeclaration': {
              if (node['source']) return skip('it re-exports another module');
              const declaration = node['declaration'] as Node | null;
              if (declaration) {
                const id = declaration['id'] as { name: string } | undefined;
                if (!id) return skip('it exports a destructured declaration');
                exports.push({ local: id.name, exported: id.name });
                s.remove(node.start, declaration.start);
              } else {
                for (const spec of node['specifiers'] as {
                  local: { type: string; name?: string; value?: unknown };
                  exported: { type: string; name?: string; value?: unknown };
                }[]) {
                  exports.push({
                    local: exportedName(spec.local),
                    exported: exportedName(spec.exported)
                  });
                }
                s.remove(node.start, node.end);
              }
              break;
            }
            case 'ExportDefaultDeclaration':
              return skip('it has a default export');
          }
          firstStatement ??= node;
        }

        if (exports.length !== 1 || exports[0]!.exported !== 'mount') {
          return skip(
            `it exports ${exports.map((e) => e.exported).join(', ') || 'nothing'} instead of only mount`
          );
        }
        if (hasTopLevelAwait(program.body)) {
          return skip('it uses top-level await');
        }

        const local = exports[0]!.local;
        const start = firstStatement?.start ?? code.length;
        s.appendLeft(
          start,
          `function ${FACTORY}(){var __$$oc_initialData__,__$$oc_Settings__;`
        );
        s.append(
          `\nreturn ${local}}\nexport function mount(element,props,ctx){return ${FACTORY}()(element,props,ctx)}\n`
        );
        return {
          code: s.toString(),
          map: s.generateMap({ hires: true })
        };
      }
    }
  };
}
