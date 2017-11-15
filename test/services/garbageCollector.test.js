'use strict';

const
  sinon = require('sinon'),
  should = require('should'),
  mockrequire = require('mock-require'),
  Bluebird = require('bluebird'),
  KuzzleMock = require('../mocks/kuzzle.mock');

// constants
const
  oneHour = 3600000,
  oneDay = oneHour * 24;

describe('Test: GarbageCollector service', () => {
  let
    GarbageCollector,
    gc,
    kuzzle,
    clock;
  const sandbox = sinon.sandbox.create();

  beforeEach(() => {
    kuzzle = new KuzzleMock();

    // since the GarbageCollector module is a singleton,
    // we need to re-require it before each test
    GarbageCollector = mockrequire.reRequire('../../lib/services/garbageCollector');

    // Timer methods must be overridden for all tests to prevent
    // a timer to stay on the event loop because of a test,
    // forcing mocha to run indefinitely
    clock = sandbox.useFakeTimers();

    gc = new GarbageCollector(kuzzle);
  });

  afterEach(() => {
    clock.restore();
    sandbox.restore();
  });

  describe('#init', () => {
    it('should run the garbage collector (delayed) and resolve a promise directly', () => {
      sandbox.stub(gc, 'run');

      return gc.init()
        .then(() => {
          clock.tick(oneDay);
          should(gc.run).be.calledOnce();
        });
    });
  });

  describe('#run', () => {
    it('if kuzzle is overloaded, it should delay the process in one hour', () => {
      kuzzle.pluginsManager.trigger.onCall(0).returns(Bluebird.reject(new Error('foobar')));
      kuzzle.funnel.overloaded = true;

      return gc.run()
        .then(() => {
          should(kuzzle.pluginsManager.trigger).not.be.called();

          kuzzle.funnel.overloaded = false;
          clock.tick(oneDay);

          should(kuzzle.pluginsManager.trigger).called();
        });
    });

    it('should clean all collections in all indexes', () => {
      kuzzle.services.list.storageEngine.deleteByQuery
        .onFirstCall().resolves({deleted: 3})
        .onSecondCall().resolves({deleted: 1})
        .onThirdCall().resolves({deleted: 5});

      kuzzle.indexCache.indexes = {
        foo: ['bar'],
        bar: ['baz'],
        baz: ['qux']
      };

      return gc.run()
        .then(response => {
          should(response).eql({deleted: 9});
        });
    });

    it('should skip collections if kuzzle becomes overloaded during the process', () => {
      kuzzle.services.list.storageEngine.deleteByQuery
        .onFirstCall().resolves({deleted: 3})
        .onSecondCall().callsFake(() => {
          kuzzle.funnel.overloaded = true;
          return Bluebird.resolve({deleted: 1});
        })
        .onThirdCall().resolves({deleted: 5});

      kuzzle.indexCache.indexes = {
        foo: ['bar'],
        bar: ['baz'],
        baz: ['qux']
      };

      return gc.run()
        .then(response => {
          should(response).eql({deleted: 4});
        });
    });

    it('should discard errors', () => {
      const error = new Error('mocked error');

      kuzzle.services.list.storageEngine.deleteByQuery
        .onFirstCall().rejects(error)
        .onSecondCall().resolves({deleted: 1})
        .onThirdCall().resolves({deleted: 5});

      kuzzle.indexCache.indexes = {
        foo: ['bar'],
        bar: ['baz'],
        baz: ['qux']
      };

      return gc.run()
        .then(response => {
          should(response).eql({deleted: 6});
        });
    });

    it('should trigger a pipe event before starting and after finishing', () => {
      return gc.run()
        .then(() => {
          should(kuzzle.pluginsManager.trigger).be.calledWith('gc:start');
          should(kuzzle.pluginsManager.trigger).be.calledWith('gc:end', {deleted: 0});
        });
    });

    it('should delay the next pass to one day by default', () => {
      kuzzle.config.services.garbageCollector.cleanInterval = undefined;

      return gc.run()
        .then(() => {
          kuzzle.pluginsManager.trigger.resetHistory();

          for (let i = 0; i < 23; i++) {
            clock.tick(oneHour);
            should(kuzzle.pluginsManager.trigger).not.be.called();
          }

          clock.tick(oneHour);
          should(kuzzle.pluginsManager.trigger).be.called();
        });
    });

    it('should delay next gc pass to user defined setting', () => {
      kuzzle.config.services.garbageCollector.cleanInterval = oneHour;

      return gc.run()
        .then(() => {
          kuzzle.pluginsManager.trigger.resetHistory();

          clock.tick(oneHour);
          should(kuzzle.pluginsManager.trigger).be.called();
        });
    });
  });
});
