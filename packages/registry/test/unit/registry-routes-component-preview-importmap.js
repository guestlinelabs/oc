const expect = require('chai').expect;
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ComponentPreviewRoute =
  require('../../dist/registry/routes/component-preview').default;

describe('registry : routes : component preview import map', () => {
  let componentsDir;

  const component = {
    name: 'my-component',
    version: '1.0.0',
    allVersions: ['1.0.0'],
    oc: {
      files: {
        template: { type: 'oc-template-esm', src: 'template.js', hashKey: 'k' }
      }
    }
  };

  const writeOcJson = (dir, imports) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'oc.json'),
      JSON.stringify({ development: { importmap: { imports } } })
    );
  };

  const renderPreview = (local) =>
    new Promise((resolve) => {
      const route = ComponentPreviewRoute(
        {},
        {
          getComponent: async () => component,
          getTemplatesInfo: () => []
        }
      );
      route(
        {
          headers: { accept: 'text/html' },
          params: { componentName: 'my-component', componentVersion: '1.0.0' },
          query: {}
        },
        {
          conf: {
            local,
            path: componentsDir,
            baseUrl: 'http://localhost:3000/',
            discovery: { robots: false }
          },
          send: resolve
        }
      );
    });

  beforeEach(() => {
    componentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-preview-'));
  });

  afterEach(() => {
    fs.rmSync(componentsDir, { recursive: true, force: true });
  });

  it('uses the component folder oc.json import map in local mode', async () => {
    writeOcJson(path.join(componentsDir, 'my-component'), {
      react: 'https://esm.sh/react@19.2.0'
    });

    const html = await renderPreview(true);

    expect(html).to.contain('<script type="importmap">');
    expect(html).to.contain('https://esm.sh/react@19.2.0');
  });

  it('still finds the oc.json of the components dir in local mode', async () => {
    writeOcJson(componentsDir, { react: 'https://esm.sh/react@18.3.1' });

    const html = await renderPreview(true);

    expect(html).to.contain('https://esm.sh/react@18.3.1');
  });

  it('ignores the component folder outside local mode', async () => {
    writeOcJson(path.join(componentsDir, 'my-component'), {
      react: 'https://esm.sh/react@19.2.0'
    });

    const html = await renderPreview(false);

    expect(html).not.to.contain('https://esm.sh/react@19.2.0');
  });
});
