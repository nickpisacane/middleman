var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var bytes = require('bytes')
var LRU = require('lru-cache')
var MemoryStore = require('./store')
var KeyEntry = require('./entry').KeyEntry
var CacheEntry = require('./entry').CacheEntry
var Promise = require('bluebird')

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
function Cache (options) {
  if (!(this instanceof Cache)) return new Cache(options)
  EventEmitter.call(this)
  options = options || {}
  this.store = options.store || new MemoryStore()
  this._maxAge = options.maxAge || Infinity
  this._keys = null
  this._protected = null
  this._lru = typeof options.lru !== 'undefined'
    ? options.lru
    : true

  this._maxSize = options.maxSize || Infinity
  if (typeof this._maxSize === 'string') {
    this._maxSize = bytes(this._maxSize)
  }
  this.init()
}
inherits(Cache, EventEmitter)

Cache.prototype.init = function () {
  if (!this._lru) {
    this._keys = []
    return
  }

  this._protected = []
  this._lruCache = LRU({
    max: this._maxSize,
    maxAge: Infinity,
    length: function (keyEntry) {
      return keyEntry.size
    },
    dispose: function (key) {
      if (!this._isProtected(key)) {
        this._del(key)
      }
    }.bind(this)
  })
}

/**
 * Gets an entry from the store, resolves `null` for no value, false for invalid
 * and `CacheEntry` otherwise
 * @param  {String} key Cache key
 * @return {Promise}
 * @public
 */
Cache.prototype.get = function (key) {
  return this.store.get(key).bind(this)
    .then(function (value) {
      return this._parseCacheEntry(value)
    })
    .catch(function (parseErr) {
      this.emit('error', parseErr)
      this._removeKeyBoth(key)
      return Promise.reject(parseErr)
    })
    .then(function (cacheEntry) {
      if (!cacheEntry) {
        this._removeKeyBoth(key, true)
        // Return null for caches that don't exist
        return null
      }
      if (!this._isValid(cacheEntry)) {
        this._removeKeyBoth(key)
        // return false for invalid entries
        return false
      }
      if (!this._keyExistsBoth(key)) {
        if (!this._lru) {
          this._setKey(key)
        } else {
          var keyEntry = new KeyEntry(key, cacheEntry.size())
          this._lruCache.set(key, keyEntry)
        }
      }
      return cacheEntry
    })
}

/**
 * Creates a `CacheEntry` instance with the given `value`, and persists to
 * store.
 * @param  {String} key   Cache key.
 * @param  {Any} value Cache value
 * @return {Promise}
 * @public
 */
Cache.prototype.set = function (key, value) {
  var cacheEntry = new CacheEntry(key, value)
  this._removeKeyBoth(key, true)
  return this.store.set(key, cacheEntry).bind(this)
    .then(function () {
      if (this._lru) {
        var keyEntry = new KeyEntry(key, cacheEntry.size())
        this._lruCache.set(key, keyEntry)
      } else {
        this._setKey(key)
      }
      return cacheEntry
    })
}

/**
 * Delete an entry.
 * @param  {String} key Cache key.
 * @return {Promise}
 * @public
 */
Cache.prototype.del = function (key) {
  this._protect(key)
  return this.store.del(key).bind(this)
    .then(function () {
      this._removeKeyBoth(key)
      this._unProtect(key)
      return true
    })
}

/**
 * Clear the entire cache. For LRU, keys are protected from automatic eviction.
 * @return {Promise}
 * @public
 */
Cache.prototype.clear = function () {
  var keys
  if (this._lru) {
    keys = this._lruCache.keys()
    keys.forEach(function (key) {
      this._protect(key)
    }.bind(this))
  } else {
    keys = this._keys
  }

  var promises = keys.map(function (key) {
    return this.store.del(key).bind(this)
      .then(function () {
        this._removeKeyBoth(key)
        this._unProtect(key)
      }).catch(function () {
      this._unProtect(key)
      return Promise.reject()
    })
  }.bind(this))

  return Promise.all(promises)
}

