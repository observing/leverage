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

Because we are introducing the scripts as methods in the `Leverage.prototype`
there are a couple of names that blocked for usage or they would destroy the
modules internals. We've made sure that most of internals of this module are
namespaced user the `_` property but there are however a couple methods exposed
on the prototype:

- `_` Our private internal namespace for logic and options.
- `readyState` Which indicates if everything is loaded correctly.
- `publish` For our improved Pub/Sub.
- `subscribe` For our improved Pub/Sub.
- `destroy` For closing all used/wrapped Redis connections.
- [All EventEmitter methods][EE] and [it's private properties][EEprivate]

And just to be save, don't use methods that are prefixed with an underscore
which will just protect you possible private node internals. Other then these
properties and methods your save to anything you want as we will just remove all
forbidden chars, numbers from your script name and transform it to lowercase.

[EE]: http://nodejs.org/api/events.html#events_class_events_eventemitter
[EEprivate]: https://github.com/joyent/node/blob/master/lib/events.js#L26-L37

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

FYI: The `Leverage.introduce` methods returns an array with following data
structure:

```
{
  name: 'hello',
  args: {
    KEYS: 2,
    ARGV: 2
  },
  path: '/usr/wtf/path/to/file/hello.lua',
  code: 'local foo = KEYS[0]\nlocal bar = KEYS[1] .. etc ..'
}
```

We we attempt to load in the lua scripts in to the Redis server we attempt to
parse the script to automatically detect how many keys that should be send to
the server. If your code isn't to magical it should just parse it correctly and
set the amount of KEYS and ARGV's of your script. There might be edge cases
where you are iterating over the keys and args or we just fail to correctly
parse your lua code because you a frigging lua wizzard. For these edge cases you
can supply every generated method with a number. This number should represent
the amount of KEYS you are sending to your scripts.

```js
leverage.customscript(2, 'KEY1', 'KEY2', 'ARGS', 'ARGS', fn);
```

But doing this everytime can be a bit wastefull that's why you can also just
tell us once and the module will memorize it for you so all other calls will
just use the same amount of keys.

```js
leverage.customscript(2);
leverage.otherscript(10);
leverage.anotherscript(3);

//
// You can now call the scripts without the needed key amount argument.
//
leverage.customscript('KEY1', 'KEY2', 'ARGS', 'ARGS', fn);
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

## LICENSE

MIT
