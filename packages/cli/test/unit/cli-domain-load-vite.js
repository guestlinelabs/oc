const expect = require('chai').expect;
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadVite } = require('../../dist/cli/domain/load-vite.js');

const FIXTURE = path.join(__dirname, '../fixtures/components/hello-world');

describe('cli : domain : load-vite', () => {
  describe('when the component has vite installed', () => {
    it("should load the component's own vite", async () => {
      const vite = await loadVite(FIXTURE);
      expect(vite.build).to.be.a('function');
      expect(vite.resolveConfig).to.be.a('function');
    });
  });

  describe('when the component does not have vite installed', () => {
    it('should fail even though Bun has a global package cache', async () => {
      // /tmp is outside the workspace, so no ancestor node_modules provides
      // vite — Bun's require.resolve would still find one in the global
      // install cache, which is exactly what this resolution must not do.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-no-vite-'));
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'no-vite' })
      );

      let error;
      try {
        await loadVite(dir);
      } catch (err) {
        error = err;
      }
      expect(error).to.be.an.instanceOf(Error);
      expect(error.message).to.contain('vite is not installed');
    });
  });
});
