// Ported from oc-azure-storage-adapter/test (azure.test.js +
// privateFilesExclusion.test.js + mocks.js) to the repo's mocha setup.
// The @azure/* SDK and node:fs.createReadStream are mocked the same way
// upstream does; the inlined listFiles replaces the upstream mock of
// oc-storage-adapters-utils. injectr is used (like the other unit tests)
// because tasks/mochaTest.js loads test files through import(), which
// bypasses Module._load patching.
const assert = require('node:assert/strict');
const { expect } = require('chai');
const fs = require('node:fs');
const injectr = require('injectr');
const stream = require('node:stream');

const rejection = (promise) =>
  promise.then(
    () => {
      throw new Error('Expected promise to reject');
    },
    (err) => err
  );

let cachedTxt = 0;
let cachedJson = 0;

const blobServiceClient = {
  getContainerClient(containerName) {
    return {
      getBlobClient(filePath) {
        return {
          async download() {
            cachedTxt++;
            cachedJson++;
            const notExistsError = {
              name: 'StorageError',
              code: 'BlobNotFound',
              statusCode: 404
            };
            const contents = {
              'path/test.txt': { content: 'Hello!' },
              'path/test.json': { content: JSON.stringify({ data: 'Hello!' }) },
              'path/not-found.txt': { error: notExistsError },
              'path/not-found.json': { error: notExistsError },
              'path/not-a-json.json': { content: 'Not a json' },
              'path/to-mutable.json': {
                content: JSON.stringify({ value: cachedJson })
              },
              'path/to-mutable.txt': { content: String(cachedTxt) }
            };

            const testResult = contents[filePath];

            if (testResult.error) throw testResult.error;

            return {
              readableStreamBody: stream.Readable.from([testResult.content])
            };
          }
        };
      },
      getBlockBlobClient(fileName) {
        return {
          async uploadData(content, settings) {
            if (fileName.indexOf('error') >= 0) {
              throw { msg: 'sorry' };
            }

            return {
              fileName,
              lengthWritten: content.length,
              container: containerName,
              settings
            };
          }
        };
      },
      listBlobsByHierarchy(_delimiter, { prefix }) {
        return {
          async *[Symbol.asyncIterator]() {
            const entries = {
              'components/': [
                { name: 'components/image', kind: 'prefix' },
                {
                  name: 'components/components/details.json',
                  kind: 'blob'
                }
              ],
              'components/image/': [
                { name: 'components/image/1.0.0', kind: 'prefix' },
                { name: 'components/image/1.0.1', kind: 'prefix' }
              ],
              'components/image/1.0.0': [
                { name: 'components/image/1.0.1/image.png', kind: 'blob' }
              ]
            };

            for (const entry of entries[prefix] || []) {
              yield entry;
            }
          }
        };
      }
    };
  }
};

function StorageSharedKeyCredential(account, key) {
  return { account, key };
}

function BlobServiceClient(url, credentials) {
  return { _credentials: credentials, _url: url, ...blobServiceClient };
}

class DefaultAzureCredential {
  async getToken() {
    return { token: 'token', expiresOnTimestamp: Date.now() + 3600000 };
  }
}

const azure = injectr(
  '../../dist/storage/azure.js',
  {
    '@azure/identity': { DefaultAzureCredential },
    '@azure/storage-blob': { BlobServiceClient, StorageSharedKeyCredential },
    'node:fs': { ...fs, createReadStream: () => 'this is a stream' },
    './list-files': {
      listFiles: async (pathToDir) => [
        `${pathToDir}\\package.json`,
        `${pathToDir}\\server.js`,
        `${pathToDir}\\.env`,
        `${pathToDir}\\template.js`,
        `${pathToDir}/package.json`,
        `${pathToDir}/server.js`,
        `${pathToDir}/.env`,
        `${pathToDir}/template.js`
      ]
    }
  },
  // The adapter runs inside injectr's vm context: Buffer is not a JS builtin.
  { Buffer }
);

const validOptions = {
  publicContainerName: 'pubcon',
  privateContainerName: 'privcon',
  accountName: 'name',
  accountKey: 'key',
  path: '/',
  componentsDir: 'components'
};

