const expect = require('chai').expect;

const {
  builtinTemplates,
  es6Template,
  esmTemplate,
  reactTemplate,
  solidTemplate,
  typescriptReactTemplate
} = require('../../dist/registry/domain/templates');

describe('registry : domain : templates', () => {
  describe('getInfo values', () => {
    it('oc-template-es6 matches oc-template-es6@2.0.0', () => {
      expect(es6Template.getInfo()).to.deep.equal({
        type: 'oc-template-es6',
        version: '2.0.0',
        externals: []
      });
    });

    it('oc-template-react matches oc-template-react@4.1.0', () => {
      expect(reactTemplate.getInfo()).to.deep.equal({
        type: 'oc-template-react',
        version: '4.1.0',
        externals: [
          {
            name: 'react',
            global: 'React',
            url: 'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
            devUrl:
              'https://unpkg.com/react@18.3.1/umd/react.development.js'
          },
          {
            name: 'react-dom',
            global: 'ReactDOM',
            url: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
            devUrl:
              'https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js'
          }
        ]
      });
    });

    it('oc-template-typescript-react matches oc-template-typescript-react@4.1.0', () => {
      expect(typescriptReactTemplate.getInfo()).to.deep.equal({
        type: 'oc-template-typescript-react',
        version: '4.1.0',
        externals: [
          {
            name: 'react',
            global: 'React',
            url: 'https://unpkg.com/react@18.2.0/umd/react.production.min.js',
            devUrl:
              'https://unpkg.com/react@18.2.0/umd/react.development.js'
          },
          {
            name: 'react-dom',
            global: 'ReactDOM',
            url: 'https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js',
            devUrl:
              'https://unpkg.com/react-dom@18.2.0/umd/react-dom.development.js'
          }
        ]
      });
    });

    it('oc-template-solid matches oc-template-solid@0.1.4', () => {
      expect(solidTemplate.getInfo()).to.deep.equal({
        type: 'oc-template-solid',
        version: '0.1.4',
        externals: []
      });
    });

    it('oc-template-esm matches oc-template-esm@0.0.1', () => {
      expect(esmTemplate.getInfo()).to.deep.equal({
        type: 'oc-template-esm',
        version: '0.0.1',
        externals: []
      });
    });

    it('registers all five built-in templates', () => {
      expect(builtinTemplates.map((t) => t.getInfo().type)).to.eql([
        'oc-template-es6',
        'oc-template-react',
        'oc-template-typescript-react',
        'oc-template-solid',
        'oc-template-esm'
      ]);
    });
  });

  describe('getCompiledTemplate + render', () => {
    // Modelled on a vite-compiled react template.js
    const templateSrc = `var oc=oc||{};oc.components=oc.components||{};oc.components['abc']=function(model){return '<div>'+model.component.props.x+'</div>'}`;

    it('compiles the template in a vm context and returns the component', () => {
      const template = es6Template.getCompiledTemplate(templateSrc, 'abc');
      expect(template).to.be.a('function');
    });

    it('renders the compiled template with the model', (done) => {
      const template = es6Template.getCompiledTemplate(templateSrc, 'abc');
      es6Template.render(
        {
          template,
          model: { component: { props: { x: 'hello' } } }
        },
        (err, html) => {
          expect(err).to.equal(null);
          expect(html).to.equal('<div>hello</div>');
          done();
        }
      );
    });

    it('passes render errors to the callback', (done) => {
      const template = () => {
        throw new Error('render boom');
      };
      es6Template.render({ template, model: {} }, (err) => {
        expect(err).to.be.an('error');
        expect(err.message).to.equal('render boom');
        done();
      });
    });
  });
});
