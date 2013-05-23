'use strict';

//
// Parse the process arguments
//
var argh = require('argh').argv;

//
// Setup the clients.
//
var Leverage = require('../')
  , redis = require('redis')
  , port = +argh.port || 6379
  , host = argh.host || 'localhost'
  , id = 0;

//
// Check if we are in kill mode, we need to hunt down the subscription client
// and kill it to simulate a network breakdown or connection failure.
//
if (argh.kill) {
  var client = redis.createClient(port, host);

  return client.client('list', function (err, data) {
    if (err) return process.exit(1);

    //
    // Parse the client response because the `redis` client can't parse it
    //
    data = data.split('\n').filter(Boolean).map(function parse(data) {
      return data.split(' ').reduce(function (set, line) {
        var kv = line.split('=');
        set[kv[0]] = kv[1].trim();

        return set;
      }, {});
    }).filter(function figureout(data) {
      return data.cmd === 'subscribe';
    });

    client.client('kill', data[0].addr, function (err) {
      process.exit(err ? 1 : 0);
    });
  });
}

//
// Setup our leverage instance and provide it with a cmd and subscription
// client.
//
var leverage = new Leverage(
  redis.createClient(port, host),
  redis.createClient(port, host)
);

var missing = {}
  , tracked;

leverage.subscribe('channel', {
  ordered: 'ordered' in argh ? argh.ordered : false,
  replay:  'replay'  in argh ? argh.replay  : 0
}).on('channel::message', function message(msg, pid) {
  if (id && id + 1 !== pid) {
    console.log('The process has gone out of sync and is missing %d messages', pid - id);
    console.log('The last id received was %d but ive been given %d', id, pid);

    //
    // Track messages that were missing
    //
    if (!tracked) {
      var now = id;
      tracked = true;

      while (now !== pid) {
        missing[++now] = true;
      }
    }
  }

  id = pid;

  if (id % 10 === 0) console.log('Received %d messages through Pub/Sub', pid);

  if (Object.keys(missing).length) {
    delete missing[pid];

    if (!Object.keys(missing).length) {
      console.log('Received all messages from when our process went out of sync');
      tracked = false;
    } else {
      console.log('Missing', missing);
    }
  }
});

//
// Track potential error message througout the Pub/Sub shizzle.
//
leverage.on('channel::error', function error(err) {
  console.errror('[channel::errror] '+ err.message);
});

setInterval(function () {
  leverage.publish('channel', 'sup'+ id);
}, 100);