/**
 * Stores index of key, for non LRU instances.
 * @param  {String} key Cache key.
 * @private
 */
Cache.prototype._setKey = function (key) {
  if (!this._lru && !this._keyExistsBoth(key)) {
    this._keys.push(key)
  }
}

/**
 * Removes an indexed key from LRU or `_keys`.
 * @param  {String} key Cache key.
 * @param {Boolean} [safe = false] Protect key before deleting (LRU).
 * @private
 */
Cache.prototype._removeKeyBoth = function (key, safe) {
  safe = safe || false
  if (!this._lru) {
    return removeElement(this._keys, key)
  }
  if (!safe) {
    return this._lruCache.del(key)
  }
  this._protect(key)
  this._lruCache.del(key)
  this._unProtect(key)
}

/**
 * Determine whether or not a key is indexed.
 * @param  {String} key Cache key.
 * @return {Boolean}
 * @private
 */
Cache.prototype._keyExistsBoth = function (key) {
  var keys = this._lru
    ? this._lruCache.keys()
    : this._keys
  return keys.indexOf(key) !== -1
}

/**
 * This is called by `lru-cache` instance when evicting an entry, calls the
 * stores `.del()` method with the key to be evicted. If the store rejects on
 * `.del()` the "error" event is fired, otherwise the "delete" event is fired
 * with the key.
 * @param  {String} key Cache key.
 * @private
 */
Cache.prototype._del = function (key) {
  this._protect(key)
  this.store.del(key).bind(this)
    .then(function () {
      this._unProtect(key)
      this.emit('delete', key)
    })
    .catch(function (err) {
      this.emit('error', err)
    })
}

/**
 * Protect a key from eviction, at least from lru calling the stores .del()
 * method. This is only used when a key is being manualy deleted from the cache.
 * @param  {String} key Cache key.
 * @private
 */
Cache.prototype._protect = function (key) {
  if (this._lru && !this._isProtected(key)) {
    this._protected.push(key)
  }
}

/**
 * Key is open for eviction from lru.
 * @param  {String} key Cache key.
 * @private
 */
Cache.prototype._unProtect = function (key) {
  if (this._lru) {
    removeElement(this._protected, key)
  }
}

/**
 * Determine whether or not a key is protected from eviction.
 * @param  {String} key Cache key.
 * @return {Boolean}
 * @private
 */
Cache.prototype._isProtected = function (key) {
  if (!this._lru) {
    return true
  }
  return this._protected.indexOf(key) !== -1
}

/**
 * Determine whether or not cache entry is invalid.
 * @param  {CacheEntry} cacheEntry Entry resolved from store.
 * @return {Boolean}
 * @private
 */
Cache.prototype._isValid = function (cacheEntry) {
  return (Date.now() - cacheEntry.created) < this._maxAge
}

/**
 * Parse a `CacheEntry` instance from serialized object.
 * @param  {String|Object|Null|CacheEntry} value Value resolved from store.
 * @return {Null|CacheEntry}       Returns value if !value, otherwise attempts
 *                                         to parse.
 * @throws {SytaxError|Error} JSON.parse could throw, if value does not adhere
 *         										to serialized CacheEntry, an Error will be thrown.
 */
Cache.prototype._parseCacheEntry = function (value) {
  if (!value) {
    return value
  }
  if (value instanceof CacheEntry) {
    return value
  }
  if (typeof value === 'string') {
    value = JSON.parse(value)
  }
  if (typeof value === 'object' &&
    typeof value.key === 'string' &&
    typeof value.created === 'number') {
    var cacheEntry = new CacheEntry(value.key, value.value)
    cacheEntry.created = value.created
    return cacheEntry
  } else {
    throw new Error('Store resolved unparsable value')
  }
}

module.exports = Cache
module.exports.KeyEntry = KeyEntry
module.exports.CacheEntry = CacheEntry

function removeElement (arr, val) {
  var index = arr.indexOf(val)
  if (~index) {
    arr.splice(index, 1)
  }
}
