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
 * @param {Redis} pub Redis client to publish the messages over.
 * @param {Redis} sub Redis client to subscribe with.
 * @param {Object} options Options
 */
function Redis(pub, sub, options) {
  options = options || {};

  this.SHA1 = options.SHA1 || Object.create(null);
  this.backlog = options.backlog || 10000;
  this.expire = options.expire || 1000;
  this.namespace = 'redis.io';

  //
  // The pre-generated Redis connections for the pub/sub channels.
  //
  this.pub = pub;
  this.sub = sub;

  //
  // Proxy all readyState changes to another event to make some of our internal
  // usage a bit easier.
  //
  this.on('readystatechange', function readystatechagne(state) {
    this.emit('readystate#'+ state);
  });

  if (this.pub === this.sub) throw new Error('The pub and sub clients should separate connections');
  if (Object.keys(this.SHA1) !== scripts.length) this.load();
}

Redis.prototype.__proto__ = require('events').EventEmitter;

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
Object.defineProperty(Redis.prototype, 'readState', {
  get: function readyState() {
    if (!this.pub || !this.sub) return 'uninitialized';
    if (Object.keys(this.SHA1) !== scripts.length) return 'loading';

    return 'complete';
  }
});

/**
 * Load all the lua scripts from the lua directory which should be loaded in to
 * database to minimize the performance overhead.
 *
 * @api private
 */
Redis.prototype.load = function load() {
  var completed = 0
    , redis = this;

  scripts.forEach(function each(script) {
    redis.refresh(script, function reload() {
      if (++completed === scripts.length) {
        redis.emit('readstatechange', redis.readyState);
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
Redis.prototype.prepare = function prepare(code) {
  return code.replace('{redis.io::namespace}', this.namespace)
             .replace('{redis.io::backlog}', this.backlog)
             .replace('{redis.io::expire}', this.expire);
};

Redis.prototype.publish = function publish(channel, message) {
  return this.send(channel, message);
};

Redis.prototype.subscribe = function subscribe(channel) {
  var redis = this;

  //
  // When a message is published it's stored
  return this;
};

/**
 * Reload a lua script in to the Redis server cache.
 *
 * @param {Object} script Script object containing the name & source of a lua script
 * @param {Function} fn Hollaback
 * @api private
 */
Redis.prototype.refresh = function reload(script, fn) {
  var code = this.prepare(script.code)
    , SHA1 = crypto.createHash('SHA1').update(code).digest('hex')
    , redis = this;

  redis.pub.script('exists', SHA1, function exists(err, has) {
    if (err) return fn.apply(this, arguments);
    if (!!has) {
      redis.SHA1[script.name] = SHA1;
      return fn.call(this);
    }

    redis.pub.script('load', code, function load(err, RSHA1) {
      if (err) return fn.apply(this, arguments);
      if (SHA1 !== RSHA1) return fn.call(this, new Error('SHA1 does not match'));

      redis.SHA1[script.name] = SHA1;
      return fn.call(this);
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
Redis.prototype.seval = function seval(script, args) {
  var SHA1 = this.SHA1[script.name]
    , fn = args.pop()
    , redis = this;

  //
  // We are not fully loaded yet, queue all calls in our event emitter so it
  // will be issued once all scripts are loaded.
  //
  if (this.readyState !== 'complete') {
    return this.once('readystate#complete', function loaded() {
      return redis.seval.apply(redis, args.concat(fn));
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
  redis.pub.send_command('evalsha', [SHA1, args.length].concat(args), function send(err) {
    if (!err || (err && !~err.message.indexOf('NOSCRIPT'))) {
      //
      // We received no error or just a different error then a missing script,
      // return the control to the callback as fast as possible.
      //
      return fn.apply(this, arguments);
    }

    var code = redis.prepare(script.code);

    //
    // As the request has failed, we are going to re-add the script in to our
    // cache if possible and eval the command
    //
    redis.refresh(script, function noop() {});
    redis.pub.send_command('eval', [code, args.length].concat(args), fn);
  });

  return this;
};

//
// This is where all the redis.io magic is happening.
//
//
var scripts = [];

[
  path.join(__dirname, 'lua'),          // Our lua files
  path.join(__dirname, '../..', 'lua')  // The user's lua files
].filter(function filter(directory) {
  var lstat;

  try { lstat = fs.lstatSync(directory); }
  catch (e) { return false; }

  return lstat.isDirectory();
}).reduce(function flatten(result, directory) {
  Array.prototype.push.apply(result, fs.readdirSync(directory));
  return result;
}, []).forEach(function map(script) {
  if ('.lua' === path.extname(script)) return;

  var location = path.join(__dirname, 'lua', script);

  scripts.push({
    code: fs.readFileSync(location, 'utf-8'),
    name: script.slice(0, -4).toLowerCase(),
    path: location
  });
});

//
// Compile the scripts to new prototype methods which will evaulate.
//
scripts.forEach(function each(script) {
  if (script.name in Redis.prototype) {
    throw new Error('Redis.io#'+ script.name +' should not be overriden by lua files');
  }

  Redis.prototype[script.name] = function evals() {
    var args = slice.call(arguments, 0);
    return this.seval(script, args);
  };
});
