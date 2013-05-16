describe('Leverage', function () {
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
});
