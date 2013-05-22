describe('lua', function () {
  'use strict';

  var common   = require('./common')
    , Leverage = common.Leverage
    , leverage = common.leverage
    , expect   = common.expect
    , redis    = common.redis;

  describe('publish', function () {
    it('should publish the message', function (done) {
      var client = leverage()
        , red = redis();

      red.subscribe('leverage::pub');
      red.on('message', function (channel, data) {
        expect(data).to.be.a('string');
        expect(channel).to.equal('leverage::pub');

        data = JSON.parse(data);

        expect(data.id).to.equal(1);
        expect(data.message).to.equal('lish');

        client.destroy();
        red.quit(done);
      });

      client.publish('pub', 'lish');
    });

    it('should only send messages for the given channel', function (done) {
      var client = leverage(true);

      client.subscribe('foos', { replay: 0 }).on('foos::message', function (msg, id) {
        expect(msg).to.equal('foo');
        expect(id).to.equal(1);

        client.destroy();
        done();
      });

      client.publish('foos', 'foo');
    });

    it('should increase and return the private counter', function (done) {
      var client = leverage()
        , red = redis();

      client.publish('foo', 'foo', function (err, id) {
        expect(err).to.not.be.instanceOf(Error);
        expect(id).to.equal(1);

        client.publish('foo', 'foo', function (err, ids) {
          expect(err).to.not.be.instanceOf(Error);
          expect(ids).to.equal(2);

          red.get('leverage::foo::msg-id', function (err, msgid) {
            expect(err).to.not.be.instanceOf(Error);
            expect(+msgid).to.equal(ids);

            client.destroy();
            red.quit(done);
          });
        });
      });
    });

    it('should add message as JSON to the backlog', function (done) {
      var client = leverage()
        , red = redis();

      client.publish('json', 'banana', function (err, id) {
        expect(err).to.not.be.instanceOf(Error);
        expect(id).to.equal(1);

        red.get('leverage::json::backlog::'+ id, function (err, data) {
          expect(err).to.not.be.instanceOf(Error);
          expect(data).to.be.a('string');

          data = JSON.parse(data);
          expect(data.id).to.equal(id);
          expect(data.message).to.equal('banana');

          client.destroy();
          red.quit(done);
        });
      });
    });

    it('should reset the counter if it exceeds the backlog');

    it('should automatically expire the set messages from the backlog');
  });

  describe('subscribe', function () {
    it('should retrieve the current id');
    it('should retrieve the specified amount of channel messages');
  });

  before(function after(done) {
    var client = redis();

    client.flushdb(function flush() {
      client.quit(done);
    });
  });
});
