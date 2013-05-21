describe('lua', function () {
  'use strict';

  var common   = require('./common')
    , Leverage = common.Leverage
    , leverage = common.leverage
    , expect   = common.expect
    , redis    = common.redis;

  describe('range', function () {
    it('should fetch the results for the given channel');
    it('fetches the items in the specified range');
  });

  describe('publish', function () {
    it('should only retrieve messages for the given channel');
    it('should increase and return the private counter');
    it('should add message as JSON to the backlog');
    it('should publish the message');
    it('should reset the counter if it exceeds the backlog');
    it('should automatically expire the set messages from the backlog');
  });

  describe('subscribe', function () {
    it('should retrieve the current id');
    it('should retrieve the specified amount of channel messages');
  });
});
