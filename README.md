# leverage

Leverage is an abstraction on top of the fabilous `redis` client for Node.js. It
makes it much easier to work with lua scripting in redis as well as provide some
some missing features in redis through the power of lua scripting.

### Installation

The package should be installed through npm, which is installed by default when
you download node.js

```
npm install leverage --save
```

### Usage

To introduce these methods, the module searches for a `lua` or `leverage` folder
in the root of your application folder (which contains the `node_modules` folder
that has this module installed). It only accepts files with a `.lua` extension.
These files will be introduced as methods on the `Leverage` prototype. So if you
have a `hello.lua` file in the `leverage` folder we will automatically make a
`leverage.hello()` method.

To initialize the module you need to provide it with atleast one active redis
connection:

```js
var Leverage = require('leverage')
  , redis = require('redis').createClient();

var leverage = new Leverage(redis);
```

If you want to leverage the improved Pub/Sub capablities you should supply 2
different clients. 1 connection will be used to publish the messages and execute
the commands while the other connection will be used to subscribe and there for
block the connection for writing.

```js
var Leverage = require('leverage')
  , pub = require('redis').createClient()
  , sub = require('redis').createClient();

var leverage = new Leverage(pub, sub);
```
