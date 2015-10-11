var inherits = require('util').inherits;
var sizeof = require('object-sizeof');

/**
 * Base entry class
 * @param {string} key Entry key name
 * @constructor
 */
function Entry(key) {
  if (!(this instanceof Entry)) return new Entry(key);
  this.key = key;
  this.created = Date.now();
}

/**
 * Change the timestamp
 * @param  {number} stamp unix stamp
 */
Entry.prototype.setCreated = function(stamp) {
  this.created = stamp;
};

/**
 * Extends `Entry` with the addition of a `size` variable
 * @param {string} key  Key name
 * @param {number} size Size of associated entry in bytes
 * @constructor
 */
function KeyEntry(key, size) {
  if (!(this instanceof KeyEntry)) return new KeyEntry(key, size);
  Entry.call(this, key);
  this.size = typeof size === 'number'
    ? size
    : 0;
}
inherits(KeyEntry, Entry);

/**
 * Extends `Entry` with the addition of `value` variable, and `size()` method.
 * @param {String} key   Accociative cache key.
 * @param {*} value Cache value
 * @constructor
 */
function CacheEntry(key, value) {
  if (!(this instanceof Entry)) return new CacheEntry(key, value);
  Entry.call(this, key);
  this.value = value;
}
inherits(CacheEntry, Entry);

/**
 * Returns best estimate size of the cache value, if the value has a method
 * `size()` then that is returned.
 * @return {Number} Size in bytes.
 */
CacheEntry.prototype.size = function() {
  if (this.value) {
    if (typeof this.value.size === 'function') {
      var size = this.value.size();
      if (typeof size === 'number') {
        return size;
      }
    }
    return sizeof(this.value);
  }
  return 0;
};

module.exports = Entry;
module.exports.KeyEntry = KeyEntry;
module.exports.CacheEntry = CacheEntry;
