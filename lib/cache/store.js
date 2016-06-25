var Promise = require('bluebird')
var hasOwn = Object.prototype.hasOwnProperty

/**
 * Meets the `Store` interface required by `Cache`, stores key-values in memory.
 */
function MemoryStore () {
  this._cache = Object.create(null)
}

MemoryStore.prototype.get = function (key) {
  var val = hasOwn.call(this._cache, key)
    ? this._cache[key]
    : null
  return Promise.resolve(val)
}

MemoryStore.prototype.set = function (key, val) {
  this._cache[key] = val
  return Promise.resolve(val)
}

MemoryStore.prototype.del = function (key) {
  if (hasOwn.call(this._cache, key)) {
    delete this._cache[key]
  }
  return Promise.resolve(true)
}

module.exports = MemoryStore
