var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var bytes = require('bytes');
var LRU = require('lru-cache');
var MemoryStore = require('./store');
var KeyEntry = require('./entry').KeyEntry;
var CacheEntry = require('./entry').CacheEntry;
var Promise = require('bluebird');

/**
 * Cache instance provides abstraction from underlying store. By default a
 * index of `KeyEntry`s are managed by `lru-cache`. This allows the store to
 * be a database wrapper, or some other abstraction, and yet still implement
 * LRU.
 * @param {Object} options
 * @param {Store} [options.store = MemoryStore] The store
 * @param {Number} [options.maxAge = Inifinity] Max cache entry age
 * @param {Number|String} [options.maxSize] Size in bytes, number or string
 *                                          If string, parsed by `bytes`.
 * @param {Boolean} [options.lru = true] Use lru
 * @public
 * @constructor
 */
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

/**
 * Gets an entry from the store, resolves `null` for no value, false for invalid
 * and `CacheEntry` otherwise
 * @param  {String} key Cache key
 * @return {Promise}
 * @public
 */
Cache.prototype.get = function(key) {
  var self = this;
  return self.store.get(key)
    .then(function(cacheEntry) {
      if (!cacheEntry) {
        self._removeKeyBoth(key, true);
        // Return null for caches that don't exist
        return null;
      }
      if (!(cacheEntry instanceof CacheEntry)) {
        var err = new Error('expected store to resolve CacheEntry instance');
        self.emit('error', err);
        self._removeKeyBoth(key);
        return Promise.reject(err);
      }
      if (!self._isValid(cacheEntry)) {
        self._removeKeyBoth(key);
        // return false for invalid entries
        return false;
      }
      if (!self._keyExistsBoth(key)) {
        if (!self._lru) {
          self._setKey(key);
        } else {
          var keyEntry = new KeyEntry(key, cacheEntry.size());
          self._lruCache.set(key, keyEntry);
        }
      }
      return cacheEntry;
    });
};

/**
 * Creates a `CacheEntry` instance with the given `value`, and persists to
 * store.
 * @param  {String} key   Cache key.
 * @param  {Any} value Cache value
 * @return {Promise}
 * @public
 */
Cache.prototype.set = function(key, value) {
  var self = this;
  var cacheEntry = new CacheEntry(key, value);
  self._removeKeyBoth(key, true);
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

/**
 * Delete an entry.
 * @param  {String} key Cache key.
 * @return {Promise}
 * @public
 */
Cache.prototype.del = function(key) {
  var self = this;
  self._protect(key);
  return self.store.del(key)
    .then(function() {
      self._removeKeyBoth(key);
      self._unProtect(key);
    });
};

/**
 * Clear the entire cache. For LRU, keys are protected from automatic eviction.
 * @return {Promise}
 * @public
 */
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
        self._removeKeyBoth(key);
        self._unProtect(key);
      }).catch(function() {
        self._unProtect(key);
        return Promise.reject();
      });
  });

  return Promise.all(promises);
};

/**
 * Stores index of key, for non LRU instances.
 * @param  {String} key Cache key.
 * @private
 */
Cache.prototype._setKey = function(key) {
  var self = this;
  if (!self._lru && !self._keyExistsBoth(key)) {
    self._keys.push(key);
  }
};

/**
 * Removes an indexed key from LRU or `_keys`.
 * @param  {String} key Cache key.
 * @param {Boolean} [safe = false] Protect key before deleting (LRU).
 * @private
 */
Cache.prototype._removeKeyBoth = function(key, safe) {
  var self = this;
  safe = safe || false;
  if (!self._lru) {
    return removeElement(self._keys, key);
  }
  if (!safe) {
    return self._lruCache.del(key);
  }
  self._protect(key);
  self._lruCache.del(key);
  self._unProtect(key);
};

/**
 * Determine whether or not a key is indexed.
 * @param  {String} key Cache key.
 * @return {Boolean}
 * @private
 */
Cache.prototype._keyExistsBoth = function(key) {
  var self = this;
  var keys = self._lru
    ? self._lruCache.keys()
    : self._keys;
  return keys.indexOf(key) !== -1;
};

/**
 * This is called by `lru-cache` instance when evicting an entry, calls the
 * stores `.del()` method with the key to be evicted. If the store rejects on
 * `.del()` the "error" event is fired, otherwise the "delete" event is fired
 * with the key.
 * @param  {String} key Cache key.
 * @private
 */
Cache.prototype._del = function(key) {
  var self = this;
  self._protect(key);
  self.store.del(key)
    .then(function() {
      self._unProtect(key);
      self.emit('delete', key);
    })
    .catch(function(err) {
      self.emit('error', err);
    });
};

/**
 * Protect a key from eviction, at least from lru calling the stores .del()
 * method. This is only used when a key is being manualy deleted from the cache.
 * @param  {String} key Cache key.
 * @private
 */
Cache.prototype._protect = function(key) {
  var self = this;
  if (self._lru &&  !self._isProtected(key)) {
    self._protected.push(key);
  }
};

/**
 * Key is open for eviction from lru.
 * @param  {String} key Cache key.
 * @private
 */
Cache.prototype._unProtect = function(key) {
  var self = this;
  if (self._lru) {
    removeElement(self._protected, key);
  }
};

/**
 * Determine whether or not a key is protected from eviction.
 * @param  {String} key Cache key.
 * @return {Boolean}
 * @private
 */
Cache.prototype._isProtected = function(key) {
  var self = this;
  if (!self._lru) {
    return true;
  }
  return self._protected.indexOf(key) !== -1;
};

/**
 * Determine whether or not cache entry is invalid.
 * @param  {CacheEntry} cacheEntry Entry resolved from store.
 * @return {Boolean}
 * @private
 */
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
