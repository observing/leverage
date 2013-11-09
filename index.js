'use strict';

var Underverse = require('underverse')
  , crypto = require('crypto')
  , path = require('path')
  , fs = require('fs');

//
// Speed up references to Array.prototype.slice which is used for argument
// conversion.
//
var slice = Array.prototype.slice;

//
// Placeholder for callbacks.
//
function noop() {}

/**
 * Leverage the awesome power of lua scripting.
 *
 * @constructor
 * @param {Redis} client Redis client to publish the messages over.
 * @param {Redis} sub Redis client to subscribe with.
 * @param {Object} options Options.
 */
function Leverage(client, sub, options) {
  if (!(this instanceof Leverage)) return new Leverage(client, sub, options);

  //
  // Flakey detection if we got a options argument or an actual Redis client. We
  // could do an instanceof RedisClient check but I don't want to have Redis as
  // a dependency of this module.
  //
  if ('object' === typeof sub && !options && !sub.send_command) {
    options = sub;
    sub = null;
  }

  options = options || {};

  // !IMPORTANT
  //
  // As the scripts are introduced to the `prototype` of our Leverage module we
  // want to make sure that we don't pollute this namespace to much. That's why
  // we've decided to move most of our internal logic in to a `._` private
  // object that contains most of our logic. This way we only have a small
  // number prototypes and properties that should not be overridden by scripts.
  //
  // !IMPORTANT

  this._ = Object.create(null, {
    //
    // The namespace is used to prefix all keys that are used by this module.
    //
    namespace: {
      value: options.namespace || 'leverage'
    },

    //
    // Stores the SHA1 keys from the scripts that are added.
    //
    SHA1: {
      value: options.SHA1 || Object.create(null)
    },

    //
    // The amount of items we should log for our Pub/Sub.
    //
    backlog: {
      value: options.backlog || 100000
    },

    //
    // How many seconds should the item stay alive in our backlog.
    //
    expire: {
      value: options.expire || 1000
    },

    //
    // The pre-configured & authenticated Redis client that is used to send
    // commands and is loaded with the scripts.
    //
    client: {
      value: client
    },

    //
    // Dedicated client that is used for subscribing to a given channel.
    //
    sub: {
      value: sub
    },

    //
    // Introduce a bunch of private methods.
    //
    load:     { value: Leverage.load.bind(this) },
    prepare:  { value: Leverage.prepare.bind(this) },
    refresh:  { value: Leverage.refresh.bind(this) },
    seval:    { value: Leverage.seval.bind(this) }
  });

  //
  // Proxy all readyState changes to another event to make some of our internal
  // usage a bit easier.
  //
  this.on('readystatechange', function readystatechagne(state) {
    this.emit('readystate#'+ state);
  });

  if (this._.client === this._.sub) {
    throw new Error('The pub and sub clients should separate connections');
  }

  if (Object.keys(this._.SHA1) !== Leverage.scripts.length) this._.load();
}

Leverage.prototype.__proto__ = require('events').EventEmitter.prototype;

/**
 * Returns the current readyState of the driver. It supports the following
 * states:
 *
 * - uninitialized:
 *   We don't have any active pub/sub Redis instances available.
 *
 * - loading:
 *   We're loading the lua scripts in to database and waiting until all scripts
 *   are loaded.
 *
 * - complete:
 *   Everything is fully loaded.
 *
 * @api private
 */
Object.defineProperty(Leverage.prototype, 'readyState', {
  get: function readyState() {
    if (!this._.client) return 'uninitialized';
    if (Object.keys(this._.SHA1).length !== Leverage.scripts.length) return 'loading';

    return 'complete';
  }
});

/**
 * Publish the message reliably.
 *
 * @param {String} channel The channel we want to send to.
 * @param {String} message The message to send
 * @param {Function} fn The callback function.
 * @api public
 */
Leverage.prototype.publish = function publish(channel, message, fn) {
  return this.leveragesend(channel, message, fn || noop);
};

