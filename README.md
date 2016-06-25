# Middleman
  [![Travis][travis-image]][travis-url]
  [![Coveralls][coveralls-image]][coveralls-url]


  [![js-standard-style](https://cdn.rawgit.com/feross/standard/master/badge.svg)](https://github.com/feross/standard)

HTTP proxy with content caching.
* [Installation](#installation)
* [Usage](#usage)
* [Caching](#caching)
* [Store Implementations](#store-implementations)
* [Implemeting a Store](#implementing-a-store)
* [Examples](#examples)
* [API](#api)

## Installation
```sh
$ npm install --save middleman-proxy
```
## Usage
```js
const Middleman = require('middleman-proxy')

const proxy = new Middleman({
  target: 'http://some.api.com',
  maxAge: 3600000,
  maxSize: '1MB'
})
  .createKey((req, url) => `${req.method}:${req.session.id}:${url.path}`)
  .listen(3000, () => {
    console.log('Proxing "http://some.api.com" on port 3000')
  })
```

### Caching
By default, Middleman's cache is a Least-Recently-Used managed, in-memory cache,
but it can just as easily work with any persistent store.

The Cache really manages an index of "keys" that are associated with "entries" in the
store. The keys also contain the size in bytes of the associated entry, which allows
the LRU work properly. Basically, when a key is evicted, a call is
made to the store to deleted that entry. This allows the LRU to work even with
out-of-memory stores. See [Implementing a Store](#implementing-a-store) for more
details.

### Store Implementations
* [middleman-redis-store](https://github.com/nickpisacane/middleman-redis-store) A Redis based implementation.

### Implementing a Store
The "store" is really just an interface, and a simple one at that.
* Store#get(key)
  -- returns a `Promise`, resolves the cache value if it exists, and `null` if not.
* Store#set(key, value)
  -- returns a `Promise`, resolves `value`
* Store#del(key)
  -- returns a `Promise`, resolves `true`

More than that, it's perfectly fine to resolve JSON strings; Middleman will
automatically take care of parsing.

### Motivation
Recently, I have been working on a project that depended upon a very
slow api; up to 40+ seconds in some instances. Due to circumstances, a standalone
proxy was not an option. While making a hand-rolled solution, I thought it would be useful to have an in-application caching proxy solution for small apps. So I made Middleman!

## Examples

#### Middleware
```js
const Middleman = require('middleman-proxy')
const app = require('express')()

const proxy = new Middleman({
  target: 'http://some.api.com'
})

app.use(proxy.handler())

// OR
app.use((req, res) => {
  // do some stuff ...
  proxy.http(req, res)  
});

app.get('/nameSpace', (req, res) => {
  proxy.http(req, res, {
    stripPrefix: '/nameSpace',
    basePath: '/someBasePath'
  })

  // GET /nameSpace/path?foo=bar#baz
  // => (Proxy) GET http://some.api.com/someBasePath/path?foo=bar#baz
})

// OR
app.get('/nameSpace', proxy.handler({
  stripPrefix: '/nameSpace',
  basePath: '/someBasePath'
}))
```

#### Request Headers
```js
const Middleman = require('middleman-proxy')
const proxy = new Middleman({
  target: 'http://some.api.com',
  setHeaders: {
    'X-API-Key': `${API_KEY}`,
    'Authorization': `Bearer ${getAccessToken()}`
  }
})
  .listen(3000)
```

### Ignoring Response Headers
```js
const Middleman = require('middleman-proxy')
const proxy = new Middleman({
  target: 'http://some.api.com',
  ignoreHeaders: [
    'X-Some-Header'
  ]
})
```

### Request Events
```js
const Middleman = require('middleman-proxy')
const proxy = new Middleman({
  target: 'http://some.api.com'
})
  .on('request', (req, res) => {
    // For every request
    res.setHeader('X-Always', 'true')
  })
  .on('proxy request', (req, res) => {
    // For requests being proxied
    res.setHeader('X-Proxied', 'true')
  })
  .on('cache request', (req, res) => {
    // For requests with cached responses
    res.setHeader('X-Cached', 'true')
  })
```

## API
#### Middleman([options])
* target (String) URI of proxied host
* setHeaders (Object) Headers to be sent with the request, when proxied. *Default* `{}`
* ignoreHeaders (Array) Headers to be omitted from the proxy. *Default* `[]`
* cacheMethods (String|Array<String>) HTTP Methods that should be cached for,
  does not cache for any omited. *Default* `'any'`
* maxAge (Number) The max age for cache entries, *Default* `Infinity`
* maxSize (Number|String) The number (in bytes) for the maximum size of the cache.
  *Default* `Infinity`. Note: If it is a string, it is parsed by the `bytes` library, hence
  values like `'1KB'` or `'13MB'` are perfectly acceptable.
* lru (Boolean) Use LRU to manage cache, *Default* `true`
* store (Store) Custom store, *Default* `MemoryStore`. See
 [Implementing a Store](#implementing-a-store) for more details.
* followRedirect (Boolean) Follow redirects from proxied host, *Defualt* `true`.
* bypass (Function) A function that takes one argument: `res` (instance of http.IncomingMessage)
  which is a response from the proxied host, and returns a boolean; `true` and the response is
  *not* cached, `false` and the response is cached. *Default* `() => true`.
* createKey (Function) A function that takes two arguments: `req` (http.IncomingMessage)
  and `url` (Object) and returns a `key` for the cache entry. *Default*
  `(req, url) => req.method + ':' + url.path`
* httpError (Function) A function that handles http requests when there was an error
  with the proxy or the store. *Default* 500 Response.

#### Middleman#http(req, res, options)
* req (http.IncomingMessage) request
* res (http.ServerResponse) response
* options (Object)
* options.stripPrefix (String) Strip prefix from url. *Default* `''`
* options.basePath (String) Append incoming url to this path
(which is appended to the target), AFTER striping the prefix given. *Default* `''`
Handles a "request" event.
```js
const proxy = new Middleman({target: 'http://some.api.com'})
// ...
proxy.http(req, res, {
  stripPrefix: '/namespace',
  basePath: '/someBasePath'
})
// GET /namespace/path?foo=bar#baz => http://some.api.com/someBasePath/path?foo=bar#baz
```

#### Middleman#handler(options)
Returns Middleman#http() bound with the instances context. See Middleman#http.


#### Middleman#listen(port, [callback])
Populates the instances `server` property with an instance of `http.Server`, and
binds to the `port`.
```js
instance.listen(3000, () => {
  console.log('Middleman instance is now serving on port 3000')
})
```

#### Middleman#createKey(fn)
* fn (Function) See constructor option `createKey`
```js
instance
  .createKey((req, url) => {
    return `${req.method}:${req.session.id}:${url.path}`
  })
  .listen(3000)
```

#### Middleman#bypass(fn)
* fn (Function) See constructor option `bypass`
```js
instance
  .bypass((res) => {
    if (res.statusCode < 300) {
      return false // this response is cached
    } else {
      return true // not caching this one
    }
  })
  .listen(3000)
```

#### Middleman#httpError(fn)
* fn (Function) See constructor options `httpError`
```js
instance
  .httpError((req, res) => {
    res.statusCode = 500
    res.end('Whoops! Something blew up...')
  })
  .listen(3000)
```

### Licence

MIT

[travis-image]: https://travis-ci.org/nickpisacane/middleman.svg?branch=master
[travis-url]: https://travis-ci.org/nickpisacane/middleman
[coveralls-image]: https://coveralls.io/repos/nickpisacane/middleman/badge.svg?branch=master&service=github
[coveralls-url]: https://coveralls.io/github/nickpisacane/middleman?branch=master
