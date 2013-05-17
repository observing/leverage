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

    expect(new Leverage(client, { namespace: 'foo' })._.namespace).to.equal('foo');
    expect(new Leverage(client, null, { namespace: 'bar'})._.namespace).to.equal('bar');

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

    client.destroy();
  });

  it('exposes the generated scripts', function () {
    expect(Leverage.scripts).to.have.length(1);
  });

  it('sets the readyState and emits readystatechange events', function (done) {
    var client = leverage();

    expect(client.readyState).to.equal('loading');

    client.once('readystatechange', function change(state) {
      expect(state).to.equal(client.readyState);
      expect(state).to.equal('complete');

      client.destroy();
      done();
    });
  });

  it('loads the scripts in to the redis server', function (done) {
    var client = leverage();

    client.once('readystate#complete', function () {
      expect(Object.keys(client._.SHA1).length).to.equal(Leverage.scripts.length);

      client.destroy();
      done();
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

  describe('._.prepare', function () {
    it('replaces the template variables in the given content', function () {
      var client = leverage()
        , template = 'namespace: {leverage::namespace}, backlog: {leverage::backlog}, expire: {leverage::expire}';

      expect(client._.prepare(template)).to.equal('namespace: leverage, backlog: 10000, expire: 1000');
      client.destroy();
    });

    it('ignores unknown template variables', function () {
      var client = leverage()
        , template = 'namespace: {leverage::namespace}, foo: {leverage::foo}';

      expect(client._.prepare(template)).to.equal('namespace: leverage, foo: {leverage::foo}');
      client.destroy();
    });
  });
});
