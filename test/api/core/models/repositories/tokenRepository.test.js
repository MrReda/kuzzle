var
  jwt = require('jsonwebtoken'),
  q = require('q'),
  should = require('should'),
  rewire = require('rewire'),
  params = require('rc')('kuzzle'),
  kuzzle = {
    repositories: {},
    services: {
      list: {}
    },
    config: require.main.require('lib/config')(params)
  },
  InternalError = require.main.require('lib/api/core/errors/internalError'),
  UnauthorizedError = require.main.require('lib/api/core/errors/unauthorizedError'),
  Profile = require.main.require('lib/api/core/models/security/profile'),
  Token = require.main.require('lib/api/core/models/security/token'),
  User = require.main.require('lib/api/core/models/security/user'),
  Role = require.main.require('lib/api/core/models/security/role'),
  Repository = require.main.require('lib/api/core/models/repositories/repository'),
  TokenRepository = require.main.require('lib/api/core/models/repositories/tokenRepository')(kuzzle),
  TokenRepositoryRewired = rewire('../../../../../lib/api/core/models/repositories/tokenRepository'),
  tokenRepository;

beforeEach(function (done) {
  var
    mockCacheEngine,
    mockProfileRepository,
    mockUserRepository,
    tokenInCache,
    forwardedResult;

  mockCacheEngine = {
    get: function (key) {
      if (key === tokenRepository.index + '/' + tokenRepository.collection + '/tokenInCache') {
        return Promise.resolve(JSON.stringify(tokenInCache));
      }
      return Promise.resolve(null);
    },
    volatileSet: function (key, value, ttl) { forwardedResult = {key: key, value: JSON.parse(value), ttl: ttl }; },
    expire: function (key, ttl) { return Promise.resolve(forwardedResult = {key: key, ttl: ttl}); }
  };

  mockProfileRepository = {
    loadProfile: function (profileKey) {
      var profile = new Profile();
      profile._id = profileKey;
      return Promise.resolve(profile);
    }
  };

  mockUserRepository = {
    load: function (username) {
      var user = new User();
      user._id = username;
      user.profile = 'anonymous';

      return Promise.resolve(user);
    },
    anonymous: function () {
      var
        role = new Role(),
        user = new User();

      role.indexes = {
        '*': {
          collections: {
            '*': {
              controllers: {
                '*': {
                  actions: {
                    '*': true
                  }
                }
              }
            }
          }
        }
      };

      user._id = -1;
      user.profile = new Profile();
      user.profile.roles = [role];

      return Promise.resolve(user);
    },
    admin: function () {
      var
        role = new Role(),
        user = new User();

      role.indexes = {
        '*': {
          collections: {
            '*': {
              controllers: {
                '*': {
                  actions: {
                    '*': true
                  }
                }
              }
            }
          }
        }
      };

      user._id = 'admin';
      user.profile = new Profile();
      user.profile.roles = [role];

      return Promise.resolve(user);
    }
  };

  tokenInCache = {
    _id: 'tokenInCache',
    user: 'admin'
  };

  tokenRepository = new TokenRepository();
  tokenRepository.cacheEngine = mockCacheEngine;

  kuzzle.repositories = {};
  kuzzle.repositories.profile = mockProfileRepository;
  kuzzle.repositories.user = mockUserRepository;

  done();
});

