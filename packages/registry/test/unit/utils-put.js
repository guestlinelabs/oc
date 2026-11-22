const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const expect = require('chai').expect;

describe('utils : put', () => {
  let server;
  let tempFile;
  let tempDir;
  let put;
  let received;

  before((done) => {
    put = require('../../dist/utils/put').default;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-put-'));
    tempFile = path.join(tempDir, 'package.tar.gz');
    fs.writeFileSync(tempFile, Buffer.from('a'.repeat(64 * 1024)));

    received = {};
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        received.method = req.method;
        received.url = req.url;
        received.contentType = req.headers['content-type'];
        received.bodyLength = Buffer.concat(chunks).length;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('published');
      });
    });

    server.listen(0, '127.0.0.1', done);
  });

  after((done) => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    server.close(done);
  });

  it('uploads a file as multipart form data over HTTP/1.1', async () => {
    const url = `http://127.0.0.1:${server.address().port}/component/1.0.0`;
    const response = await put(url, tempFile, {});

    expect(response).to.equal('published');
    expect(received.method).to.equal('PUT');
    expect(received.url).to.equal('/component/1.0.0');
    expect(received.contentType).to.contain('multipart/form-data');
    expect(received.bodyLength).to.be.greaterThan(64 * 1024);
  });
});
