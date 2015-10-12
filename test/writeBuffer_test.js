var WriteBuffer = require('../lib/writeBuffer');
var should = require('should');

describe('WriteBuffer', function() {
  it('should accept an arbitrary amount of `write()` calls', function() {
    var check = [];
    var i = Math.ceil(Math.random() * 100);
    var wb = new WriteBuffer();
    var msg = 'test';
    while (i--) {
      check.push(msg);
      wb.write(msg);
    }
    wb.toString().should.equal(check.join(''));
  });

  it('should throw an error for any `write()` calls after closing', function() {
    var wb = new WriteBuffer();
    wb.close();
    try {
      wb.write('');
    } catch (e) {
      return should((e instanceof Error)).equal(true);
    }
    throw new Error('Failed');
  });

  it('should flush the buffer', function() {
    var wb = WriteBuffer();
    wb.write('test');
    wb._buffer.length.should.equal(1);
    wb.flush();
    wb._buffer.length.should.equal(0);
  });
});
