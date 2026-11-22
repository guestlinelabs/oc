const expect = require('chai').expect;

const {
  isPrivateComponentFile
} = require('../../dist/registry/domain/storage-adapter');

describe('registry : domain : storage-adapter', () => {
  describe('component file privacy', () => {
    it('keeps server.js and dot-files private on any platform', () => {
      expect(isPrivateComponentFile('/server.js')).to.be.true;
      expect(isPrivateComponentFile('\\nested\\server.js')).to.be.true;
      expect(isPrivateComponentFile('/.env')).to.be.true;
      expect(isPrivateComponentFile('\\nested\\.secret')).to.be.true;
    });

    it('keeps other component files public', () => {
      expect(isPrivateComponentFile('/package.json')).to.be.false;
      expect(isPrivateComponentFile('/template.js')).to.be.false;
    });
  });
});
