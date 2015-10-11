var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var bytes = require('bytes');
var LRU = require('lru-cache');
var MemoryStore = require('./store');
var KeyEntry = require('./entry').KeyEntry;
var CacheEntry = require('./entry').CacheEntry;

function Cache(options) {
  if (!(this instanceof Cache)) return new Cache(options);
  EventEmitter.call(this);
  options = options || {};
  this.store = options.store || new MemoryStore();
  this._maxAge = options.maxAge || Infinity;
  this._keys = null;
  this._protected = null;
  this._lru = typeof options.lru !== 'undefined'
    ? options.lru
    : true;

  this._maxSize = options.maxSize || Infinity;
  if (typeof this._maxSize === 'string') {
    this._maxSize = bytes(this._maxSize);
  }
  this.init();
}
inherits(Cache, EventEmitter);

Cache.prototype.init = function() {
  var self = this;
  if (!self._lru) {
    self._keys = [];
    return;
  }

  self._protected = [];
  self._lruCache = LRU({
    max: self._maxSize,
    maxAge: Infinity,
    length: function(keyEntry) {
      return keyEntry.size;
    },
    dispose: function(key) {
      if (!self._isProtected(key)) {
        self._del(key);
      }
    }
  });
};

Cache.prototype.get = function(key) {
  var self = this;
  return self.store.get(key)
    .then(function(cacheEntry) {
      // the store doesn't have an entry
      if (!cacheEntry) {
        if (!self._lru) {
          self._removeKey(key);
        }
        // Return null for caches that don't exist
        return null;
      }
      if (!(cacheEntry instanceof CacheEntry)) {
        var err = new Error('expected store to resolve CacheEntry instance');
        self.emit('error', err);
        if (self._lru) {
          self._lruCache.del(key);
        } else {
          self._removeKey(key);
        }
        return Promise.reject(err);
      }
      if (!self._isValid(cacheEntry)) {
        // return false for invalid entries
        return false;
      }
      if (!self._lru) {
        if (!self._keyExistsBoth(key)) {
          self._setKey(key);
        }
        return cacheEntry;
      }
      if (!self._keyExistsBoth(key)) {
        var keyEntry = new KeyEntry(key, cacheEntry.size());
        self._lruCache.set(key, keyEntry);
      }
      return cacheEntry;
    });
};

Cache.prototype.set = function(key, value) {
  var self = this;
  var cacheEntry = new CacheEntry(key, value);

  return self.store.set(key, cacheEntry)
    .then(function() {
      if (self._lru) {
        var keyEntry = new KeyEntry(key, cacheEntry.size());
        self._lruCache.set(key, keyEntry);
      } else {
        self._setKey(key);
      }
      return cacheEntry;
    });
};

Cache.prototype.del = function(key) {
  var self = this;
  self._protect(key);
  return self.store.del(key)
    .then(function() {
      if (self._lru) {
        self._lruCache.del(key);
        self._unProtect(key);
      } else {
        self._removeKey(key);
      }
    });
};

Cache.prototype.clear = function() {
  var self = this;
  var keys;
  if (self._lru) {
    keys = self._lruCache.keys();
    keys.forEach(function(key) {
      self._protect(key);
    });
  } else {
    keys =  self._keys;
  }

  var promises = keys.map(function(key) {
    return self.store.del(key)
      .then(function() {
        if (!self._lru) {
          self._removeKey(key);
        } else {
          self._lruCache.del(key);
          self._unProtect(key);
        }
      }).catch(function() {
        self._unProtect(key);
        return Promise.reject();
      });
  });

  return Promise.all(promises);
};

Cache.prototype._setKey = function(key) {
  var self = this;
  if (!self._lru && !self._keyExistsBoth(key)) {
    self._keys.push(key);
  }
};

Cache.prototype._removeKey = function(key) {
  var self = this;
  if (!self._lru) {
    removeElement(self._keys, key);
  }
};

Cache.prototype._keyExistsBoth = function(key) {
  var self = this;
  var keys = self._lru
    ? self._lruCache.keys()
    : self._keys;
  return keys.indexOf(key) !== -1;
};

Cache.prototype._del = function(key) {
  var self = this;
  self.store.del(key)
    .then(function() {
      self.emit('delete', key);
    })
    .catch(function(err) {
      self.emit('error', err);
    });
};

Cache.prototype._protect = function(key) {
  var self = this;
  if (self._lru) {
    self._protected.push(key);
  }
};

Cache.prototype._unProtect = function(key) {
  var self = this;
  if (self._lru) {
    removeElement(self._protected, key);
  }
};

Cache.prototype._isProtected = function(key) {
  var self = this;
  if (!self._lru) {
    return true;
  }
  return self._protected.indexOf(key) !== -1;
};

Cache.prototype._isValid = function(cacheEntry) {
  var self = this;
  return (Date.now() - cacheEntry.created) < self._maxAge;
};

module.exports = Cache;
module.exports.KeyEntry = KeyEntry;
module.exports.CacheEntry = CacheEntry;

function removeElement(arr, val) {
  var index = arr.indexOf(val);
  if (~index) {
    arr.splice(index, 1);
  }
}
