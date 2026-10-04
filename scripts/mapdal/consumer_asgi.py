"""Bounded signed consumer endpoint plus explicit host-worker entrypoint."""
import asyncio
import time
from consumer_bridge import MAX_BODY,PREFIX,dumps

class ConsumerASGI:
 def __init__(self,bridge,transport=None):self.bridge,self.transport=bridge,transport
 async def __call__(self,scope,receive,send):
  if scope['type']!='http':return
  status,result=400,{'status':'rejected','code':'invalid_request'}
  try:
   pairs=[(k.decode('latin1').lower(),v.decode('latin1')) for k,v in scope.get('headers',[])];headers=dict(pairs)
   checked=['content-type','content-length','x-collective-timestamp','x-collective-nonce','x-collective-signature']
   if any(sum(k==name for k,_ in pairs)>1 for name in checked) or scope.get('query_string') or 'transfer-encoding' in headers:raise ValueError()
   if headers.get('content-type','').split(';')[0]!='application/json':status=415;raise ValueError()
   body=bytearray();deadline=time.monotonic()+10
   while True:
    event=await asyncio.wait_for(receive(),timeout=max(0,deadline-time.monotonic()))
    if event['type']!='http.request':raise ValueError()
    body.extend(event.get('body',b''))
    if len(body)>MAX_BODY:status=413;raise ValueError()
    if not event.get('more_body',False):break
   if 'content-length' in headers and int(headers['content-length'])!=len(body):raise ValueError()
   if not scope['path'].startswith(PREFIX):status=404;raise ValueError()
   status,result=await asyncio.to_thread(self.bridge.handle,scope['method'],scope['path'],headers,bytes(body))
  except (ValueError,KeyError,asyncio.TimeoutError):pass
  await send({'type':'http.response.start','status':status,'headers':[(b'content-type',b'application/json'),(b'cache-control',b'no-store')]})
  await send({'type':'http.response.body','body':dumps(result).encode()})
 def work_once(self):
  """Host scheduler calls explicitly. One new dispatch + one GET-only recovery.

  Installation alone cannot attest purpose notice or transport credentials. If no
  transport exists, keep accepted outbox entries untouched and report blocked.
  """
  if self.transport is None:return {'status':'blocked','reason':'delivery_transport_not_installed'}
  self.transport.check();store=self.bridge.store;tenant,shop=self.bridge.tenant,self.bridge.shop
  with store.db() as c:
   store._scope(c,tenant,shop)
   def next_row(queue):
    cursor=c.one('SELECT last_id FROM collective_consumer_cursor WHERE tenant=? AND store=? AND queue=?',(tenant,shop,queue))
    last=cursor['last_id'] if cursor else ''
    row=c.one('SELECT id FROM collective_consumer_outbox WHERE tenant=? AND store=? AND status=? ORDER BY CASE WHEN id>? THEN 0 ELSE 1 END,id LIMIT 1',(tenant,shop,queue,last))
    if row:c.exec('INSERT INTO collective_consumer_cursor VALUES(?,?,?,?) ON CONFLICT(tenant,store,queue) DO UPDATE SET last_id=excluded.last_id',(tenant,shop,queue,row['id']))
    return row
   pending=next_row('accepted');unknown=next_row('unknown')
  dispatched=store.deliver(tenant,shop,pending['id'],self.transport.send) if pending else None
  recovered=store.reconcile(tenant,shop,unknown['id'],self.transport.lookup) if unknown else None
  return {'status':'processed' if pending or unknown else 'idle','dispatched':dispatched,'recovered':recovered}