describe('storage azure adapter', () => {
  it('should expose the correct methods', () => {
    const client = azure(validOptions);

    for (const api of [
      { method: 'adapterType', value: 'azure-blob-storage' },
      { method: 'getFile', type: 'function' },
      { method: 'getJson', type: 'function' },
      { method: 'getUrl', type: 'function' },
      { method: 'isValid', type: 'function' },
      { method: 'listSubDirectories', type: 'function' },
      { method: 'maxConcurrentRequests', value: 20 },
      { method: 'putDir', type: 'function' },
      { method: 'putFileContent', type: 'function' }
    ]) {
      // typeof is used instead of instanceof Function: the adapter runs in
      // injectr's vm realm, so instanceof against this realm's Function fails.
      if (api.type === 'function') {
        assert.equal(typeof client[api.method], 'function');
      } else {
        assert.equal(client[api.method], api.value);
      }
    }
  });

  it('validate valid conf without credentials', () => {
    const options = {
      accountName: 'name',
      publicContainerName: 'pubcon',
      privateContainerName: 'privcon',
      path: 'path',
      componentsDir: 'components'
    };
    const client = azure(options);
    assert.equal(client.isValid(), true);
  });

  it('validate valid conf with credentials', () => {
    const client = azure(validOptions);
    assert.equal(client.isValid(), true);
  });

  it('validate missing public container', () => {
    const client = azure({
      accountName: 'name',
      privateContainerName: 'privcon'
    });
    assert.equal(client.isValid(), false);
  });

  it('validate missing private container', () => {
    const client = azure({
      accountName: 'name',
      publicContainerName: 'pubcon'
    });
    assert.equal(client.isValid(), false);
  });

  it('validate missing name', () => {
    const client = azure({
      publicContainerName: 'pubcon',
      privateContainerName: 'privcon'
    });
    assert.equal(client.isValid(), false);
  });

  for (const scenario of [
    { src: 'path/test.txt', expected: { err: null, data: 'Hello!' } },
    {
      src: 'path/test.json',
      expected: { err: null, data: { data: 'Hello!' } }
    },
    {
      src: 'path/not-found.txt',
      expected: {
        err: {
          code: 'file_not_found',
          msg: 'File "path/not-found.txt" not found'
        }
      }
    },
    {
      src: 'path/not-found.json',
      expected: {
        err: {
          code: 'file_not_found',
          msg: 'File "path/not-found.json" not found'
        }
      }
    },
    {
      src: 'path/not-a-json.json',
      expected: {
        err: {
          code: 'file_not_valid',
          msg: 'File "path/not-a-json.json" not valid'
        }
      }
    }
  ]) {
    it(`test getFile ${scenario.src}`, async () => {
      const client = azure(validOptions);
      const operation = () =>
        client[scenario.src.match(/\.json$/) ? 'getJson' : 'getFile'](
          scenario.src,
          false
        );

      if (scenario.expected.err) {
        expect(await rejection(operation())).to.deep.equal(
          scenario.expected.err
        );
      } else {
        expect(await operation()).to.deep.equal(scenario.expected.data);
      }
    });
  }

  it('test getFile force mode', async () => {
    const client = azure(validOptions);

    const data1 = await client.getFile('path/to-mutable.txt', false);
    const data2 = await client.getFile('path/to-mutable.txt');
    const data3 = await client.getFile('path/to-mutable.txt', true);

    assert.equal(data1, data2);
    assert.notEqual(data3, data1);
  });

  it('test getJson force mode', async () => {
    const client = azure(validOptions);

    const data1 = await client.getJson('path/to-mutable.json', false);
    const data2 = await client.getJson('path/to-mutable.json');
    const data3 = await client.getJson('path/to-mutable.json', true);

    assert.equal(data1.value, data2.value);
    assert.notEqual(data3.value, data1.value);
  });

  for (const scenario of [
    { path: 'components/', expected: ['image'] },
    { path: 'components/image', expected: ['1.0.0', '1.0.1'] },
    { path: 'components/image/', expected: ['1.0.0', '1.0.1'] },
    { path: 'components/image/1.0.0/', expected: [] }
  ]) {
    it(`test listObjects when bucket is not empty for folder ${scenario.path}`, async () => {
      const client = azure(validOptions);

      const data = await client.listSubDirectories(scenario.path);

      expect(data).to.deep.equal(scenario.expected);
    });
  }

  for (const scenario of ['hello', 'path/']) {
    it(`test listObjects when bucket is empty for folder ${scenario}`, async () => {
      const client = azure(validOptions);

      const data = await client.listSubDirectories(scenario);

      expect(data).to.deep.equal([]);
    });
  }

  it('test getUrl ', () => {
    const client = azure(validOptions);
    assert.equal(
      client.getUrl('test', '1.0.0', 'test.js'),
      '/test/1.0.0/test.js'
    );
  });

  it('test put dir (failure)', async () => {
    const client = azure(validOptions);

    expect(
      await rejection(
        client.putDir(
          '/absolute-path-to-dir',
          'components\\componentName-error\\1.0.0'
        )
      )
    ).to.deep.equal({ msg: 'sorry' });
  });

  it('test put dir (stream failure throwing)', async () => {
    const client = azure(validOptions);

    expect(
      await rejection(
        client.putDir(
          '/absolute-path-to-dir',
          'components\\componentName-error-throw\\1.0.0'
        )
      )
    ).to.deep.equal({ msg: 'sorry' });
  });

  it('Put dir uploads the package.json the last file to use it as a verifier', async () => {
    const client = azure(validOptions);

    const results = await client.putDir(
      '/absolute-path-to-dir',
      'components\\componentName\\1.0.0'
    );

    assert.equal(
      results.pop().fileName,
      'components/componentName/1.0.0/package.json'
    );
  });

  it('test private putFileContent', async () => {
    const client = azure(validOptions);

    const result = await client.putFileContent('words', 'filename.js', true);

    assert.equal(result.container, 'privcon');
  });

  it('test private putFileContent stream', async () => {
    const client = azure(validOptions);

    const fileContent = 'words';
    const fileStream = new stream.Readable();
    fileStream.push(fileContent);
    fileStream.push(null);

    const result = await client.putFileContent(fileStream, 'filename.js', true);

    assert.equal(result.container, 'privcon');
    assert.equal(result.lengthWritten, fileContent.length);
    assert.equal(
      result.settings.blobHTTPHeaders.blobCacheControl,
      'public, max-age=31556926'
    );
  });

  it('test public putFileContent', async () => {
    const client = azure(validOptions);

    const result = await client.putFileContent('words', 'filename.gz', false);

    assert.equal(result.container, 'pubcon');
  });

  it('test public putFileContent stream', async () => {
    const client = azure(validOptions);

    const fileContent = 'words';
    const fileStream = new stream.Readable();
    fileStream.push(fileContent);
    fileStream.push(null);

    const result = await client.putFileContent(
      fileStream,
      'filename.js',
      false
    );

    assert.equal(result.container, 'pubcon');
    assert.equal(result.lengthWritten, fileContent.length);
  });

  it('put a js file ', async () => {
    const client = azure(validOptions);

    expect(await client.putFile('../path', 'hello.js', false)).to.deep.equal({
      container: 'pubcon',
      fileName: 'hello.js',
      lengthWritten: 16,
      settings: {
        blobHTTPHeaders: {
          blobCacheControl: 'public, max-age=31556926',
          blobContentType: 'application/javascript'
        }
      }
    });
  });

  it('put directory uses the supplied privacy classifier', async () => {
    const client = azure(validOptions);

    const mockResult = await client.putDir('.', '.', (filePath) =>
      filePath.endsWith('template.js')
    );
    const serverMock = mockResult.find((x) => x.fileName === './server.js');
    const envMock = mockResult.find((x) => x.fileName === './.env');
    const packageMock = mockResult.find((x) => x.fileName === './package.json');
    const templateMock = mockResult.find((x) => x.fileName === './template.js');

    assert.equal(serverMock.container, 'pubcon');
    assert.equal(envMock.container, 'pubcon');
    assert.equal(packageMock.container, 'pubcon');
    assert.equal(templateMock.container, 'privcon');
  });
});
