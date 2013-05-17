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

var leverage = new Leverage(redis, { optional options });
```

If you want to leverage the improved Pub/Sub capablities you should supply 2
different clients. 1 connection will be used to publish the messages and execute
the commands while the other connection will be used to subscribe and there for
block the connection for writing.

```js
var Leverage = require('leverage')
  , pub = require('redis').createClient()
  , sub = require('redis').createClient();

var leverage = new Leverage(pub, sub, { optional options });
```

It might be possible that you want to add scripts from a different folder then
our pre-defined folder locations. We've added a `Leverage.introduce` which you
can use to add scripts. The scripts that are added should be added to the
`Leverage.scripts` array and you should add the scripts **BEFORE** you construct
a new Leverage instance.

```js
var Leverage = require('leverage');

//
// Give the method the path of your lua files and the object or in our case the
// prototype where you want to introduce the methods.
//
var scripts = Leverage.introduce('/path/to/your/custom/directory', Leverage.prototype);

//
// IMPORTANT: Add the returned array of added scripts to our Leverage.scipts as
// are checked during the bootstapping of the Leverage instance.
//
Leverage.scripts = Leverage.scripts.concat(scripts);
```

#### Options

The following options are available, most of these apply to the improved Pub/Sub
system.

<dl>
  <dt>namespace</dt>
  <dd>
    <p>
      The namespace is used to prefix all keys that are set by this module
      inside of your redis installation. This way you can prevent conflicts from
      happening. It defaults to <code>leverage</code>
    </p>
  </dd>
  <dt>SHA1<dt>
  <dd>
    <p>
      SHA1 can be provided a preconfigured object that contains references to
      all method -> SHA1 mappings. Only change this if you know what the fuck
      you are doing. If this is not set we will just check your redis server to
      find out of the script has been loaded in the internal cache.
    </p>
  </dd>
  <dt>backlog</dt>
  <dd>
    <p>
      How many messages can we store for the pub/sub connection relaiblity if
      you are sending a lot of message per second you might want to set this to
      a higher number then you would with lower rate messages. It defaults to
      <code>10000</code>. The messages are stored using FIFO so if you are
      storing to much messages it will automatically override older keys.
    </p>
  </dd>
  <dt>expire</dt>
  <dd>
    <p>
      To make sure that we don't leave to much crap in your database all stored
      messages are provided with a expire value. So the messages can be killed
      in 2 ways, either by an overflow of the backlog or by an expired key. The
      default expiree is <code>1000</code>.
    </p>
  </dd>
</dl>
