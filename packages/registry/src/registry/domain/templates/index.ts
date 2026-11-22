import type { Template } from '../../../types';
import { createTemplate } from './generic';

const reactExternals18 = (version: string) => [
  {
    name: 'react',
    global: 'React',
    url: `https://unpkg.com/react@${version}/umd/react.production.min.js`,
    devUrl: `https://unpkg.com/react@${version}/umd/react.development.js`
  },
  {
    name: 'react-dom',
    global: 'ReactDOM',
    url: `https://unpkg.com/react-dom@${version}/umd/react-dom.production.min.js`,
    devUrl: `https://unpkg.com/react-dom@${version}/umd/react-dom.development.js`
  }
];

// Built-in templates shipped by the registry. Values mirror the published
// template packages: oc-template-es6@2.0.0, oc-template-react@4.1.0,
// oc-template-typescript-react@4.1.0, oc-template-solid@0.1.4 and
// oc-template-esm@0.0.1.
export const es6Template: Template = createTemplate({
  type: 'oc-template-es6',
  version: '2.0.0',
  externals: []
});

export const reactTemplate: Template = createTemplate({
  type: 'oc-template-react',
  version: '4.1.0',
  externals: reactExternals18('18.3.1')
});

export const typescriptReactTemplate: Template = createTemplate({
  type: 'oc-template-typescript-react',
  version: '4.1.0',
  externals: reactExternals18('18.2.0')
});

export const solidTemplate: Template = createTemplate({
  type: 'oc-template-solid',
  version: '0.1.4',
  externals: []
});

export const esmTemplate: Template = createTemplate({
  type: 'oc-template-esm',
  version: '0.0.1',
  externals: []
});

export const builtinTemplates: Template[] = [
  es6Template,
  reactTemplate,
  typescriptReactTemplate,
  solidTemplate,
  esmTemplate
];
