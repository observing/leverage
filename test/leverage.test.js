describe('Leverage', function () {
  'use strict';

  var common   = require('./common')
    , Leverage = common.Leverage
    , leverage = common.leverage
    , expect   = common.expect
    , redis    = common.redis;

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
    expect(Leverage.scripts).to.have.length(2);
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
        , out = 'whatth3fuckisgoingonhere';

      expect(Leverage.method(name)).to.equal(out);
    });
  });

  describe('.parse', function () {
    var fs = require('fs');

    var unfail = fs.readFileSync(__dirname + '/fixtures/unfail.lua', 'utf8')
      , ratelimit = fs.readFileSync(__dirname + '/fixtures/ratelimit.lua', 'utf8')
      , cas = fs.readFileSync(__dirname + '/fixtures/cas.lua', 'utf8');

    it('correctly detects duplicate KEYS and ARGS', function () {
      var stats = Leverage.parse(cas);

      expect(stats.ARGV).to.equal(2);
      expect(stats.KEYS).to.equal(1);

      stats = Leverage.parse(ratelimit);

      expect(stats.ARGV).to.equal(2);
      expect(stats.KEYS).to.equal(1);

      stats = Leverage.parse(unfail);

      expect(stats.ARGV).to.equal(4);
      expect(stats.KEYS).to.equal(0);
    });
  });

  describe('._.prepare', function () {
    it('replaces the template variables in the given content', function () {
      var client = leverage()
        , template = 'namespace: {leverage::namespace}, backlog: {leverage::backlog}, expire: {leverage::expire}';

      expect(client._.prepare(template)).to.equal('namespace: leverage, backlog: 100000, expire: 1000');
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
