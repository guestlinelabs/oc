const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { expect } = require('chai');

const { compress, decompress } = require('../../dist/utils/targz');

describe('utils : targz', () => {
  let tmpDir;
  let srcDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-targz-'));
    srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(path.join(srcDir, 'nested', 'deep'), {
      recursive: true
    });
    await fs.writeFile(path.join(srcDir, 'root.txt'), 'root-content');
    await fs.writeFile(
      path.join(srcDir, 'nested', 'child.txt'),
      'child-content'
    );
    await fs.writeFile(
      path.join(srcDir, 'nested', 'deep', 'leaf.bin'),
      Buffer.from([0, 1, 2, 250, 255])
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('round-trips files through compress and decompress', async () => {
    const archivePath = path.join(tmpDir, 'package.tar.gz');
    const outDir = path.join(tmpDir, 'out');

    await compress(srcDir, archivePath, '_package');
    await decompress(archivePath, outDir);

    const packageDir = path.join(outDir, '_package');
    expect(
      await fs.readFile(path.join(packageDir, 'root.txt'), 'utf8')
    ).to.equal('root-content');
    expect(
      await fs.readFile(path.join(packageDir, 'nested', 'child.txt'), 'utf8')
    ).to.equal('child-content');
    expect(
      await fs.readFile(path.join(packageDir, 'nested', 'deep', 'leaf.bin'))
    ).to.eql(Buffer.from([0, 1, 2, 250, 255]));
  });

  it('produces a gzip-compressed tarball readable by decompress', async () => {
    const archivePath = path.join(tmpDir, 'package.tar.gz');
    await compress(srcDir, archivePath, '_package');

    const header = await Bun.file(archivePath).slice(0, 2).arrayBuffer();
    // gzip magic bytes
    expect(new Uint8Array(header)).to.eql(new Uint8Array([0x1f, 0x8b]));
  });
});
