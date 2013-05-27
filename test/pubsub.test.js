describe('Leverage (reliable pubsub)', function () {
  'use strict';

  var common   = require('./common')
    , Leverage = common.Leverage
    , leverage = common.leverage
    , expect   = common.expect
    , redis    = common.redis
    , kill     = common.kill;

  describe('#subscribe', function () {
    it('should emit an `<channel>::online` event once the subscriber is ready', function (done) {
      var pubsub = leverage(true);

      pubsub.subscribe('meh').on('meh::online', function (id) {
        expect(id).to.be.a('number');

        pubsub.destroy();
        done();
      });
    });

    describe('ordered', function () {
      it('maintains order when the subscription is dropped', function (done) {
        this.timeout(10000);

        var pubsub = leverage(true)
          , timeout
          , id = 0;

        pubsub.subscribe('<channelname>', {
          ordered: true,
          replay: 0
        }).on('<channelname>::message', function (msg, msgid) {
          expect(msg).to.be.a('string');
          expect(msgid).to.be.a('number');
          expect(msg).to.equal('omg pubsub');

          clearTimeout(timeout);

          if (id && id + 1 !== msgid) {
            throw new Error('The message are out of order');
          }

          timeout = setTimeout(function () {
            throw new Error('Pub/Sub response was not received in a timely manner');
          }, 500);
        });

        var publish = setInterval(function publish() {
          pubsub.publish('<channelname>', 'omg pubsub');
        }, 50);

        setTimeout(function murder() {
          kill('subscribe', function murdered(err) {
            if (err) return done(err);

            setTimeout(function alive() {
              clearInterval(publish);
              pubsub.destroy();

              done();
            }, 2000);
          });
        }, 2000);
      });
    });
  });

  describe('#unsubscribe', function () {
    it('should unsubscribe from the channel', function (done) {
      var pubsub = leverage(true);

      pubsub.subscribe('really', { replay: 0 });
      pubsub.once('really::online', function () {
        pubsub.on('really::message', function (msg) {
          expect(msg).to.equal('foo');

          pubsub.unsubscribe('really', function (err) {
            expect(err).to.not.be.instanceOf(Error);

            pubsub.publish('really', 'bar', done);
          });
        });

        pubsub.publish('really', 'foo');
      });
    });

    it('should emit an `<channelname>::unsubscribe` event', function (done) {
      var pubsub = leverage(true);

      pubsub.subscribe('meh');
      pubsub.once('meh::online', function () {
        pubsub.once('meh::unsubscribe', done);
        pubsub.unsubscribe('meh', function (err) {
          expect(err).to.not.be.instanceOf(Error);

          pubsub.destroy();
        });
      });
    });
  });
});
