const fs = require('node:fs');
const path = require('node:path');
const Mocha = require('mocha');

const mocha = new Mocha({ timeout: 20000 });
const silent = process.argv.includes('--silent');
const testDirs = ['test/unit', 'test/integration', 'test/acceptance'];

if (silent) {
  mocha.reporter('progress');
}

const addTestSuite = (dir) => {
  const root = path.join(__dirname, '..', dir);
  if (!fs.existsSync(root)) {
    return;
  }
  const files = fs
    .readdirSync(root, { recursive: true })
    .filter((file) => file.endsWith('.js'))
    .sort();
  for (const file of files) {
    mocha.addFile(path.join(root, file));
  }
};

testDirs.forEach(addTestSuite);
mocha.run((failures) => process.on('exit', () => process.exit(failures)));
