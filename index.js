'use strict';

var crypto = require('crypto')
  , path = require('path')
  , fs = require('fs');

//
// Speed up references to Array.prototype.slice which is used for argument
// conversion.
//
var slice = Array.prototype.slice;

/**
 *
 * @param {Redis} client Redis client to publish the messages over.
 * @param {Redis} sub Redis client to subscribe with.
 * @param {Object} options Options
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
  // want to make sure that we don't polute this namespace to much. That's why
  // we've decided to move most of our internal logic in to a `._` private
  // object that contains most of our logic. This way we only have a small
  // number prototypes and properties that should not be overriden by scripts.
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
    // The amount of items we should log for our pub/sub
    //
    backlog: {
      value: options.backlog || 10000
    },

    //
    // How many seconds should the item stay alive in our backlog.
    //
    expire: {
      value: options.expire || 1000
    },

    //
    // The pre-configured & authenticated redis client that is used to send
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

Leverage.prototype.publish = function publish(channel, message, fn) {
  return this.send(channel, message);
};

Leverage.prototype.subscribe = function subscribe(channel) {
  var redis = this;

  this._.sub.subscribe(channel);
  this._.sub.on('message', function message(channel, packet) {
    try { packet = JSON.parse(packet); }
    catch (e) {}

    //
    // Check if we are missing a packet so we can retrieve it if we want to
    // maintain order.
    //
    var id = packet.id;
  });

  return this;
};

/**
 * Destroy leverage and it's attached redis connections.
 *
 * @api private
 */
Leverage.prototype.destroy = function destroy() {
  if (this.client) this.client.quit();
  if (this.sub) this.sub.quit();
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
};

/**
 * Apply our configuration to the scripts by simply replacing some of our
 * template placeholders with the correct values. This way we can easily
 * configure our lua scripts through redis without having to constantly
 * rewrite our lua scripts when a namespace changes for example.
 *
 * @param {String} code LUA code snippet
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
    // parsed by the redis client so we are using this flaky check.
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
 * Safely eval a given redis script.
 *
 * @param {Object} script
 * @api private
 */
Leverage.seval = function seval(script, args) {
  var SHA1 = this._.SHA1[script.name]
    , leverage = this
    , fn = args.pop();

  //
  // We are not fully loaded yet, queue all calls in our event emitter so it
  // will be issued once all scripts are loaded.
  //
  if (this.readyState !== 'complete') {
    return this.once('readystate#complete', function loaded() {
      return leverage._.seval.apply(leverage, args.concat(fn));
    });
  }

  //
  // 1. Try to execute the script by calling the evalsha command as we assume
  //    that script was initialized when our constructor got initialised.
  //
  // 2. When we receive a NOERROR error we are going to re-load the script in
  //    our cache and issue a regular eval in paralell so we still get our
  //    results. This way the next call will be cached.
  //
  leverage._.client.send_command(
    'evalsha',
    [SHA1, script.args.KEYS || args.length].concat(args),
    function send(err) {
      if (!err || (err && !~err.message.indexOf('NOSCRIPT'))) {
        //
        // We received no error or just a different error then a missing script,
        // return the control to the callback as fast as possible.
        //
        return fn.apply(this, arguments);
      }

      var code = leverage._.prepare(script.code);

      //
      // As the request has failed, we are going to re-add the script in to our
      // cache if possible and eval the command
      //
      leverage._.refresh(script, function noop() {});
      leverage._.client.send_command('eval', [code, args.length].concat(args), fn);
    }
  );

  return this;
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
      return this.seval(script, args);
    };

    //
    // Reset the function name to the name of the script which will hopefully
    // improve stacktraces.
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
 * @param {String} lua LUA code snippet
 * @returns {Object}
 * @api private
 */
Leverage.parse = function parse(lua) {
  var ARGV = /ARGV\[[^\[]+?\]/g
    , KEYS = /KEYS\[[^\[]+?\]/g
    , matches = []
    , comment;

  //
  // Iterate over the lines to parse out the
  //
  lua.split('\n').forEach(function linework(line) {
    if (~line.indexOf('--[[')) return comment = true;
    if (~line.indexOf('--]]')) return comment = false;

    if (comment || /^\--/g.test(line)) return;

    if (ARGV.test(line)) matches.push({ line: line, type: 'ARGV', parser: ARGV });
    if (KEYS.test(line)) matches.push({ line: line, type: 'KEYS', parser: KEYS });
  });

  return matches.reduce(function count(found, match) {
    found[match.type] = found[match.type] + match.line.match(match.parser).length;

    return found;
  }, { KEYS: 0, ARGV: 0 });
};

/**
 * Generates a JavaScript method compatible name from the given filename.
 *
 * @param {String} file The filename, including .lua
 * @returns {String} The generated method name
 * @api private
 */
Leverage.method = function method(file) {
  return file.slice(0, -4).toLowerCase().replace(/[^a-z]/g, '');
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
