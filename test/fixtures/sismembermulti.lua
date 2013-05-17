-- Is an item in any of several sets? Call with:
-- EVALSHA <hash> n set1 set2 ... setn key
for i=1,#KEYS do
   if redis.call('sismember', KEYS[i], ARGV[1]) == 1 then
      return 1
   end
end
return 0