/**
 * Subscribe to our highly reliable message queue. All messages are emitted
 * using a `<channel>::message` event on Leverage.
 *
 * Options:
 * - ordered: Should we maintain message order if we miss a message.
 * - retrieve: When we first connect, how many old messages should we retrieve.
 *
 * @param {String} channel The channel name we want to subscribe to.
 * @param {Object} options Subscription options.
 * @api public
 */
Leverage.prototype.subscribe = function subscribe(channel, options) {
  options = options || {};

  var uv = new Underverse(this._.backlog)
    , leverage = this
    , _ = this._;

  //
  // Reliability configuration:
  //
  // ordered: Should we maintain order of messages at the cost of increased
  //          latency as messages are queued until we have everything.
  // replay:  How many events should we retrieve when we join so they can be
  //          replayed instantly as we might have received a message when we
  //          joined the channel.
  // bailout: Should we unsubscribe from the channel if we cannot maintain or
  //          guarantee the reliability.
  //
  var ordered = 'ordered' in options ? !!options.ordered : false
    , bailout = 'bailout' in options ? options.bailout : true
    , replay =  'replay'  in options ? options.replay  : 10
    , queue = [];

  /**
   * Bailout and cancel all the things
   *
   * @param {Errorr} Err The error that occured
   * @api private
   */
  function failed(err) {
    leverage.emit(channel +'::error', err);

    if (!bailout) return;

    leverage.emit(channel +'::bailout', err);
    leverage.unsubscribe(channel);
  }

  /**
   * Cleans up all references when we are unsubscribing.
   *
   * @api private
   */
  function cleanup() {
    uv.removeAllListeners();
    queue.length = 0;
  }

  /**
   * Parse the packet.
   *
   * @param {String} packet The encoded message.
   * @returns {Object}
   * @api private
   */
  function parse(packet) {
    if ('object' === typeof packet) return packet;

    try { return JSON.parse(packet); }
    catch (e) { return failed(e); }
  }

  /**
   * Emit the package and process the queue if we've build one.
   *
   * @param {Object} packet The message packet.
   * @api private
   */
  function emit(packet) {
    leverage.emit(channel +'::message', packet.message, packet.id);
  }

  /**
   * We have messages queued, now that we've successfully send the message we
   * probably want to try and resend all of these messages and hope that we
   * we've restored the reliability again.
   *
   * @api private
   */
  function flush() {
    if (queue.length) {
      //
      // We might want to indicate that these are already queued, so we don't
      // fetch data again.
      //
      queue.splice(0).sort(function sort(a, b) {
        return a.id - b.id;
      }).forEach(onmessage);
    }
  }

  /**
   * Checks if we are allowed to emit the message.
   *
   * @param {Object} packet The message packet.
   * @api private
   */
  function allowed(packet) {
    if (!packet) return false;

    if (uv.position === 'inactive' || (!uv.received(packet.id) && ordered)) {
      queue.push(packet);
      return false;
    }

    return true;
  }

  /**
   * Handle incomming messages.
   *
   * @param {String} packet The message
   * @api private
   */
  function onmessage(packet) {
    if (arguments.length === 2) packet = arguments[1];
    packet = parse(packet);

    if (allowed(packet)) emit(packet);
  }

  //
  // Fetch the current id from the database as well as any older messages. Do
  // this after we've send a subscription command so we can retrieve some
  // backlog and "HOPE" that we've given our self enough time to retrieve data.
  //
  this.leveragejoin(channel, replay, function join(err, packet) {
    if (err) return failed(err);
    packet = parse(packet);

    //
    // We're ready and starting processing the subscriptions and published
    // messages.
    //
    leverage.emit(channel +'::online', packet.id);

    //
    // lua edge case it can return an object instead of an array ._. when it's
    // empty, yay.
    //
    if (Array.isArray(packet.messages)) {
      packet.messages.map(parse).filter(Boolean).forEach(emit);
    }

    //
    // Set the cursor to the received package.
    //
    uv.cursor(packet.id);
    flush();
  });

  //
  // Fetch missing packets.
  //
  uv.on('fetch', function fetch(missing, processing) {
    processing();

    _.client.mget(missing.map(function namespace(id) {
      return _.namespace +'::'+ channel +'::backlog::'+ id;
    }), function next(err, data) {
      processing(true);

      if (err || !data) {
        return failed(err || new Error('No data retrieved from fetching'));
      }

      if (Array.isArray(data)) {
        data.map(parse).filter(allowed).forEach(emit);
      }

      flush();
    });
  });

  //
  // Subscribe to the actual channel and attach a message processor.
  //
  this._.sub.subscribe(_.namespace +'::'+ channel);
  this._.sub.on('message', onmessage);
  this.once(channel +'::unsubscribe', cleanup);

  return this;
};

