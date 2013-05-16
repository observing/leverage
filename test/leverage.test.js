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

  it('correctly applies the given options', function (done) {
    var client = redis();

    expect(new Leverage(client, { namespace: 'foo' }).namespace).to.equal('foo');
    expect(new Leverage(client, null, { namespace: 'bar'}).namespace).to.equal('bar');

    client.quit(done);
  });

  it('exposes files from our lua directory as methods', function () {
    var path = require('path')
      , client = leverage()
      , fs = require('fs');

    fs.readdirSync(path.join(__dirname, '..', 'lua')).forEach(function forEach(file) {
      var method = Leverage.method(file);

      expect(client[method]).to.be.a('function');
    });
  });

  describe('.method', function () {
    it('strips the .lua extension from the given file name', function () {
      expect(Leverage.method('fml.lua')).to.equal('fml');
    });

    it('lowercases everything', function () {
      expect(Leverage.method('FmL.lua')).to.equal('fml');
    });

    it('removes dots, dashes, number and all other wierdshit', function () {
      var name = 'What Th3 fuck is-going.on.here.lua'
        , out = 'whatthfuckisgoingonhere';

      expect(Leverage.method(name)).to.equal(out);
    });
  });
});
