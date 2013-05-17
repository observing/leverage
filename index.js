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

  this.namespace = options.namespace || 'leverage';
  this.SHA1 = options.SHA1 || Object.create(null);
  this.backlog = options.backlog || 10000;
  this.expire = options.expire || 1000;

  //
  // The pre-generated Redis connections for the pub/sub channels.
  //
  this.client = client;
  this.sub = sub;

  //
  // Proxy all readyState changes to another event to make some of our internal
  // usage a bit easier.
  //
  this.on('readystatechange', function readystatechagne(state) {
    this.emit('readystate#'+ state);
  });

  if (this.client === this.sub) {
    throw new Error('The pub and sub clients should separate connections');
  }

  if (Object.keys(this.SHA1) !== Leverage.scripts.length) this.load();
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
    if (!this.client) return 'uninitialized';
    if (Object.keys(this.SHA1).length !== Leverage.scripts.length) return 'loading';

    return 'complete';
  }
});

/**
 * Load all the lua scripts from the lua directory which should be loaded in to
 * database to minimize the performance overhead.
 *
 * @api private
 */
Leverage.prototype.load = function load() {
  var leverage = this
    , completed = 0;

  Leverage.scripts.forEach(function each(script) {
    leverage.refresh(script, function reload(err) {
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
Leverage.prototype.prepare = function prepare(code) {
  return code.replace('{leverage::namespace}', this.namespace)
             .replace('{leverage::backlog}', this.backlog)
             .replace('{leverage::expire}', this.expire);
};

Leverage.prototype.publish = function publish(channel, message, fn) {
  return this.send(channel, message);
};

Leverage.prototype.subscribe = function subscribe(channel) {
  var redis = this;

  this.sub.subscribe(channel);
  this.sub.on('message', function message(channel, packet) {
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
 * Reload a lua script in to the Redis server cache.
 *
 * @param {Object} script Script object containing the name & source of a lua script
 * @param {Function} fn Hollaback
 * @api private
 */
Leverage.prototype.refresh = function reload(script, fn) {
  var code = this.prepare(script.code)
    , SHA1 = crypto.createHash('SHA1').update(code).digest('hex').toString()
    , leverage = this;

  leverage.client.script('exists', SHA1, function exists(err, has) {
    if (err) return fn.apply(this, arguments);

    //
    // For some odd reason, the `scripts exists SHA` response isn't properly
    // parsed by the redis client so we are using this flaky check.
    // See mranney/node_redis#436 for the reported issue.
    //
    if ((Array.isArray(has) && has[0]) || has) {
      leverage.SHA1[script.name] = SHA1;
      return fn.call(this);
    }

    leverage.client.script('load', code, function load(err, RSHA1) {
      if (err) return fn.apply(this, arguments);
      if (SHA1 !== RSHA1) return fn.call(this, new Error('SHA1 does not match'));

      leverage.SHA1[script.name] = SHA1;
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
Leverage.prototype.seval = function seval(script, args) {
  var SHA1 = this.SHA1[script.name]
    , leverage = this
    , fn = args.pop();

  //
  // We are not fully loaded yet, queue all calls in our event emitter so it
  // will be issued once all scripts are loaded.
  //
  if (this.readyState !== 'complete') {
    return this.once('readystate#complete', function loaded() {
      return leverage.seval.apply(leverage, args.concat(fn));
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
  leverage.client.send_command('evalsha', [SHA1, args.length].concat(args), function send(err) {
    if (!err || (err && !~err.message.indexOf('NOSCRIPT'))) {
      //
      // We received no error or just a different error then a missing script,
      // return the control to the callback as fast as possible.
      //
      return fn.apply(this, arguments);
    }

    var code = leverage.prepare(script.code);

    //
    // As the request has failed, we are going to re-add the script in to our
    // cache if possible and eval the command
    //
    leverage.refresh(script, function noop() {});
    leverage.client.send_command('eval', [code, args.length].concat(args), fn);
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

    var location = path.join(directory, script);

    scripts.push({
      code: fs.readFileSync(location, 'utf-8'),
      name: Leverage.method(script),
      path: location
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