/**
 * Unsubscribe from a channel.
 *
 * @param {String} channel The channel we wish to unsubscribe from.
 * @param {Function} fn
 * @api public
 */
Leverage.prototype.unsubscribe = function unsubscribe(channel, fn) {
  var booth = this;

  this._.sub.unsubscribe(this._.namespace +'::'+ channel, function () {
    booth.emit(channel +'::unsubscribe');
    (fn || noop).apply(this, arguments);
  });

  return this;
};

/**
 * Destroy leverage and it's attached Redis connections.
 *
 * @api private
 */
Leverage.prototype.destroy = function destroy() {
  if (this.client) this.client.quit();
  if (this.sub) this.sub.quit();

  return this;
};

/**
 * Load all the lua scripts from the lua directory which should be loaded in to
 * database to minimize the performance overhead.
 *
 * @api private
 */
Leverage.load = function load() {
  var leverage = this
    , completed = 0;

  Leverage.scripts.forEach(function each(script) {
    leverage._.refresh(script, function reload(err) {
      //
      // Shit is broken yo, we should just emit an `error` event here because we
      // cannot operate under these kind of conditions.
      //
      if (err) leverage.emit('error', err);

      if (++completed === Leverage.scripts.length) {
        leverage.emit('readystatechange', leverage.readyState);
      }
    });
  });

  return this;
};

/**
 * Apply our configuration to the scripts by simply replacing some of our
 * template placeholders with the correct values. This way we can easily
 * configure our lua scripts through Redis without having to constantly
 * rewrite our lua scripts when a namespace changes for example.
 *
 * @param {String} code Lua code snippet
 * @returns {String} Transformed lua string
 * @api private
 */
Leverage.prepare = function prepare(code) {
  var _ = this._;

  return code.replace('{leverage::namespace}', _.namespace)
             .replace('{leverage::backlog}', _.backlog)
             .replace('{leverage::expire}', _.expire);
};

/**
 * Reload a lua script in to the Redis server cache.
 *
 * @param {Object} script Script object containing the name & source of a lua script
 * @param {Function} fn Hollaback
 * @api private
 */
Leverage.refresh = function reload(script, fn) {
  var code = this._.prepare(script.code)
    , SHA1 = crypto.createHash('SHA1').update(code).digest('hex').toString()
    , leverage = this;

  leverage._.client.script('exists', SHA1, function exists(err, has) {
    if (err) return fn.apply(this, arguments);

    //
    // For some odd reason, the `scripts exists SHA` response isn't properly
    // parsed by the Redis client so we are using this flaky check.
    // See mranney/node_redis#436 for the reported issue.
    //
    if ((Array.isArray(has) && has[0]) || has) {
      leverage._.SHA1[script.name] = SHA1;
      return fn.call(this);
    }

    leverage._.client.script('load', code, function load(err, RSHA1) {
      if (err) return fn.apply(this, arguments);
      if (SHA1 !== RSHA1) return fn.call(this, new Error('SHA1 does not match'));

      leverage._.SHA1[script.name] = SHA1;
      return fn.apply(this, arguments);
    });
  });

  return this;
};

