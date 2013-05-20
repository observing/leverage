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
local messages = {}

if retrieve > 0 then
  local position = id - retrieve

  while position <= id do 
    table.insert(messages, namespace ..'::'.. channel ..'::backlog::'.. position)
    position = position + 1
  end

  messages = redis.call('mget', unpack(messages))
end

--
-- Return all the found things
--
return cjson.encode({
  id       = id,
  messages = messages
})
