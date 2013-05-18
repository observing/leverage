--
-- Some default values that get automatically replaced by our script
-- pre-processor in the Leverage library. This allows us maintain control over
-- the output using JavaScript, which is __a w e s o m e__.
--

local namespace = '{leverage::namespace}'
local backlog = {leverage::backlog}
local expire = {leverage::expire}

--
-- The arguments that are recieved from the script.
--
local channel = assert(KEYS[1], 'The channel key is missing')
local message = assert(ARGV[1], 'The message argument is missing')

--
-- We increase the id to get a unique message id for this message.
--
local id = redis.call('incr', namespace ..'::'.. channel ..'::msg-id')

--
-- Our id exceeded the backlog, reset it, this way we also override our "old"
-- data and keep the database clean.
--
if id > backlog then
  id = redis.call('set', namespace ..'::'.. channel ..'::msg-id', 0)
end

--
-- Now that we've gathered all data we can do some magic persistance / relaiable
-- messaging. Add a backup of the data so it can be retrieved if we miss
-- a message. We are going to publish the message to the channel and include the
-- id of our message.
--
local packet = cjson.encode({
  message = message,
  id      = id
})

redis.call('setex', namespace ..'::'.. channel ..'::backlog::'.. id, expire, packet)
redis.call('publish', namespace ..'::'.. channel, packet)

return id