/**
 * Safely eval a given Redis script or it can be used as a setter of KEYS.
 * Because attempting to parse the script can be a flakey.
 *
 * @param {Object} script
 * @api private
 */
Leverage.seval = function seval(script, args) {
  var SHA1 = this._.SHA1[script.name]
    , leverage = this
    , fn = args.pop()
    , keys = script.args.KEYS || args.length;

  //
  // We are not fully loaded yet, queue all calls in our event emitter so it
  // will be issued once all scripts are loaded.
  //
  if ('complete' !== this.readyState) {
    return this.once('readystate#complete', function loaded() {
      //
      // It's fully loaded again, but as we pop()'d the callback off it, we need
      // to concat it again or we will lose the callback argument.
      //
      return leverage._.seval.call(leverage, script, args.concat(fn));
    });
  }

  //
  // Allow users to specify the amount of keys they are sending for this
  // script. If the script isn't to complicated we can actually parse out the
  // value and the amount of KEYS/ARGVS for you.
  //
  if ('number' === typeof args[0] && args[0] >= 0) {
    script.args.KEYS = keys = args.shift();

    //
    // This was just a set operation so we can safely bailout.
    //
    if (!args.length) return this;
  }

  //
  // 1. Try to execute the script by calling the evalsha command as we assume
  //    that script was initialized when our constructor got initialised.
  //
  // 2. When we receive a NOERROR error we are going to re-load the script in
  //    our cache and issue a regular eval in parallel so we still get our
  //    results. This way the next call will be cached.
  //
  leverage._.client.send_command(
    'evalsha',
    [SHA1, keys].concat(args),
    function send(err, data) {
      if (!err || (err && !~err.message.indexOf('NOSCRIPT'))) {
        //
        // We received no error or just a different error then a missing script,
        // return the control to the callback as fast as possible.
        //
        return fn.call(this, Leverage.error(err, script), data);
      }

      var code = leverage._.prepare(script.code);

      //
      // As the request has failed, we are going to re-add the script in to our
      // cache if possible and eval the command
      //
      leverage._.refresh(script, function noop() {});
      leverage._.client.send_command(
        'eval',
        [code, keys].concat(args),
        function evaled(err, data) {
          return fn.call(this, Leverage.error(err, script), data);
        }
      );
    }
  );

  return this;
};

/**
 * Parse the errors that are returned from Redis to see if a script has failed
 * to execute.
 *
 * @param {Error} err Error or nothing.
 * @returns {Error} LuaError or nothing.
 * @api private
 */
Leverage.error = function error(err, script) {
  if (!err) return err;

  //
  // The regular expression is kindly provided by the awesome Wolverine library
  // from Shopify (Shopify/wolverine)
  //
  var pattern = /ERR Error (compiling|running) script \(.*?\): .*?:(\d+): (.*)/
    , data = pattern.exec(err.message);

  //
  // It's a regular error, it doesn't have to be re-created as a lua based
  // error.
  //
  if (!data) return err;

  var lua = new Error(data[3])
    , stack = err.stack.split('\n');

  // Remove the first line from the original stack as it's the same as the message
  stack.shift();
  stack.unshift(
    '    at '
    + script.code.split('\n')[data[2] - 1]  // Snippet of the line that fucked it up
    + '('
    + script.path                           // The location of the script.
    +':'
    + data[2]                               // The line number of the script.
    + ')'
  );
  stack.unshift('Error: '+ data[3]);
  lua.stack = stack.join('\n');

  // Add a reference to the original error.
  lua.original = err;
  return lua;
};

/**
 * Introduce the new methods to a given object.
 *
 * @param {String} directory Location of the directory.
 * @param {Object} obj Object to introduce the methods.
 * @returns {Array} scripts that got introduced as methods.
 * @api private
 */
