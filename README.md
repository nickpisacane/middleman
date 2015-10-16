# Middleman
  [![Travis][travis-image]][travis-url]
  [![Coveralls][coveralls-image]][coveralls-url]

Reverse proxy with content caching, work in progress.


```js
var Middleman = require('middleman');

Middleman({target: 'http://some.api.com'})
  .listen(3000, () => {
    console.log('Listening on port 3000');
  });
```



[travis-image]: https://travis-ci.org/Nindaff/middleman.svg?branch=master
[travis-url]: https://travis-ci.org/Nindaff/middleman
[coveralls-image]: https://coveralls.io/repos/Nindaff/middleman/badge.svg?branch=master&service=github
[coveralls-url]: https://coveralls.io/github/Nindaff/middleman?branch=master
