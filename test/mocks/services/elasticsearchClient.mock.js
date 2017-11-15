const
  sinon = require('sinon'),
  Bluebird = require('bluebird');

class ESClientMock {
  constructor () {
    this.bulk = sinon.stub().returns(Bluebird.resolve());
    this.count = sinon.stub().returns(Bluebird.resolve());
    this.create = sinon.stub().returns(Bluebird.resolve());
    this.delete = sinon.stub().returns(Bluebird.resolve());
    this.deleteByQuery = sinon.stub().returns(Bluebird.resolve());
    this.exists = sinon.stub().returns(Bluebird.resolve());
    this.get = sinon.stub().returns(Bluebird.resolve());
    this.getScript = sinon.stub().returns(Bluebird.resolve());
    this.index = sinon.stub().returns(Bluebird.resolve());
    this.info = sinon.stub().returns(Bluebird.resolve({
      version: {
        number: '5.4.0'
      }
    }));
    this.mget = sinon.stub().returns(Bluebird.resolve());
    this.putScript = sinon.stub().returns(Bluebird.resolve());
    this.update = sinon.stub().returns(Bluebird.resolve());
    this.updateByQuery = sinon.stub().returns(Bluebird.resolve());
    this.search = sinon.stub().returns(Bluebird.resolve());
    this.scroll = sinon.stub().returns(Bluebird.resolve());

    this.cat = {
      indices: sinon.stub().returns(Bluebird.resolve())
    };

    this.cluster = {
      health: sinon.stub().returns(Bluebird.resolve()),
      stats: sinon.stub().returns(Bluebird.resolve())
    };

    this.indices = {
      create: sinon.stub().returns(Bluebird.resolve()),
      delete: sinon.stub().returns(Bluebird.resolve()),
      exists: sinon.stub().returns(Bluebird.resolve()),
      existsType: sinon.stub().returns(Bluebird.resolve()),
      getMapping: sinon.stub().returns(Bluebird.resolve()),
      putMapping: sinon.stub().returns(Bluebird.resolve()),
      refresh: sinon.stub().returns(Bluebird.resolve())
    };
  }
}

module.exports = ESClientMock;

