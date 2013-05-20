'use strict';

var Leverage = require('../')
  , redis = require('redis');

//
// Setup our leverage instance and provide it with a cmd and subscription
// client.
//
var leverage = new Leverage(redis.createClient(), redis.createClient())
  , id = 0;

leverage.subscribe('channel').on('channel::message', function message(msg, pid) {
  id = pid;

  console.log('Message subscription: %d, %s', id, msg);
});

setInterval(function () {
  leverage.publish('channel', 'sup'+ id);
}, 100);
