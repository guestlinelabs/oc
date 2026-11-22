const expect = require('chai').expect;
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const injectr = require('injectr');
const path = require('node:path');
const sinon = require('sinon');

const BoundedCache = require('../../dist/utils/bounded-cache').default;
const versionHandler = require('../../dist/registry/domain/version-handler');

describe('registry : domain : repository : component info cache', () => {
  const componentInfo = (name = 'hello-world', version = '1.0.0') => ({
    name,
    version,
    author: 'Jane Doe <jane@example.com>',
    dependencies: { lodash: '^4.0.0' },
    keywords: ['example'],
    oc: {
      container: false,
      date: 123,
      files: {
        template: {
          hashKey: 'template-key',
          src: 'template.js',
          type: 'oc-template-es6',
          version: '1.0.0'
        },
        static: ['public/example.txt']
      },
      packaged: true,
      parameters: {
        greeting: { default: 'hello', mandatory: false, type: 'string' }
      },
      plugins: ['example-plugin'],
      version: '0.50.61'
    }
  });

  const deferred = () => {
    let reject;
    let resolve;
    const promise = new Promise((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    return { promise, reject, resolve };
  };

  const waitForTurn = () => new Promise((resolve) => setImmediate(resolve));

  const createRepository = ({
    versions = { 'hello-world': ['1.0.0'] },
    storage = {},
    conf = {},
    fsMock,
    fspMock,
    validateNewVersion
  } = {}) => {
    const caches = [];
    const maps = [];
    class TrackedBoundedCache extends BoundedCache {
      constructor(maxEntries) {
        super(maxEntries);
        caches.push(this);
      }
    }
    class TrackedMap extends Map {
      constructor(...args) {
        super(...args);
        maps.push(this);
      }
    }

    const componentsCache = {
      close: sinon.stub(),
      get: sinon.stub().callsFake(() => ({ components: versions })),
      load: sinon
        .stub()
        .callsFake(() => Promise.resolve({ components: versions })),
      refresh: sinon
        .stub()
        .callsFake(() => Promise.resolve({ components: versions }))
    };
    const componentsDetails = {
      close: sinon.stub(),
      get: sinon.stub().resolves({ components: {} }),
      refresh: sinon.stub().resolves({ components: {} })
    };
    const cdn = {
      adapterType: 'test',
      getFile: sinon.stub().resolves(''),
      getJson: sinon.stub().callsFake((filePath) => {
        const [, name, version] = filePath.match(
          /^components\/(.+)\/([^/]+)\/package\.json$/
        );
        return Promise.resolve(componentInfo(name, version));
      }),
      putDir: sinon.stub().resolves(),
      ...storage
    };
    const injectedFs = fsMock || { ...fs };
    const injectedFsp = fspMock || {
      ...fsp,
      writeFile: sinon.stub().resolves()
    };
    const injectedVersionHandler = validateNewVersion
      ? { ...versionHandler, validateNewVersion }
      : versionHandler;
    const Repository = injectr(
      '../../dist/registry/domain/repository.js',
      {
        'node:fs': injectedFs,
        'node:fs/promises': injectedFsp,
        '../../utils/bounded-cache': TrackedBoundedCache,
        './components-cache': () => componentsCache,
        './components-details': () => componentsDetails,
        './storage-adapter': () => cdn,
        './version-handler': injectedVersionHandler
      },
      {
        __dirname: path.resolve(__dirname, '../../dist/registry/domain'),
        Map: TrackedMap
      }
    ).default;
    const configuration = {
      baseUrl: 'http://registry.test/',
      hotReloading: false,
      local: false,
      publishValidation: () => true,
      storage: {
        adapter: () => cdn,
        options: { componentsDir: 'components', path: '//cdn.test/' }
      },
      templates: [],
      ...conf
    };
    const repository = Repository(configuration);

    return {
      cache: caches[0],
      componentsCache,
      componentsDetails,
      maps,
      repository,
      storage: cdn,
      versions
    };
  };

  it('caches repeated exact and range requests after resolving an exact version', async () => {
    const { repository, storage } = createRepository();

    const exact = await repository.getComponent('hello-world', '1.0.0');
    const range = await repository.getComponent('hello-world', '^1.0.0');
    const latest = await repository.getComponent('hello-world');

    expect(storage.getJson.calledOnce).to.be.true;
    expect(exact.version).to.equal('1.0.0');
    expect(range.version).to.equal('1.0.0');
    expect(latest.version).to.equal('1.0.0');
    expect(exact).not.to.equal(range);
  });

  it('coalesces concurrent loads and retries after a rejected load', async () => {
    const firstLoad = deferred();
    const storage = {
      getJson: sinon
        .stub()
        .onFirstCall()
        .returns(firstLoad.promise)
        .onSecondCall()
        .rejects(new Error('storage unavailable'))
        .onThirdCall()
        .resolves(componentInfo())
    };
    const { repository } = createRepository({ storage });

    const first = repository.getComponent('hello-world', '1.0.0');
    const second = repository.getComponent('hello-world', '1.0.0');
    await waitForTurn();
    expect(storage.getJson.calledOnce).to.be.true;

    firstLoad.reject(new Error('cold load failed'));
    const coldResults = await Promise.allSettled([first, second]);
    expect(coldResults.every((result) => result.status === 'rejected')).to.be
      .true;

    const retry = await Promise.allSettled([
      repository.getComponent('hello-world', '1.0.0')
    ]);
    expect(retry[0].status).to.equal('rejected');
    const recovered = await repository.getComponent('hello-world', '1.0.0');
    expect(recovered.name).to.equal('hello-world');
    expect(storage.getJson.callCount).to.equal(3);
  });

  it('recursively freezes cached state while returning a fresh top-level result', async () => {
    const info = componentInfo();
    const { repository, storage, versions } = createRepository({
      storage: { getJson: sinon.stub().resolves(info) }
    });

    const first = await repository.getComponent('hello-world', '1.0.0');
    expect(Object.isFrozen(first)).to.be.false;
    expect(Object.isFrozen(first.oc)).to.be.true;
    expect(Object.isFrozen(first.oc.files)).to.be.true;
    expect(Object.isFrozen(first.oc.parameters.greeting)).to.be.true;
    expect(Object.isFrozen(first.dependencies)).to.be.true;
    expect(Object.isFrozen(first.keywords)).to.be.true;
    expect(Object.isFrozen(first.oc.files.static)).to.be.true;

    first.name = 'changed-for-this-request';
    first.allVersions.push('9.0.0');
    expect(() => first.keywords.push('changed')).to.throw(TypeError);
    expect(() => first.oc.files.static.push('changed')).to.throw(TypeError);
    first.dependencies.lodash = 'changed';
    first.oc.parameters.greeting.default = 'changed';

    versions['hello-world'].push('1.1.0');
    const second = await repository.getComponent('hello-world', '1.0.0');
    expect(second.name).to.equal('hello-world');
    expect(second.dependencies.lodash).to.equal('^4.0.0');
    expect(second.oc.parameters.greeting.default).to.equal('hello');
    expect(second.keywords).to.eql(['example']);
    expect(second.oc.files.static).to.eql(['public/example.txt']);
    expect(second.allVersions).to.eql(['1.0.0', '1.1.0']);
    expect(storage.getJson.calledOnce).to.be.true;
  });

  it('resolves the latest version from the cached version list, not the per-request copy', async () => {
    const versions = { 'hello-world': ['1.0.0', '2.0.0', '3.0.0-beta.1'] };
    const { repository } = createRepository({ versions });

    const component = await repository.getComponent('hello-world', '1.0.0');
    component.allVersions.push('9.0.0');

    expect(repository.getLatestVersion(component)).to.equal('2.0.0');

    versions['hello-world'] = ['1.0.0', '2.0.0', '2.1.0'];
    const refreshed = await repository.getComponent('hello-world', '1.0.0');
    expect(repository.getLatestVersion(refreshed)).to.equal('2.1.0');
  });

  it('bounds component info at 1000 entries and evicts the true LRU key', async () => {
    const versions = {};
    for (let index = 0; index <= 1000; index++) {
      versions[`component-${index}`] = ['1.0.0'];
    }
    const { cache, repository, storage } = createRepository({ versions });

    for (let index = 0; index < 1000; index++) {
      await repository.getComponent(`component-${index}`, '1.0.0');
    }
    await repository.getComponent('component-0', '1.0.0');
    await repository.getComponent('component-1000', '1.0.0');

    expect(cache.size).to.equal(1000);
    await repository.getComponent('component-0', '1.0.0');
    expect(storage.getJson.callCount).to.equal(1001);
    await repository.getComponent('component-1', '1.0.0');
    expect(storage.getJson.callCount).to.equal(1002);
  });

  it('does not share component info between repository instances', async () => {
    const first = createRepository({
      storage: {
        getJson: sinon.stub().resolves({ ...componentInfo(), marker: 'first' })
      }
    });
    const second = createRepository({
      storage: {
        getJson: sinon.stub().resolves({ ...componentInfo(), marker: 'second' })
      }
    });

    expect(
      (await first.repository.getComponent('hello-world')).marker
    ).to.equal('first');
    expect(
      (await second.repository.getComponent('hello-world')).marker
    ).to.equal('second');
    expect(first.storage.getJson.calledOnce).to.be.true;
    expect(second.storage.getJson.calledOnce).to.be.true;
  });

  it('caches local source versions and packaged component info only when hot reloading is disabled', async () => {
    let sourceVersion = '1.0.0';
    let packagedMarker = 'first';
    const sourceReads = sinon
      .stub()
      .callsFake(() =>
        Promise.resolve(JSON.stringify({ version: sourceVersion }))
      );
    const packagedReads = sinon.stub().callsFake((filePath) => {
      if (filePath.endsWith('/_package/package.json')) {
        return JSON.stringify({
          ...componentInfo('hello-world', sourceVersion),
          packagedMarker
        });
      }
      return fs.readFileSync(filePath, 'utf8');
    });
    const fsMock = {
      readFileSync: packagedReads,
      readdirSync: fs.readdirSync,
      lstatSync: fs.lstatSync
    };
    const fspMock = {
      readFile: sourceReads,
      writeFile: sinon.stub().resolves()
    };
    const cold = createRepository({
      conf: {
        components: ['hello-world'],
        hotReloading: false,
        local: true,
        path: '/components'
      },
      fsMock,
      fspMock
    });

    const coldResults = await Promise.all([
      cold.repository.getComponent('hello-world'),
      cold.repository.getComponent('hello-world')
    ]);
    await cold.repository.getComponent('hello-world');
    expect(coldResults[0].packagedMarker).to.equal('first');
    expect(sourceReads.callCount).to.equal(1);
    expect(
      packagedReads.args.filter(([filePath]) =>
        filePath.endsWith('/_package/package.json')
      )
    ).to.have.length(1);

    sourceReads.resetHistory();
    packagedReads.resetHistory();
    const hot = createRepository({
      conf: {
        components: ['hello-world'],
        hotReloading: true,
        local: true,
        path: '/components'
      },
      fsMock,
      fspMock
    });
    const hotFirst = await hot.repository.getComponent('hello-world');
    sourceVersion = '1.0.1';
    packagedMarker = 'second';
    const hotSecond = await hot.repository.getComponent('hello-world');

    expect(hotFirst.version).to.equal('1.0.0');
    expect(hotSecond.version).to.equal('1.0.1');
    expect(hotSecond.packagedMarker).to.equal('second');
    expect(sourceReads.callCount).to.equal(2);
    expect(
      packagedReads.args.filter(([filePath]) =>
        filePath.endsWith('/_package/package.json')
      )
    ).to.have.length(2);
  });

  it('prevents invalidated legacy in-flight loads from repopulating the cache', async () => {
    const oldLoad = deferred();
    const firstUpload = deferred();
    const secondUpload = deferred();
    let storedComponentInfo = componentInfo('hello-world', '1.0.0');
    storedComponentInfo.marker = 'old';
    const storage = {
      getJson: sinon
        .stub()
        .onFirstCall()
        .returns(oldLoad.promise)
        .callsFake(() => Promise.resolve(storedComponentInfo)),
      putDir: sinon
        .stub()
        .onFirstCall()
        .returns(firstUpload.promise)
        .onSecondCall()
        .returns(secondUpload.promise)
    };
    const { repository } = createRepository({
      storage,
      validateNewVersion: () => true
    });
    const publish = (marker) =>
      repository.publishComponent({
        componentName: 'hello-world',
        componentVersion: '1.0.0',
        pkgDetails: {
          outputFolder: `/tmp/${marker}`,
          packageJson: {
            ...componentInfo(),
            author: 'Jane',
            marker,
            repository: 'https://example.test/repository'
          }
        }
      });

    const staleRead = repository.getComponent('hello-world', '1.0.0');
    await waitForTurn();
    const firstPublish = publish('first');
    const secondPublish = publish('second');
    await waitForTurn();

    storedComponentInfo = { ...componentInfo(), marker: 'first' };
    firstUpload.resolve();
    await firstPublish;
    storedComponentInfo = { ...componentInfo(), marker: 'second' };
    secondUpload.resolve();
    await secondPublish;
    oldLoad.resolve({ ...componentInfo(), marker: 'old' });
    expect((await staleRead).marker).to.equal('old');

    const current = await repository.getComponent('hello-world', '1.0.0');
    const cached = await repository.getComponent('hello-world', '1.0.0');
    expect(current.marker).to.equal('second');
    expect(cached.marker).to.equal('second');
    expect(storage.getJson.callCount).to.equal(2);
  });

  it('keeps older in-flight cleanup from deleting a newer load', async () => {
    const oldLoad = deferred();
    const newLoad = deferred();
    const upload = deferred();
    const storage = {
      getJson: sinon
        .stub()
        .onFirstCall()
        .returns(oldLoad.promise)
        .onSecondCall()
        .returns(newLoad.promise),
      putDir: sinon.stub().returns(upload.promise)
    };
    const { repository } = createRepository({
      storage,
      validateNewVersion: () => true
    });
    const oldRead = repository.getComponent('hello-world', '1.0.0');
    await waitForTurn();
    const publication = repository.publishComponent({
      componentName: 'hello-world',
      componentVersion: '1.0.0',
      pkgDetails: {
        outputFolder: '/tmp/current',
        packageJson: {
          ...componentInfo(),
          author: 'Jane',
          repository: 'https://example.test/repository'
        }
      }
    });
    await waitForTurn();
    upload.resolve();
    await publication;

    const newRead = repository.getComponent('hello-world', '1.0.0');
    await waitForTurn();
    oldLoad.resolve({ ...componentInfo(), marker: 'old' });
    await oldRead;
    const joinedNewRead = repository.getComponent('hello-world', '1.0.0');
    await waitForTurn();
    expect(storage.getJson.callCount).to.equal(2);

    newLoad.resolve({ ...componentInfo(), marker: 'new' });
    expect((await newRead).marker).to.equal('new');
    expect((await joinedNewRead).marker).to.equal('new');
  });

  it('reconciles genuinely new concurrent legacy publishes before later reads', async () => {
    const versions = { 'hello-world': [] };
    const firstUpload = deferred();
    const secondUpload = deferred();
    const firstRefresh = deferred();
    const secondRefresh = deferred();
    const storage = {
      getJson: sinon.stub().resolves({ ...componentInfo(), marker: 'second' }),
      putDir: sinon
        .stub()
        .onFirstCall()
        .returns(firstUpload.promise)
        .onSecondCall()
        .returns(secondUpload.promise)
    };
    const { componentsCache, componentsDetails, repository } = createRepository(
      {
        storage,
        versions
      }
    );
    componentsCache.refresh
      .onFirstCall()
      .returns(firstRefresh.promise)
      .onSecondCall()
      .returns(secondRefresh.promise);
    const publish = (marker) =>
      repository.publishComponent({
        componentName: 'hello-world',
        componentVersion: '1.0.0',
        pkgDetails: {
          outputFolder: `/tmp/${marker}`,
          packageJson: {
            ...componentInfo(),
            author: 'Jane',
            marker,
            repository: 'https://example.test/repository'
          }
        }
      });

    const publications = [publish('first'), publish('second')];
    await waitForTurn();
    expect(storage.putDir.calledTwice).to.be.true;
    firstUpload.resolve();
    secondUpload.resolve();
    await Promise.all(publications);
    expect(componentsCache.refresh.calledTwice).to.be.true;

    versions['hello-world'] = ['1.0.0'];
    const refreshed = { components: versions };
    firstRefresh.resolve(refreshed);
    secondRefresh.resolve(refreshed);
    await waitForTurn();
    await waitForTurn();
    expect(componentsDetails.refresh.calledTwice).to.be.true;

    const component = await repository.getComponent('hello-world', '1.0.0');
    expect(component.marker).to.equal('second');
    expect(component.allVersions).to.eql(['1.0.0']);
  });

  it('attaches refreshed versions to cached component info after publish', async () => {
    const versions = { 'hello-world': ['1.0.0'] };
    const refresh = deferred();
    const storage = {
      getJson: sinon.stub().callsFake((filePath) => {
        const version = filePath.includes('/2.0.0/') ? '2.0.0' : '1.0.0';
        return Promise.resolve(componentInfo('hello-world', version));
      }),
      putDir: sinon.stub().resolves()
    };
    const { componentsCache, componentsDetails, repository } = createRepository(
      {
        storage,
        versions
      }
    );
    componentsCache.refresh.returns(refresh.promise);

    await repository.getComponent('hello-world', '1.0.0');
    await repository.publishComponent({
      componentName: 'hello-world',
      componentVersion: '2.0.0',
      pkgDetails: {
        outputFolder: '/tmp/hello-world-2',
        packageJson: {
          ...componentInfo('hello-world', '2.0.0'),
          author: 'Jane',
          repository: 'https://example.test/repository'
        }
      }
    });

    versions['hello-world'] = ['1.0.0', '2.0.0'];
    refresh.resolve({ components: versions });
    await waitForTurn();
    await waitForTurn();
    expect(componentsDetails.refresh.calledOnce).to.be.true;

    const cachedBase = await repository.getComponent('hello-world', '1.0.0');
    expect(cachedBase.version).to.equal('1.0.0');
    expect(cachedBase.allVersions).to.eql(['1.0.0', '2.0.0']);
    expect(storage.getJson.calledOnce).to.be.true;
  });

  it('keeps invalidation state bounded to live loads across 1001 publishes', async () => {
    const versions = {};
    for (let index = 0; index <= 1000; index++) {
      versions[`component-${index}`] = [];
    }
    const { cache, maps, repository } = createRepository({ versions });

    await Promise.all(
      Array.from({ length: 1001 }, (_, index) =>
        repository.publishComponent({
          componentName: `component-${index}`,
          componentVersion: '1.0.0',
          pkgDetails: {
            outputFolder: `/tmp/component-${index}`,
            packageJson: {
              ...componentInfo(`component-${index}`),
              author: 'Jane',
              repository: 'https://example.test/repository'
            }
          }
        })
      )
    );
    await waitForTurn();

    expect(cache.size).to.equal(0);
    expect(maps).to.have.length(3);
    expect(maps.every((map) => map.size === 0)).to.be.true;
  });
});
