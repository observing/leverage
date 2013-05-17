local current = redis.call('GET', KEYS[1])
if current == ARGV[1]
then
  return redis.call('SET', KEYS[1], ARGV[2])
end
return false
