import type { Template, TemplateInfo } from '../../types';
import { builtinTemplates } from './templates';

export default function registerTemplates(
  extraTemplates: Template[],
  dev = false
): {
  templatesHash: Record<string, Template>;
  templatesInfo: TemplateInfo[];
} {
  const coreTemplates: Template[] = builtinTemplates;
  const templates = [...new Set([...coreTemplates, ...(extraTemplates ?? [])])];
  const templatesHash = templates.reduce(
    (hash, template) => {
      const type = template.getInfo().type;
      hash[type] = template;
      return hash;
    },
    {} as Record<string, Template>
  );

  const templatesInfo = templates.map((template) => {
    const { externals, ...rest } = template.getInfo();
    return {
      ...rest,
      externals: externals.map(({ url, devUrl, ...rest }) => ({
        ...rest,
        url: dev && devUrl ? devUrl : url
      }))
    };
  });

  return {
    templatesHash,
    templatesInfo
  };
}
