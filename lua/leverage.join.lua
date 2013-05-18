--
-- Default values that are changed by our pre-processor.
--
local namespace = '{leverage::namespace}'
local backlog = {leverage::backlog}

--
-- Script arguments.
--
local channel = assert(KEYS[1], 'The channel key is missing')
local retrieve = assert(tonumber(ARGV[1]), 'The retrieve amount is missing or NaN')

--
-- Retrieve the current message id so we can figure out which id's we need to
-- retrieve.
--
local id = tonumber(redis.call('get', namespace ..'::'.. channel ..'::msg-id')) or 0
local mget = {}

for i = id, retrieve, -1 do
  mget[i] = namespace ..'::'.. channel ..'::backlog::'.. id
end

--
-- Return all the found things
--
return cjson.encode({
  id       = id,
  messages = redis.call('mget', mget)
})
