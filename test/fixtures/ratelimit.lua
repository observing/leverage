cnt = redis.call('INCR', KEYS[1])
if cnt > ARGV[1]
then
  return 1
end
if cnt == 1
then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
