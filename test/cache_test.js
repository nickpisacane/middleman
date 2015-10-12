var Cache = require('../lib/cache');
var KeyEntry = require('../lib/cache/entry').KeyEntry;
var CacheEntry = require('../lib/cache/entry').CacheEntry;
var MemoryStore = require('../lib/cache/store');
var sizeof = require('object-sizeof');
var Promise = require('bluebird');
var should = require('should');

function makeArr(s, f) {
  var ret = [];
  if (typeof s === 'number' && typeof f === 'undefined') {
    f = s;
    s = 0;
  }
  for (; s <= f; s++) ret.push(s);
  return ret;
}

describe('CacheLib', function() {
  describe('CacheEntry', function() {
    it('should return a values size', function() {
      var value = 'test';
      var size = sizeof(value);
      var ce = new CacheEntry('test', value);
      ce.size().should.equal(size);
    });

    it('should prefer to call a values `size()` method if available', function() {
      var value = {
        test: 'test',
        size: function(){return 42}
      };
      var ce = new CacheEntry('test', value);
      ce.size().should.equal(42);
    });
  });

  describe('MemoryStore', function() {
    var store = new MemoryStore();
    var isPromise = function(p) {return (p instanceof Promise)};
    it('should return a promise for `get(), set(), del()`', function() {
      ['get', 'set', 'del'].forEach(function(method) {
        isPromise(store[method]()).should.equal(true);
      });
    });

    it('should resolve `null` for keys that do not exist', function(done) {
      store.get('no key').then(function(val) {
        should(val).equal(null);
        done();
      }).catch(done);
    })

    it('should set and get an item', function(done) {
      store.set('test', 42).then(function() {
        return store.get('test')
      }).then(function(val) {
        val.should.equal(42);
        done();
      }).catch(done);
    });

    it('should delete an item', function(done) {
      store.del('test').then(function(done) {
        return store.get('test');
      }).then(function(val) {
        should(val).equal(null);
        done();
      }).catch(done);
    });
  });

  describe('Cache', function() {
    it('should resolve false for invalid entries', function(done) {
      var cache = new Cache({
        maxAge: 10
      });

      cache.set('test', 42).then(function() {
        setTimeout(function() {
          cache.get('test').then(function(val) {
            should(val).equal(false);
            done();
          }).catch(done);
        }, 10);
      }).catch(done);
    });

    it('should resolve null for missing entries', function(done) {
      var cache = new Cache();
      cache.get('test').then(function(val) {
        should(val).equal(null);
        done();
      }).catch(done);
    });

    it('should manage cache size (when using LRU)', function(done) {
      var cache = new Cache({
        maxSize: '1KB'
      });

      var oneKb = function() {
        return {
          buf: new Buffer(1024),
          size: function() {return this.buf.length}
        };
      };
      cache.set('one', oneKb()).then(function() {
        return cache.set('two', oneKb())
      }).then(function() {
        return cache.get('one');
      }).then(function(one) {
        should(one).equal(null);
        return cache.get('two');
      }).then(function(two) {
        should(two).not.equal(null);
        done();
      }).catch(done);
    });

    it('should clear() (NOT LRU)', function(done) {
      var cache = new Cache({
        lru: false
      });
      var keys = [];
      Promise.all(makeArr(10).map(function(el) {
        var k = el.toString();
        keys.push(k);
        return cache.set(k, el);
      })).then(function() {
        return cache.clear();
      }).then(function() {
        return Promise.all(keys.map(function(k) {
          return cache.get(k).then(function(val) {
            if (val !== null) {
              return Promise.reject(new Error('NOPE'));
            }
            return Promise.resolve();
          });
        }));
      }).then(function() {
        done();
      }).catch(done);
    });

    it('should clear() (LRU)', function(done) {
      var cache = new Cache();
      var keys = [];
      cache.on('delete', function() {
        done(new Error('Cache should not have fired `delete` event'));
      });
      Promise.all(makeArr(10).map(function(el) {
        var k = el.toString();
        keys.push(k);
        return cache.set(k, el);
      })).then(function() {
        return cache.clear();
      }).then(function() {
        return Promise.all(keys.map(function(k) {
          return cache.get(k).then(function(val) {
            if (val !== null) {
              return Promise.reject(new Error('NOPE'));
            }
            return Promise.resolve();
          });
        }));
      }).then(function() {
        done();
      }).catch(done);
    });

    it('should get(), set(), del() entries (NOT LRU)', function(done) {
      var cache = new Cache({lru: false});
      cache.set('test', 42).then(function() {
        return cache.get('test');
      }).then(function(entry) {
        entry.value.should.equal(42);
        return cache.del('test');
      }).then(function() {
        return cache.get('test');
      }).then(function(val) {
        should(val).equal(null);
        done();
      }).catch(done);
    });

    it('should get(), set(), del() entries (LRU)', function(done) {
      var cache = new Cache();
      cache.on('delete', function() {
        done(new Error('Cache should not have fired `delete` event'));
      });
      cache.set('test', 42).then(function() {
        return cache.get('test');
      }).then(function(entry) {
        entry.value.should.equal(42);
        return cache.del('test');
      }).then(function() {
        return cache.get('test');
      }).then(function(val) {
        should(val).equal(null);
        done();
      }).catch(done);
    });

    it('should resolve an error when store resolves a non-CacheEntry value', function(done) {
      var badStore = {
        set: function() {return Promise.resolve()},
        get: function() {return Promise.resolve(42)},
        del: function() {return Promise.resolve()}
      };

      var cache = new Cache({store: badStore});
      cache.set('test', 42).then(function() {
        cache.get('test').then(function() {
          done(new Error('should of rejected'));
        }).catch(function() {
          done();
        });
      });
    });

    it('should emit an error when store resolves non-CacheEntry value', function(done) {
      var badStore = {
        set: function() {return Promise.resolve()},
        get: function() {return Promise.resolve(42)},
        del: function() {return Promise.resolve()}
      };

      var cache = new Cache({store: badStore});
      cache.set('test', 42).then(function() {
        cache.on('error', function(err) {
          done();
        });
        cache.get('test').then(function() {
          done(new Error('should of rejected'));
        }).catch(function(err) {
          return Promise.resolve();
        })
      });
    });

  });
});
