var Middleman = require('../');
var supertest = require('supertest');
var express = require('express');
var should = require('should');
var assign = require('object-assign');
var http = require('http');
var MemoryStore = require('../lib/cache/store');
var Promise = require('bluebird');

var PROXY_PORT = 4242;
var PORT = 5042;

var server = express();
server.get('/fast', function(req, res) {
  res.json({fast: true});
});
server.post('/post', function(req, res) {
  res.json({post: true});
});
server.all('/methods', function(req, res) {
  var method = req.method;
  var send = {};
  send[method] = true;
  res.json(send);
})
server.get('/redirect', function(req, res) {
  res.redirect('/fast');
});
server.listen(PROXY_PORT);

/**
 * All of the tests will use a new instance of suite
 * @prop instance Middleman Instnace
 * @prop app Express instance
 * @prop server http.Server instance
 * @prop agent Supertest instance
 */
function Suite() {
  this.instance = null;
  this.app = express();
  this.server = http.Server(this.app);
  this.agent = supertest.agent(this.app);
}

/**
 * Invokes `listen()` on the `server` property, with global PORT
 */
Suite.prototype.start = function() {
  this.server.listen(PORT);
  return this;
}

/**
 * Creates the Middleman instance
 */
Suite.prototype.createInstance = function(options) {
  this.instance = new Middleman(assign({
    target: 'http://localhost:'+PROXY_PORT
  }, options || {}));
  this.app.use(this.instance.handler());
  return this.instance;
};

/**
 * Invokes `close()` on the server property and sets all props to null
 */
Suite.prototype.close = function() {
  this.server.close();
  this.app = null;
  this.agent = null;
  this.instance = null;
  this.server = null;
};

// Helper, used a lot through the tests, sets `X-Cached` header to `true`
function xCached(req, res) {
  res.setHeader('X-Cached', 'true');
}

// sets `X-Proxied` header to `true`
function xProxied(req, res) {
  res.setHeader('X-Proxied', 'true');
}

// SUITE is assigned new instance of Suite before each test
var SUITE = null;