Leverage.introduce = function introduce(directory, obj) {
  var scripts = fs.readdirSync(directory).reduce(function format(scripts, script) {
    if ('.lua' !== path.extname(script)) return scripts;

    var location = path.join(directory, script)
      , code = fs.readFileSync(location, 'utf-8');

    scripts.push({
      name: Leverage.method(script),
      args: Leverage.parse(code),
      path: location,
      code: code
    });

    return scripts;
  }, []);

  scripts.forEach(function each(script) {
    if (script.name in obj) {
      throw new Error('Leverage#'+ script.name +' should not be overriden by lua files');
    }

    obj[script.name] = function evals() {
      var args = slice.call(arguments, 0);
      return this._.seval(script, args);
    };

    //
    // Reset the function name to the name of the script which will hopefully
    // improve stack traces.
    //
    obj[script.name].name = script.name;
  });

  return scripts;
};

/**
 * Try to figure out how many KEYS and ARGS the given lua scripts expects so we
 * can properly execute it. Returns an object with the amount of KEYS and ARGV's
 * we've detected in the script.
 *
 * @param {String} lua lua code snippet
 * @returns {Object}
 * @api private
 */
Leverage.parse = function parse(lua) {
  var matches = []
    , comment;

  //
  // First step:
  //
  // Iterate over the lines to find lines that probably have an ARGV or KEYS.
  //
  lua.split('\n').forEach(function linework(line) {
    var ARGV = /ARGV\[[^\[]+?\]/gm
      , KEYS = /KEYS\[[^\[]+?\]/gm;

    if (~line.indexOf('--[[')) return comment = true;
    if (~line.indexOf('--]]')) return comment = false;

    if (comment || /^\-\-/g.test(line)) return;

    if (ARGV.test(line)) matches.push({ line: line, type: 'ARGV', parser: ARGV });
    if (KEYS.test(line)) matches.push({ line: line, type: 'KEYS', parser: KEYS });
  });

  //
  // Second step:
  //
  // Eliminate the duplicates so we actually know how many KEYS and ARGV's the
  // scripts expects.
  //
  var set = matches.reduce(function count(found, match) {
    match.line.match(match.parser).forEach(function each(thingy) {
      if (~found[match.type].indexOf(thingy)) return;

      return found[match.type].push(thingy);
    });

    return found;
  }, { KEYS: [], ARGV: [] });

  //
  // Third step:
  //
  // Just return the shit.
  //
  return {
    KEYS: set.KEYS.length,
    ARGV: set.ARGV.length
  };
};

/**
 * Generates a JavaScript method compatible name from the given filename.
 *
 * @param {String} file The filename, including .lua
 * @returns {String} The generated method name
 * @api private
 */
Leverage.method = function method(file) {
  return file.slice(0, -4).toLowerCase().replace(/[^a-z\d]/g, '');
};

//
// This is where all the magic is happening, we are scanning for some
// pre-defined folders in search of the API methods we want to introduce to
// expose the lua scripts. We assume that it's either in a special `lua` or
// `leverage` folder. We check if these folders exist and if they do they get
// introduced as methods using the `Leverage.introduce` method.
//
Leverage.scripts = [
  path.join(__dirname, 'lua'),
  path.join(__dirname, 'leverage'),
  path.join(__dirname, '../..', 'lua'),
  path.join(__dirname, '../..', 'leverage')
].filter(function filter(directory) {
  var lstat;

  //
  // Make sure that these directories really exists as we are just guessing here
  // and hoping that they have a folder where we can generate API methods from.
  //
  try { lstat = fs.lstatSync(directory); }
  catch (e) { return false; }

  // Ensure it's really a directory.
  return lstat.isDirectory();
}).reduce(function flatten(scripts, directory) {
  Array.prototype.push.apply(
    scripts,
    Leverage.introduce(directory, Leverage.prototype)
  );

  return scripts;
}, []);

//
// Expose the module.
//
module.exports = Leverage;
