const expect = require('chai').expect;

const {
  builtinTemplates,
  es6Template,
  esmTemplate,
  reactTemplate,
  solidTemplate,
  typescriptReactTemplate
} = require('../../dist/registry/domain/templates');

describe('registry : domain : register-templates', () => {
  const registerTemplates =
    require('../../dist/registry/domain/register-templates.js').default;

  const coreTemplatesHash = {
    'oc-template-es6': es6Template,
    'oc-template-react': reactTemplate,
    'oc-template-typescript-react': typescriptReactTemplate,
    'oc-template-solid': solidTemplate,
    'oc-template-esm': esmTemplate
  };

  // templatesInfo strips devUrl and resolves url against the dev flag
  const expectedInfo = (templates, dev = false) =>
    templates.map((template) => {
      const { externals, ...rest } = template.getInfo();
      return {
        ...rest,
        externals: externals.map(({ url, devUrl, ...rest }) => ({
          ...rest,
          url: dev && devUrl ? devUrl : url
        }))
      };
    });

  describe('when templates get registered without additional templates', () => {
    const registerd = registerTemplates();

    it('should correctly register core-templates', () => {
      expect(registerd.templatesHash).to.deep.eql(coreTemplatesHash);
      expect(registerd.templatesInfo).to.deep.eql(
        expectedInfo(builtinTemplates)
      );
    });
  });

  describe('when templates get registered with additional templates', () => {
    const getTemplateMock = (dev) => ({
      getInfo() {
        return {
          type: 'new-tpl',
          version: '6.6.6',
          externals: [{ url: 'produrl', ...(dev && { devUrl: 'devurl' }) }]
        };
      }
    });
    const templateMock = getTemplateMock();
    const devTemplateMock = getTemplateMock(true);

    const registered = registerTemplates([templateMock]);

    it('should correctly register core-templates & extra templates', () => {
      expect(registered.templatesHash).to.deep.eql({
        ...coreTemplatesHash,
        'new-tpl': templateMock
      });
      expect(registered.templatesInfo).to.deep.eql([
        ...expectedInfo(builtinTemplates),
        templateMock.getInfo()
      ]);
    });

    const devRegistered = registerTemplates([devTemplateMock], true);

    it('should replace the devurl for the url field', () => {
      expect(
        devRegistered.templatesInfo[builtinTemplates.length].externals[0].url
      ).to.eql('devurl');
    });

    describe('and additional template is already part of core-templates', () => {
      const registered = registerTemplates([es6Template]);

      it('should correctly register core-templates only', () => {
        expect(registered.templatesHash).to.deep.eql(coreTemplatesHash);
        expect(registered.templatesInfo).to.deep.eql(
          expectedInfo(builtinTemplates)
        );
      });
    });

    describe('and additional template overrides a core-template type', () => {
      const overrideMock = {
        getInfo() {
          return {
            type: 'oc-template-react',
            version: '0.0.0-test',
            externals: []
          };
        }
      };
      const registered = registerTemplates([overrideMock]);

      it('should keep the user-provided template for that type', () => {
        expect(registered.templatesHash['oc-template-react']).to.equal(
          overrideMock
        );
      });
    });
  });
});
