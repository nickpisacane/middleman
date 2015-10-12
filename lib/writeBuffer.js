var Buffer = require('buffer').Buffer;
var Writable = require('stream').Writable;
var inherits = require('util').inherits;

function WriteBuffer() {
  if (!(this instanceof WriteBuffer)) return new WriteBuffer();
  Writable.call(this);
  this._buffer = [];
}
inherits(WriteBuffer, Writable);

WriteBuffer.prototype._write = function(chunk, encoding, cb) {
  this._buffer.push(chunk);
  return cb();
};

WriteBuffer.prototype.flush = function() {
  this._buffer = [];
};

WriteBuffer.prototype.toBuffer = function() {
  return this._buffer.length
    ? Buffer.concat(this._buffer)
    : new Buffer(0);
};

WriteBuffer.prototype.toString = function() {
  var buf = this.toBuffer();
  return buf.toString.apply(buf, arguments);
};

WriteBuffer.prototype.close = function() {
  this._buffer = null;
  this.end();
};

module.exports = WriteBuffer;
