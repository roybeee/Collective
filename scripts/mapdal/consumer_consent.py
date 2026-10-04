"""Authenticated exact-purpose consent SDK. No inferred grants or profile writes.

resolve_session must use host authentication and server-selected current order.
Notice content/version/period are operator configuration, not legal advice.
"""
import asyncio
from collections import deque
import hashlib
import hmac
import json
import threading
import time
import uuid
from consumer_storage_adapter import TYPES,seconds
from consumer_bridge import iso
PATH='/collective/consumer-consents/'
class Denied(Exception):
 def __init__(self,status):self.status=status

def require(ok,status=400):
 if not ok:raise Denied(status)

def unique(pairs):
 result={}
 for k,v in pairs:require(k not in result);result[k]=v
 return result

def notice_version(purpose,text,max_age_seconds):
 return hashlib.sha256(json.dumps({'purpose':purpose,'text':text,'maxAgeSeconds':max_age_seconds},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

class ConsumerConsentASGI:
 def __init__(self,db,is_pg,resolve_session,notices):
  if not isinstance(notices,dict) or set(notices)!=set(TYPES):raise ValueError('Both exact purpose notices required')
  for purpose,n in notices.items():
   if not isinstance(n,dict) or set(n)!={'version','text','maxAgeSeconds'} or not isinstance(n['version'],str) or len(n['version'])!=64 or not isinstance(n['text'],str) or not 1<=len(n['text'].strip())<=10000 or type(n['maxAgeSeconds']) is not int or not 1<=n['maxAgeSeconds']<=31536000:raise ValueError('Operator notice/version/period required')
   if n['version']!=notice_version(purpose,n['text'],n['maxAgeSeconds']):raise ValueError('Notice version must match exact purpose/text/period digest')
  self.db,self.lock,self.resolve,self.notices=db,' FOR UPDATE' if is_pg else '',resolve_session,json.loads(json.dumps(notices))
  self.rates={};self.mutex=threading.Lock()
 def _rate(self,customer):
  now=time.monotonic()
  with self.mutex:
   self.rates={k:q for k,q in self.rates.items() if q and q[-1]>now-60}
   require(customer in self.rates or len(self.rates)<4096,429)
   q=self.rates.setdefault(customer,deque())
   while q and q[0]<=now-60:q.popleft()
   require(len(q)<30,429);q.append(now)
 def _identity(self,c,ctx):
  args=(ctx['customerId'],ctx['memberId']);profile=c.one('SELECT id,status,withdrawn_at FROM customer_profiles WHERE id=?'+self.lock,(args[0],))
  identity=c.one('SELECT customer_id,member_id FROM auth_identities WHERE customer_id=? AND member_id=?'+self.lock,args)
  order=c.one('SELECT customer_id,member_id FROM orders WHERE order_id=?'+self.lock,(ctx['orderId'],))
  require(profile and profile['status']=='ACTIVE' and not profile['withdrawn_at'] and identity and order and order['customer_id']==args[0] and order['member_id']==args[1],403)
 def _state(self,c,ctx,purpose,now):
  n=self.notices[purpose];rows=c.all('SELECT member_id,policy_version,granted,source,created_at FROM consent_history WHERE customer_id=? AND consent_type=? ORDER BY created_at DESC LIMIT 1001',(ctx['customerId'],TYPES[purpose]))
  granted=False;expires=None
  if rows and len(rows)<=1000:
   try:
    latest=max(seconds(r['created_at']) for r in rows);current=[r for r in rows if seconds(r['created_at'])==latest]
    granted=latest<=now<latest+n['maxAgeSeconds'] and all(r['member_id']==ctx['memberId'] and r['policy_version']==n['version'] and r['granted']==1 and r['source'] in {'ACCOUNT','EMAIL_SIGNUP'} for r in current)
    if granted:expires=iso(latest+n['maxAgeSeconds'])
   except (ValueError,TypeError):pass
  return {'purpose':purpose,**n,'granted':granted,'expiresAt':expires}
 def _action(self,ctx,value):
  now=time.time()
  with self.db() as c:
   self._identity(c,ctx)
   if value is not None:
    purpose=value['purpose'];notice=self.notices[purpose];require(value['version']==notice['version'],409)
    # Only explicit user choice; never call host consent_record(MARKETING).
    c.exec('INSERT INTO consent_history(id,customer_id,member_id,consent_type,policy_version,granted,source,ip,created_at) VALUES(?,?,?,?,?,?,?,?,?)',(str(uuid.uuid4()),ctx['customerId'],ctx['memberId'],TYPES[purpose],notice['version'],1 if value['granted'] else 0,'ACCOUNT','',iso(now)))
   return {'purposes':[self._state(c,ctx,p,now) for p in TYPES]}
 async def _handle(self,scope,receive):
  require(scope.get('path')==PATH,404);method=scope.get('method');require(method in {'GET','POST'},405);require(not scope.get('query_string'))
  pairs=[(k.decode('latin1').lower(),v.decode('latin1')) for k,v in scope.get('headers',[])];headers=dict(pairs)
  for name in ('host','origin','x-csrf-token','content-length','content-type','sec-fetch-site'):require(sum(k==name for k,_ in pairs)<=1)
  require('transfer-encoding' not in headers)
  require(headers.get('host')=='mapdal.kr' and headers.get('sec-fetch-site')=='same-origin',403)
  require(headers.get('origin') in ({'https://mapdal.kr'} if method=='POST' else {None,'https://mapdal.kr'}),403)
  ctx=await self.resolve(scope)
  require(isinstance(ctx,dict) and set(ctx)=={'customerId','memberId','orderId','csrfToken'},401)
  require(all(isinstance(ctx[k],str) and 0<len(ctx[k])<=160 for k in ('customerId','memberId','orderId')),401)
  csrf=ctx['csrfToken'];provided=headers.get('x-csrf-token','');require(isinstance(csrf,str) and 24<=len(csrf)<=256 and hmac.compare_digest(csrf.encode(),provided.encode()),403)
  self._rate(ctx['customerId']);raw=bytearray()
  while True:
   event=await receive();require(event.get('type')=='http.request');raw.extend(event.get('body',b''));require(len(raw)<=1024,413)
   if not event.get('more_body',False):break
  if 'content-length' in headers:require(int(headers['content-length'])==len(raw))
  value=None
  if method=='POST':
   require(headers.get('content-type','').split(';')[0]=='application/json',415);value=json.loads(raw,object_pairs_hook=unique)
   require(isinstance(value,dict) and set(value)=={'purpose','granted','version'} and value['purpose'] in TYPES and type(value['granted']) is bool and isinstance(value['version'],str))
  else:require(not raw)
  return await asyncio.to_thread(self._action,ctx,value)
 async def __call__(self,scope,receive,send):
  if scope.get('type')!='http':return
  try:result=await asyncio.wait_for(self._handle(scope,receive),5);status=200
  except Denied as e:status,result=e.status,{'error':'consent_request_rejected'}
  except asyncio.TimeoutError:status,result=408,{'error':'consent_request_timeout'}
  except (ValueError,TypeError,KeyError):status,result=400,{'error':'invalid_request'}
  except Exception:status,result=503,{'error':'consent_unavailable'}
  await send({'type':'http.response.start','status':status,'headers':[(b'content-type',b'application/json'),(b'cache-control',b'no-store'),(b'x-content-type-options',b'nosniff')]})
  await send({'type':'http.response.body','body':json.dumps(result,ensure_ascii=False,separators=(',',':')).encode()})

def consumer_consent_factory(db,is_pg,resolve_session,notices):
 """No migration or writes at construction. Mount PATH, install host session hook."""
 return ConsumerConsentASGI(db,is_pg,resolve_session,notices)