describe('Middleman', function() {

  beforeEach(function() {
    SUITE = new Suite();
    SUITE.start();
  });

  afterEach(function() {
    SUITE.close();
  });

  it('should emit "request" for all requests', function(done) {
    var instance = SUITE.createInstance();
    var agent = SUITE.agent;
    var count = 0;
    instance
      .on('request', function(req, res) {
        req.should.be.instanceof(http.IncomingMessage);
        res.should.be.instanceof(http.ServerResponse);
        count++;
      })
      .on('proxy request', xProxied)
      .on('cache request', xCached);

    agent.get('/fast')
      .expect('X-Proxied', 'true')
      .end(function(err, res) {
        if (err) return done(err);
        agent.get('/fast')
          .expect('X-Cached', 'true')
          .end(function(err, res) {
            if (err) return done(err);
            count.should.equal(2);
            done();
          });
      });
  });

  it('should emit "proxy request", when request is being proxies',
  function(done) {
    var instance = SUITE.createInstance();
    var agent = SUITE.agent;
    var emitted = false;
    instance.on('proxy request', function(req, res) {
      (req instanceof http.IncomingMessage).should.equal(true);
      (res instanceof http.ServerResponse).should.equal(true);
      emitted = true;
    });
    agent.get('/fast')
      .end(function(err, res) {
        if (err) return done(err);
        emitted.should.equal(true);
        done();
      });
  });


  it('should emit "cache request" when response for given request is cached',
  function(done) {
    var instance = SUITE.createInstance();
    var agent = SUITE.agent;
    var emitted = false;
    instance.on('cache request', function(req, res) {
      (req instanceof http.IncomingMessage).should.equal(true);
      (res instanceof http.ServerResponse).should.equal(true);
      //res.should.be.instanceOf(http.ServerResponse);
      emitted = true;
    });
    agent.get('/fast')
      .end(function(err, res) {
        if (err) return done(err);
        agent.get('/fast')
          .end(function(err, res) {
            if (err) return done(err);
            emitted.should.equal(true);
            done();
          });
      });
  });


  it('should cache responses', function(done) {
    var instance = SUITE.createInstance();
    var agent = SUITE.agent;
    instance.on('proxy request', xProxied)
      .on('cache request', xCached);
    agent.get('/fast')
      .expect('X-Proxied', 'true')
      .end(function(req, res) {
        agent.get('/fast')
          .expect('X-Cached', 'true')
          .end(done);
      });
  });

  it('should invalidate cached responses when maxAge is not Infinity',
  function(done) {
    var instance = SUITE.createInstance({
      maxAge: 10,
    });
    var agent = SUITE.agent;
    instance.on('proxy request', xProxied);
    agent.get('/fast')
      .expect('X-Proxied', 'true')
      .end(function(err, res) {
        if (err) return done(err);
        setTimeout(function() {
          agent.get('/fast')
            .expect('X-Proxied', 'true')
            .end(function(err, res) {
              if (err) return done(err);
              res.body.should.have.property('fast');
              done();
            });
        }, 10);
      });
  });

  it('should cache for all http methods by default', function(done) {
    var instance = SUITE.createInstance();
    var agent = SUITE.agent;
    var methods = [
      'get', 'post', 'put', 'head', 'del'
    ];
    instance
      .on('cache request', xCached)
      .on('proxy request', xProxied);
    var promises = methods.map(function(method) {
      return new Promise(function(resolve, reject) {
        agent[method]('/methods')
          .expect('X-Proxied', 'true')
          .end(function(err, res) {
            if (err) return reject(err);
            agent[method]('/methods')
              .expect('X-Cached', 'true')
              .end(function(err, res) {
                if (err) return reject(err);
                return resolve();
              });
          });
      });
    });

    Promise.all(promises)
      .then(function() {
        done();
      })
      .catch(done);
  });

  it('should only cache for methods in `cacheMethods`', function(done) {
    var instance = SUITE.createInstance({
      cacheMethods: ['GET']
    });
    var agent = SUITE.agent;
    instance.on('proxy request', xProxied);
    agent.post('/post')
      .end(function(err, res) {
        if (err) return done(err);
        agent.post('/post')
          .expect('X-Proxied', 'true')
          .end(function(err, res) {
            if (err) return done(err);
            res.body.should.have.property('post');
            done();
          });
      });
  });

  it('should follow redirects by default', function(done) {
    SUITE.createInstance();
    var agent = SUITE.agent;
    agent.get('/redirect')
      .expect(200, function(err, res) {
        if (err) return done(err);
        res.body.should.have.property('fast');
        res.body.fast.should.equal(true);
        done();
      });
  });

  it('should not follow redirects when `followRedirect` is false',
  function(done) {
    SUITE.createInstance({
      followRedirect: false
    });
    var agent = SUITE.agent;
    agent.get('/redirect')
      .expect(302, done);
  });

  it('should use "{method}:{path}" for cache keys by default', function() {
    var mockReq = {method: 'GET'};
    var url = {path: '/test'};
    var instance = SUITE.createInstance();
    instance._createKey(mockReq, url).should.equal('GET:/test');
  });

  it('should use custom createKey function', function() {
    var instance = SUITE.createInstance();
    instance.createKey(function(req, url) {
      return req.method + ':' + req.session.id + ':' + url.path;
    });
    var mockReq = {
      method: 'GET',
      session: {id: 42}
    };
    var url = {path: '/test'};
    instance._createKey(mockReq, url).should.equal('GET:42:/test');
  });

  it('should use custom createKey passed with options', function() {
    var instance = SUITE.createInstance({
      createKey: function(req, url) {
        return req.method + ':' + req.session.id + ':' + url.path;
      }
    });
    var mockReq = {
      method: 'GET',
      session: {id: 42}
    };
    var url = {path: '/test'};
    instance._createKey(mockReq, url).should.equal('GET:42:/test');
  });

  it('should throw an error when options.createKey it not omitted not a function',
  function() {
    try {
      Middleman({
        createKey: 'not a function'
      });
    } catch (e) {
      (e instanceof TypeError).should.equal(true);
      return true;
    }
    throw new Error('Failed');
  });

  it('should throw a TypError whe .cacheKey() recieved non-function type argument',
  function() {
    try {
      Middleman()
        .createKey(42);
    } catch (e) {
      (e instanceof Error).should.equal(true);
      return true;
    }
    throw new Error('Failed');
  });

  it('should not bypass the cache by default', function(done) {
    var instance = SUITE.createInstance();
    var agent = SUITE.agent;
    instance
      .on('proxy request', xProxied)
      .on('cache request', xCached);
    agent.get('/fast')
      .expect('X-Proxied', 'true')
      .end(function(err, res) {
        if (err) return done(err);
        agent.get('/fast')
          .expect('X-Cached', 'true')
          .end(done);
      });
  });

  it('should use custom bypass function, and pass http.IncomingMessage instance',
   function(done) {
    var instance = SUITE.createInstance();
    var agent = SUITE.agent;
    var called = false;
    instance
      .bypass(function(res) {
        (res instanceof http.IncomingMessage).should.equal(true);
        called = true;
        return true;
      })
      .on('proxy request', xProxied);

    agent.get('/fast')
      .expect('X-Proxied', 'true')
      .end(function(err, res) {
        if (err) return done(err);
        agent.get('/fast')
          .expect('X-Proxied', 'true')
          .end(function(err, res) {
            if (err) return done(err);
            called.should.equal(true);
            done();
          });
      });
  });

  it('should use bypass function passed with options', function(done) {
    var called = false;
    var agent = SUITE.agent;
    var instance = SUITE.createInstance({
      bypass: function(res) {
        (res instanceof http.IncomingMessage).should.equal(true);
        called = true;
        return true;
      }
    });
    instance.on('proxy request', xProxied);
    agent.get('/fast')
      .expect('X-Proxied', 'true')
      .end(function(err, res) {
        if (err) return done(err);
        agent.get('/fast')
          .expect('X-Proxied', 'true')
          .end(function(err, res) {
            if (err) return done(err);
            called.should.equal(true);
            done();
          });
      });
  });

  it('should throw a TypeError when options.bypass is not omitted and not a function',
  function() {
    try {
      Middleman({
        bypass: 42
      });
    } catch (e) {
      (e instanceof TypeError).should.equal(true);
      return true;
    }
    throw new Error('Failed');
  });

  it('should throw a TypeError when .bypass() recieves non-function type argument',
  function() {
    try {
      Middleman()
        .bypass(42);
    } catch (e) {
      (e instanceof Error).should.equal(true);
      return true;
    }
    throw new Error('failed');
  });

  it('Middleman() constructor should work without `new`', function() {
    var instance = Middleman();
    (instance instanceof Middleman).should.equal(true);
  });

  it('should accept Array or String of cacheMethods, or throw TypeError',
  function() {
    var instance = new Middleman({
      cacheMethods: 'GET'
    });
    instance.settings.cacheMethods.should.have.property('length');
    (instance.settings.cacheMethods[0] instanceof RegExp).should.equal(true);
    instance = new Middleman({
      cacheMethods: ['PUT']
    });
    instance.settings.cacheMethods.should.have.property('length');
    (instance.settings.cacheMethods[0] instanceof RegExp).should.equal(true);
    try {
      Middleman({
        cacheMethods: 42
      });
    } catch (e) {
      (e instanceof TypeError).should.equal(true);
      return true;
    }
    throw new Error('Failed');
  });

  it('should emit "error" when proxy target requests fail, and respond with 500',
  function(done) {
    var instance = SUITE.createInstance({
      target: 'http://localhost:3333' // this port should not be occupied
    });
    var agent = SUITE.agent;
    var emitted = false;
    instance.on('error', function(err) {
      (err instanceof Error).should.equal(true);
      emitted = true;
    });
    agent.get('/')
      .expect(500)
      .end(function(err, res) {
        if (err) return done(err);
        emitted.should.equal(true);
        done();
      });
  });

  it('listen() should return a http.Server instance', function() {
    var instance = new Middleman();
    var server = instance.listen(3333);
    (server instanceof http.Server).should.equal(true);
  });


  it('should validate resolved values from the cache and implement parsing '+
  'when json is resolved', function(done) {
    var jsonStore = new MemoryStore();
    var prevGet = jsonStore.get;
    jsonStore.get = function() {
      return prevGet.apply(this, arguments)
        .then(function(entry) {
          if (!entry) return entry;
          entry.value = JSON.stringify(entry.value);
          return entry;
        });
    };

    var instance = SUITE.createInstance({
      store: jsonStore
    });
    var agent = SUITE.agent;
    instance.on('cache request', xCached);
    instance.on('error', function(err) {
      done(err);
    });
    agent.get('/fast')
      .end(function(err, res) {
        if (err) return done(err);
        agent.get('/fast')
          .expect('X-Cached', 'true')
          .expect(200)
          .end(done);
      });
  });

  it('should validate resolved values from the cache and implement parsing '+
  'when CachedResponse-like objects are resolved', function(done) {
    var jsonStore = new MemoryStore();
    var prevGet = jsonStore.get;
    jsonStore.get = function() {
      return prevGet.apply(this, arguments)
        .then(function(entry) {
          if (!entry) return entry;
          entry.value = JSON.parse(JSON.stringify(entry.value));
          return entry;
        });
    };

    var instance = SUITE.createInstance({
      store: jsonStore
    });
    var agent = SUITE.agent;
    instance.on('cache request', xCached);
    instance.on('error', function(err) {
      done(err);
    });
    agent.get('/fast')
      .end(function(err, res) {
        if (err) return done(err);
        agent.get('/fast')
          .expect('X-Cached', 'true')
          .expect(200)
          .end(done);
      });
  });

  it('should emit "error" and respond with 500 when store fails to '+
  'resolve CachedResponse instance', function(done) {
    var badStore = new MemoryStore();
    var prevGet = badStore.get;
    badStore.get = function() {
      return prevGet.apply(this, arguments)
        .then(function(entry) {
          if (!entry) return entry;
          entry.value = 42;
          return entry;
        });
    };

    var instance = SUITE.createInstance({
      store: badStore
    });
    var agent = SUITE.agent;
    var emitted = false;
    instance.on('error', function(err) {
      (err instanceof Error).should.equal(true);
      emitted = true;
    });

    agent.get('/fast')
      .end(function(err, res) {
        if (err) return done(err);
        agent.get('/fast')
          .expect(500)
          .end(function(err, res) {
            if (err) return done(err)
            emitted.should.equal(true);
            done();
          });
      });
  });

  it('should emit "error" and respond with 500 when cache get fails', function(done) {
    var instance = SUITE.createInstance();
    instance.cache.get = function() {
      return Promise.reject(new Error('bad cache'));
    };
    var agent = SUITE.agent;
    var emitted = false;
    instance.on('error', function(err) {
      (err instanceof Error).should.equal(true);
      emitted = true;
    });
    agent.get('/fast')
      .expect(500)
      .end(function(err, res) {
        if (err) return done(err);
        emitted.should.equal(true);
        done();
      });
  });

  it('should emit "error" when cache set fails, and proceed with proxy', function(done) {
    var instance = SUITE.createInstance();
    instance.cache.set = function() {
      return Promise.reject(new Error('bad cache'));
    };
    var agent = SUITE.agent;
    var emitted = false;
    instance.on('error', function(err) {
      (err instanceof Error).should.equal(true);
      emitted = true;
    });

    agent.get('/fast')
      .expect(200)
      .end(done);
  });

  /**
   * httpError
   */

  it('should use options.httpError', function(done) {
    var instance = SUITE.createInstance({
      target: 'http://localhost:3333', // should not be in use
      httpError: function(req, res) {
        res.setHeader('X-Http-Error', 'true');
        res.statusCode = 500;
        res.end('Test');
      }
    });
    instance.on('error', function(err) {
      console.log(err);
    });
    var agent = SUITE.agent;
    agent.get('/')
      .expect('X-Http-Error', 'true')
      .expect(500)
      .end(done);
  });

  it('should use #.httpError(hanlder)', function(done) {
    var instance = SUITE.createInstance({
      target: 'http://localhost:3333'
    });
    instance.httpError(function(req, res) {
      res.setHeader('X-Http-Error', 'true');
      res.statusCode = 500;
      res.end('Test');
    });
    instance.on('error', function(err) {
      console.log(err);
    });
    var agent = SUITE.agent;
    agent.get('/')
      .expect('X-Http-Error', 'true')
      .expect(500)
      .end(done);
  });

  it('constructor, and #httpError(), should throw TE for httpError argument',
  function() {
    (function() {
      Middleman({
        httpError: false
      });
    }).should.throw(TypeError);
    (function() {
      var instance = SUITE.createInstance();
      intsance.httpError(42);
    }).should.throw(TypeError);
  });
});
