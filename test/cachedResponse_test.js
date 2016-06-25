var CachedResponse = require('../').CachedResponse
require('should')

describe('CachedResponse', function () {
  it('constructor should not require `new`', function () {
    (CachedResponse() instanceof CachedResponse).should.equal(true)
  })

  it('should provide a size()', function () {
    var cachedResponse = new CachedResponse(200, {}, new Buffer('test'))
    // 64b (Number) + 4B (Buffer)
    cachedResponse.size().should.be.aboveOrEqual(12)
  })

  it('should parse json responses', function () {
    var status = 200
    var headers = {'Content-Type': 'text/plain'}
    var body = new Buffer('test')
    var cr = new CachedResponse(status, headers, body)
    // Stringify and parse
    var json = JSON.stringify(cr)
    var res = CachedResponse.parseJSON(json)
    res.status.should.equal(status)
    res.headers.should.eql(headers)
    res.body.toString().should.equal('test')
  })

  it('should parse CachedResponse-like objects (body = Buffer)', function () {
    var obj = {
      status: 200,
      headers: {},
      body: new Buffer('test')
    }
    var parsed = CachedResponse.parse(obj)
    ;(parsed instanceof CachedResponse).should.equal(true)
  })

  it('should parse CachedResponse-like objects (body = serialized Buffer)',
    function () {
      var obj = {
        status: 200,
        headers: {},
        body: {
          type: 'Buffer',
          data: [116, 101, 115, 116]
        }
      }

      var parsed = CachedResponse.parse(obj)
      ;(parsed instanceof CachedResponse).should.equal(true)
      parsed.body.toString().should.equal('test')
    })

  it('.parse() should throw an error, argument is not CachedResponse-like',
    function () {
      try {
        CachedResponse.parse({})
      } catch (e) {
        (e instanceof Error).should.equal(true)
        return true
      }
      throw new Error('failed')
    })

  it('.parse() should throw an error when, body is not buffer or serialized buffer',
    function () {
      var bad = {
        status: 200,
        headers: {},
        body: {}
      }
      test(bad)
      bad.body = 42
      test(bad)

      function test (obj) {
        try {
          CachedResponse.parse(bad)
        } catch (e) {
          (e instanceof Error).should.equal(true)
          return true
        }
        throw new Error('Failed')
      }
    })

  it('should work with node v0.10 buffers', function () {
    var obj = {
      status: 200,
      headers: {},
      body: [116, 101, 115, 116]
    }

    var parsed = CachedResponse.parse(obj)
    ;(parsed instanceof CachedResponse).should.equal(true)
    parsed.body.toString().should.equal('test')
  })
})
