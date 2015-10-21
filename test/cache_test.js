var Cache = require('../lib/cache');
var Entry = require('../lib/cache/entry');
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
  describe('Entry', function() {
    it('Entry constructors should not require `new` keyword', function() {
      (Entry() instanceof Entry).should.equal(true);
      (KeyEntry() instanceof KeyEntry).should.equal(true);
      (CacheEntry() instanceof CacheEntry).should.equal(true);
    });
  });

  describe('CacheEntry', function() {
    it('should return a values size in bytes (no .size() method or prop)',
    function() {
      var value = 'test';
      var size = sizeof(value);
      var ce = new CacheEntry('test', value);
      ce.size().should.equal(size);
    });

    it('.size() should return `value.size()` if its a number', function() {
      var value = {
        test: 'test',
        size: function(){return 42}
      };
      var ce = new CacheEntry('test', value);
      ce.size().should.equal(42);
      value.size = function() {
        return false;
      };
      var expected = sizeof(value);
      ce.size().should.equal(expected);
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

    it('`.del()` should resolve true when key exists or not', function(done) {
      store.del('doesntexist')
        .then(function(resolved) {
          resolved.should.equal(true);
          return store.set('test', 42);
        })
        .then(function() {
          return store.del('test');
        })
        .then(function(resolved) {
          resolved.should.equal(true);
          done();
        })
        .catch(done);
    });
  });

  describe('Cache', function() {
    it('constructor should not require `new` keyword', function() {
      (Cache() instanceof Cache).should.equal(true);
    });

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

    it('should emit error when #store.del() rejects, during LRU automatic resize',
    function(done) {
      var cache = new Cache({
        maxSize: '1KB'
      });
      var oneKb = function() {
        return {
          buf: new Buffer(1024),
          size: function() {return this.buf.length}
        };
      };
      var emitted = false;
      cache.on('error', function(err) {
        emitted = true;
      });
      cache.set('one', oneKb())
        .then(function() {
          cache.store.del = function() {
            return Promise.reject(new Error('bad store'));
          };
          return cache.set('two', oneKb());
        })
        .then(function() {
          emitted.should.equal(true);
          done();
        })
        .catch(done);
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

    it('should unprotect keys from LRU in the case of failed `clear()`',
    function(done) {
      var cache = new Cache();
      Promise.all([
        cache.set('one', 1),
        cache.set('two', 2)
      ])
        .then(function() {
          cache.store.del = function() {
            return Promise.reject(new Error('bad store'));
          };
          return cache.clear()
        })
        .then(function() {
          done(new Error('should have rejected'));
        })
        .catch(function(err) {
          ['one', 'two'].forEach(function(key) {
            cache._isProtected(key).should.equal(false);
          });
          done();
        });
    });

    it('keys should be protected by default when not LRU', function(done) {
      var cache = new Cache({lru: false});
      cache.set('test', 42)
        .then(function() {
          cache._isProtected('test').should.equal(true);
          done();
        })
        .catch(done);
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

    it('should emit "error" when store resolves non-CacheEntry value and ' +
    'delete key entry (LRU)', function(done) {
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
          cache._keyExistsBoth('test').should.equal(false);
          return Promise.resolve();
        })
      });
    });

    it('should emit "error" when store resolves non-CacheEntry value and delete' +
    ' key (NON-LRU)', function(done) {
      var badStore = {
        set: function() {return Promise.resolve()},
        get: function() {return Promise.resolve(42)},
        del: function() {return Promise.resolve()}
      };
      var cache = new Cache({
        lru: false,
        store: badStore
      });
      cache.set('test', 42).then(function() {
        cache.on('error', function(err) {
          done();
        });
        cache.get('test').then(function() {
          done(new Error('should of rejected'));
        }).catch(function(err) {
          cache._keyExistsBoth('test').should.equal(false);
          return Promise.resolve();
        })
      });
    });

    it('should create KeyEntries for un-indexed entries (LRU)', function(done) {
      var cache = new Cache();
      var entry = new CacheEntry('test', 42);
      cache.store.set('test', entry)
        .then(function() {
          return cache.get('test');
        })
        .then(function(cacheEntry) {
          var keyEntry = cache._lruCache.get('test');
          (keyEntry instanceof KeyEntry).should.equal(true);
          keyEntry.key.should.equal(cacheEntry.key);
          done();
        })
        .catch(done);
    });

    it('should create keys for un-indexed entires (NON-LRU)', function(done) {
      var cache = new Cache({lru: false});
      var entry = new CacheEntry('test', 42);
      cache.store.set('test', entry)
        .then(function() {
          return cache.get('test');
        })
        .then(function(cacheEntry) {
          cache._keys.indexOf(cacheEntry.key).should.not.equal(-1);
          done();
        })
        .catch(done);
    });

    it('should index keys when not LRU', function(done) {
      var cache = new Cache();
      cache.set('test', 42)
        .then(function() {
          cache._keyExistsBoth('test').should.equal(true);
          return cache.del('test');
        })
        .then(function() {
          cache._keyExistsBoth('test').should.equal(false);
          done();
        })
        .catch(done);
    });

    it('should not manage keys in an array when LRU', function() {
      var cache = new Cache();
      should(cache._keys).equal(null);
      cache._setKey('test');
      cache._removeKeyBoth('test');
    });

    it('should not "protect" keys when NOT LRU', function() {
      var cache = new Cache({lru: false});
      should(cache._protected).equal(null);
      cache._unProtect('test');
    });

    // end Cache
    });
});