describe('Test: repositories/tokenRepository', function () {
  describe('#constructor', () => {
    it('should take into account the options given', () => {
      var repository = new TokenRepository({ ttl: 1000 });

      should(repository.ttl).be.exactly(1000);
    });
  });

  describe('#anonymous', function () {
    it('should return a valid anonymous token', function (done) {
      tokenRepository.anonymous()
        .then(function (token) {
          assertIsAnonymous(token);
          done();
        })
        .catch(function (error) {
          done(error);
        });
    });
  });

  describe('#admin', function () {
    it('should return the admin token', function (done) {
      tokenRepository.admin()
        .then(function (token) {
          assertIsAdmin(token);
          done();
        })
        .catch(function (error) {
          done(error);
        });
    });
  });

  describe('#hydrate', function () {
    it('should return the given token if the given data is not a valid object', function (done) {
      var
        t = new Token();

      q.all([
        tokenRepository.hydrate(t, null),
        tokenRepository.hydrate(t),
        tokenRepository.hydrate(t, 'a scalar')
      ])
        .then(function (results) {
          results.forEach(function (token) {
            should(token).be.exactly(t);
          });
          done();
        });
    });

    it('should return the anonymous token if no _id is set', done => {
      var token = new Token();

      tokenRepository.hydrate(token, {})
        .then(result => {
          assertIsAnonymous(result);
          done();
        })
        .catch(err => { done(err); });
    });

    it('should reject the promise if an error is thrown by the prototype hydrate call', () => {
      var
        protoHydrate = Repository.prototype.hydrate,
        token = new Token();

      Repository.prototype.hydrate = () => {
        return Promise.reject(new InternalError('Error'));
      };

      return should(tokenRepository.hydrate(token, {})
        .catch(err => {
          Repository.prototype.hydrate = protoHydrate;

          return Promise.reject(err);
        })).be.rejectedWith(InternalError);
    });
  });

  describe('#verifyToken', function () {
    it('should reject the promise if the jwt is invalid', function () {
      return should(tokenRepository.verifyToken('invalidToken')).be.rejectedWith(UnauthorizedError, {
        details: {
          subCode: UnauthorizedError.prototype.subCodes.JsonWebTokenError,
          description: 'jwt malformed'
        }
      });
    });

    it('should reject the token if the uuid is not known', function () {
      var
        token;

      token = jwt.sign({_id: -99999}, params.jsonWebToken.secret, {algorithm: params.jsonWebToken.algorithm});

      should(tokenRepository.verifyToken(token)).be.rejectedWith(UnauthorizedError, {
        message: 'Token invalid'
      });
    });

    it('shoud reject the promise if the jwt is expired', function (done) {
      var token = jwt.sign({_id: -1}, params.jsonWebToken.secret, {algorithm: params.jsonWebToken.algorithm, expiresIn: 1});

      setTimeout(function () {
        should(tokenRepository.verifyToken(token)).be.rejectedWith(UnauthorizedError, {
          details: {
            subCode: UnauthorizedError.prototype.subCodes.TokenExpired
          }
        });
        done();
      }, 101);
    });

    it('should reject the promise if an error occurred while fetching the user from the cache', () => {
      var token = jwt.sign({_id: 'auser'}, params.jsonWebToken.secret, {algorithm: params.jsonWebToken.algorithm});

      tokenRepository.loadFromCache = () => {
        return Promise.reject(new InternalError('Error'));
      };

      return should(tokenRepository.verifyToken(token)
        .catch(err => {
          delete tokenRepository.loadFromCache;

          return Promise.reject(err);
        })).be.rejectedWith(InternalError);
    });


    it('should reject the promise if an untrapped error is raised', () => {
      var token = jwt.sign({_id: 'admin'}, params.jsonWebToken.secret, {algorithm: params.jsonWebToken.algorithm});

      tokenRepository.admin = () => {
        throw new InternalError('Uncaught error');
      };
      should(tokenRepository.verifyToken(token)
        .catch(err => {
          delete tokenRepository.admin;

          return Promise.reject(err);
        })).be.rejectedWith(InternalError, {details: {message: 'Uncaught error'}});
    });

    it('should load the admin user if the user id is "admin"', function (done) {
      var token = jwt.sign({_id: 'admin'}, params.jsonWebToken.secret, {algorithm: params.jsonWebToken.algorithm});

      tokenRepository.verifyToken(token)
        .then(function (userToken) {
          assertIsAdmin(userToken);

          done();
        })
        .catch(function (error) {
          done(error);
        });
    });

    it('should load the anonymous user if the token is null', function (done) {

      tokenRepository.verifyToken(null)
        .then(function (userToken) {
          assertIsAnonymous(userToken);

          done();
        })
        .catch(function (error) {
          done(error);
        });
    });
  });

  describe('#generateToken', function () {
    it('should reject the promise if the username is null', function () {
      return should(tokenRepository.generateToken(null)).be.rejectedWith(InternalError);
    });

    it('should reject the promise if an error occurred while generating the token', () => {

      kuzzle.config.jsonWebToken.algorithm = 'fake JWT ALgorithm';

      return should(tokenRepository.generateToken(new User())
        .catch(err => {
          kuzzle.config.jsonWebToken.algorithm = params.jsonWebToken.algorithm;

          return Promise.reject(err);
        })).be.rejectedWith(InternalError);
    });

    it('should resolve to the good jwt token for a given username', function (done) {
      var
        user = new User(),
        checkToken = jwt.sign({_id: 'userInCache'}, params.jsonWebToken.secret, {
          algorithm: params.jsonWebToken.algorithm,
          expiresIn: params.jsonWebToken.expiresIn
        });

      user._id = 'userInCache';

      tokenRepository.generateToken(user)
        .then(function (token) {
          should(token).be.an.instanceOf(Token);
          should(token._id).be.exactly(checkToken);

          done();
        })
        .catch(function (error) {
          done(error);
        });
    });

    it('should reject the promise if hydrating fails', function (done) {
      var
        user = new User();

      tokenRepository.hydrate = function() {
        return q.reject();
      };

      user._id = 'userInCache';

      tokenRepository.generateToken(user)
        .catch(function (error) {
          should(error).be.an.instanceOf(InternalError);
          should(error.message).be.exactly('Error while saving token');
          done();
        });
    });

    it('should return an internal error if an error append when generating token', (done) => {
      var
        user = new User();

      user._id = 'userInCache';

      tokenRepository.generateToken(user, {expiresIn: 'toto'})
        .catch(function (error) {
          should(error).be.an.instanceOf(InternalError);
          should(error.message).be.exactly('Error while generating token');
          done();
        });
    });

  });

  describe('#serializeToCache', function () {
    it('should return a valid plain object', function (done) {
      tokenRepository.anonymous()
        .then(function (token) {
          var result = tokenRepository.serializeToCache(token);

          should(result).not.be.an.instanceOf(Token);
          should(result).be.an.Object();
          should(result._id).be.exactly(undefined);
          should(result.user).be.exactly(-1);

          done();
        })
        .catch(function (error) {
          done(error);
        });
    });
  });

  describe('#expire', () => {
    it('should be able to expires a token', (done) => {
      var
        user = new User();

      user._id = 'userInCache';

      tokenRepository.generateToken(user)
        .then(function (token) {
          return tokenRepository.expire(token);
        })
        .then(() => {
          done();
        })
        .catch(function (error) {
          done(error);
        });
    });

    it('should return an internal error if an error append when expires a token', (done) => {
      var
        user = new User();

      Repository.prototype.expireFromCache = function () {
        return q.reject();
      };

      user._id = 'userInCache';

      tokenRepository.generateToken(user)
        .then(function (token) {
          return tokenRepository.expire(token);
        })
        .catch(function (error) {
          should(error).be.an.instanceOf(InternalError);
          should(error.message).be.exactly('Error expiring token');
          done();
        });
    });
  });

});

function assertIsAnonymous (token) {
  should(token._id).be.undefined();
  should(token.user._id).be.exactly(-1);
  should(token.user).be.an.instanceOf(User);
}

function assertIsAdmin (token) {
  should(token._id).be.undefined();
  should(token.user._id).be.exactly('admin');
  should(token.user).be.an.instanceOf(User);
}
