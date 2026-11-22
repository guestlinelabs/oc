import type { Plugin } from 'vite';

/**
 * Port of `oc-vite-compiler`'s `InitialDataVariables` plugin: declares the
 * `__$$oc_initialData__` / `__$$oc_Settings__` globals the mount wrapper
 * assigns to, ahead of every emitted JS chunk.
 */
export default function initialDataPlugin(): Plugin {
  return {
    name: 'OcInitialDataVariables',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const jsFiles = Object.keys(bundle).filter((x) => x.endsWith('.js'));
      for (const jsFile of jsFiles) {
        const template = bundle[jsFile];
        if (template.type !== 'chunk') continue;
        template.code = `
            var __$$oc_initialData__;
            var __$$oc_Settings__;
            ${template.code}
          `;
      }
    }
  };
}
