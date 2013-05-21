--
-- Default values that are changed by our pre-processor.
--
local namespace = '{leverage::namespace}'

--
-- Script arguments.
--
local channel = assert(KEYS[1], 'The channel key is missing')
local from = assert(tonumber(ARGV[1]), 'The from argument is missing or NaN')
local to = assert(tonumber(ARGV[2]), 'The to argument is missing or NaN')
local messages = {}

while from < to do
  table.insert(messages, namespace ..'::'.. channel ..'::backlog'.. from)
  from = from + 1
end

return redis.call('mget', unpack(messages))
