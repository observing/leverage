'use strict';

var Leverage = require('../')
  , chai = require('chai')
  , expect = chai.expect;

//
// Include the damned stacktraces when shit breaks.
//
chai.Assertion.includeStack = true;

/**
 * Generate a new Redis client.
 *
 * @returns {Redis} The pre-configured redis client.
 * @api private
 */
function redis() {
  var client = require('redis').createClient(
    +process.env.REDIS_PORT || 6379,          // Read the port from the ENV vars
    +process.env.REDIS_HOST || '127.0.0.1'    // Read the host from the ENV vars
  );

  //
  // Authenticate when needed.
  //
  if (process.env.REDIS_AUTH) client.auth(process.env.REDIS_AUTH);

  return client;
}

/**
 * Generate a pre-wrapped leverage instance.
 *
 * @param {Boolean} pubsub Generate pubsub.
 * @param {Object} options Options for Leverage.
 * @api private
 */
function leverage(pubsub, options) {
  options = options || {};

  if (pubsub) return new Leverage(redis(), redis(), options);
  return new Leverage(redis(), options);
}

/**
 * Kills Redis connections for the last issued command.
 *
 * @param {String} cmd The command, lowercase
 * @param {Function} cb The callback to issue the kill
 */
function kill(cmd, cb) {
  var client = redis();

  return client.client('list', function list(err, data) {
    if (err) {
      client.quit();
      return cb(err);
    }

    //
    // Parse the client response because the `redis` client can't parse it.
    //
    data = data.split('\n').filter(Boolean).map(function linefeed(data) {
      return data.split(' ').reduce(function parser(set, line) {
        var kv = line.split('=');
        set[kv[0]] = kv[1].trim();

        return set;
      }, {});
    }).filter(function figureout(data) {
      return data.cmd === cmd;
    });

    if (data[0]) return client.client('kill', data[0].addr, function idontcare() {
      client.quit();
      cb.apply(this, arguments);
    });

    client.quit();
    cb(new Error('No connections matching the given command'));
  });
}

//
// Expose the methods.
//
exports.kill = kill;
exports.redis = redis;
exports.expect = expect;
exports.leverage = leverage;
exports.Leverage = Leverage;
