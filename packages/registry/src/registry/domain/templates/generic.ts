import vm from 'node:vm';
import type { Template, TemplateInfo } from '../../../types';

/**
 * Generic built-in template implementation shared by all the templates the
 * registry ships with. Mirrors oc-generic-template-renderer: the compiled
 * template is evaluated in a fresh vm context and rendered by calling it
 * with the model (no server-side rendering).
 */
export function createTemplate(info: TemplateInfo): Template {
  return {
    getInfo: () => ({
      ...info,
      externals: info.externals.map((external) => ({ ...external }))
    }),
    getCompiledTemplate: (templateString, key, context = {}) => {
      vm.runInNewContext(templateString, context);
      return (context as any).oc.components[key];
    },
    render: ({ template, model }, cb) => {
      try {
        cb(null, template(model));
      } catch (err) {
        cb(err as Error, '');
      }
    }
  };
}
