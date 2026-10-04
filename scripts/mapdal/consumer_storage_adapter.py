"""Actual app.db/Cx consumer outbox. No consent is inferred or created here.

Host login integration must call bind_authenticated with member_required(request)
IDs, never browser-supplied IDs. It must separately collect the exact purpose
notice into consent_history; legacy MARKETING is insufficient. Transport stays
blocked until a trusted UUID-idempotent sender + cost-receipt lookup is installed.
"""
import datetime as dt
import hashlib
import hmac
import json
import time
import uuid
from consumer_bridge import UUID,HEX,ID,PURPOSES,iso,dumps,payload_digest,require,money,SQLiteConsumerStore,ConsumerBridge,CollectiveAuthorizationClient

TYPES={'post_purchase':'COLLECTIVE_POST_PURCHASE','marketing_reorder':'COLLECTIVE_MARKETING_REORDER'}
def seconds(value):
 d=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
 if d.tzinfo is None:d=d.replace(tzinfo=dt.timezone(dt.timedelta(hours=9)))
 return d.timestamp()

class MapdalConsumerStore:
 def __init__(self,db,is_pg,tenant,shop,mapping_key,policies,templates,authorize=None):
  require(ID.fullmatch(tenant) and ID.fullmatch(shop) and isinstance(mapping_key,str) and len(mapping_key)>=32)
  require(isinstance(policies,dict) and set(policies)<=PURPOSES and policies)
  for purpose,p in policies.items():require(set(p)=={'consentType','policyVersion','maxAgeSeconds'} and p['consentType']==TYPES[purpose] and isinstance(p['policyVersion'],str) and 0<len(p['policyVersion'])<=100 and type(p['maxAgeSeconds']) is int and 1<=p['maxAgeSeconds']<=31536000)
  require(isinstance(templates,dict) and templates)
  for key,t in templates.items():require(UUID.fullmatch(key) and set(t)=={'templateId','purpose','digest','maxCostKrw'} and t['purpose'] in policies and isinstance(t['templateId'],str) and 0<len(t['templateId'])<=100 and HEX.fullmatch(t['digest']) and money(t['maxCostKrw']))
  self.db,self.lock,self.tenant,self.shop,self.key,self.policies,self.templates,self.authorize=db,' FOR UPDATE' if is_pg else '',tenant,shop,mapping_key.encode(),json.loads(dumps(policies)),json.loads(dumps(templates)),authorize
 def check(self):
  with self.db() as c:
   for query in ['SELECT id,status,marketing_ok,withdrawn_at FROM customer_profiles LIMIT 0','SELECT customer_id,member_id FROM auth_identities LIMIT 0','SELECT id,customer_id,member_id,consent_type,policy_version,granted,source,created_at FROM consent_history LIMIT 0','SELECT order_id,customer_id,member_id FROM orders LIMIT 0','SELECT id,kind,template_id,body FROM notify_templates LIMIT 0']:c.exec(query)
 def migrate(self):
  self.check()
  with self.db() as c:
   for query in ['CREATE TABLE IF NOT EXISTS collective_consumer_cursor(tenant TEXT,store TEXT,queue TEXT,last_id TEXT,PRIMARY KEY(tenant,store,queue))','CREATE TABLE IF NOT EXISTS collective_consumer_scope(tenant TEXT,store TEXT,PRIMARY KEY(tenant,store))','CREATE TABLE IF NOT EXISTS collective_consumer_recipient(tenant TEXT,store TEXT,id TEXT,customer_key TEXT,customer_id TEXT,member_id TEXT,order_id TEXT,status TEXT,PRIMARY KEY(tenant,store,id),UNIQUE(tenant,store,customer_key,order_id))','CREATE TABLE IF NOT EXISTS collective_consumer_nonce(tenant TEXT,store TEXT,id TEXT,at BIGINT,PRIMARY KEY(tenant,store,id))','CREATE TABLE IF NOT EXISTS collective_consumer_outbox(tenant TEXT,store TEXT,id TEXT,digest TEXT,payload TEXT,status TEXT,receipt TEXT,max_cost BIGINT,cancel_pending INTEGER,PRIMARY KEY(tenant,store,id))']:c.exec(query)
   c.exec('INSERT INTO collective_consumer_scope VALUES(?,?) ON CONFLICT(tenant,store) DO NOTHING',(self.tenant,self.shop))
 def _scope(self,c,tenant,shop):
  require(tenant==self.tenant and shop==self.shop,403,'scope_denied');require(c.one('SELECT tenant FROM collective_consumer_scope WHERE tenant=? AND store=?'+self.lock,(tenant,shop)),503,'not_installed')
 def _key(self,customer):return hmac.new(self.key,(self.tenant+'\n'+self.shop+'\n'+customer).encode(),hashlib.sha256).hexdigest()
 def _identity(self,c,customer,member,order):
  profile=c.one('SELECT id,status,marketing_ok,withdrawn_at FROM customer_profiles WHERE id=?'+self.lock,(customer,))
  identity=c.one('SELECT customer_id,member_id FROM auth_identities WHERE customer_id=? AND member_id=?'+self.lock,(customer,member))
  owned=c.one('SELECT order_id,customer_id,member_id FROM orders WHERE order_id=?'+self.lock,(order,))
  return profile if profile and profile['status']=='ACTIVE' and not profile['withdrawn_at'] and identity and owned and owned['customer_id']==customer and owned['member_id']==member else None
 def bind_authenticated(self,customer,member,order,now):
  """Server-only hook AFTER host member_required(request); no HTTP binding action."""
  require(all(isinstance(x,str) and 0<len(x)<=160 for x in (customer,member,order)))
  with self.db() as c:
   self._scope(c,self.tenant,self.shop);key=self._key(customer)
   require(not c.one("SELECT id FROM collective_consumer_recipient WHERE tenant=? AND store=? AND customer_key=? AND status='erased'",(self.tenant,self.shop,key)),409,'recipient_erased')
   require(self._identity(c,customer,member,order),409,'authenticated_order_required')
   old=c.one('SELECT * FROM collective_consumer_recipient WHERE tenant=? AND store=? AND customer_key=? AND order_id=?',(self.tenant,self.shop,key,order))
   if old:require(old['member_id']==member,409,'identity_changed');return old['id']
   recipient=str(uuid.uuid4());c.exec('INSERT INTO collective_consumer_recipient VALUES(?,?,?,?,?,?,?,?)',(self.tenant,self.shop,recipient,key,customer,member,order,'active'));return recipient
 def _consented(self,c,m,purpose,now):
  policy=self.policies.get(purpose)
  if not policy:return False
  rows=c.all('SELECT id,customer_id,member_id,consent_type,policy_version,granted,source,created_at FROM consent_history WHERE customer_id=? AND consent_type=? ORDER BY created_at DESC LIMIT 1001',(m['customer_id'],policy['consentType']))
  if not rows or len(rows)>1000:return False
  try:
   latest=max(seconds(r['created_at']) for r in rows);current=[r for r in rows if seconds(r['created_at'])==latest]
   return now>=latest and now<latest+policy['maxAgeSeconds'] and all(r['granted']==1 and r['member_id']==m['member_id'] and r['policy_version']==policy['policyVersion'] and r['source'] in {'ACCOUNT','EMAIL_SIGNUP'} for r in current)
  except (ValueError,TypeError):return False
 def _eligible(self,c,p,now):
  if p.get('purpose') not in PURPOSES:return None
  m=c.one('SELECT * FROM collective_consumer_recipient WHERE tenant=? AND store=? AND id=?'+self.lock,(self.tenant,self.shop,p.get('recipientId')))
  if not m or m['status']!='active':return None
  profile=self._identity(c,m['customer_id'],m['member_id'],m['order_id'])
  if not profile or (p['purpose']=='marketing_reorder' and profile['marketing_ok']!=1) or not self._consented(c,m,p['purpose'],now):return None
  t=self.templates.get(p.get('templateId'))
  if not t or t['purpose']!=p['purpose'] or t['digest']!=p.get('templateDigest') or t['maxCostKrw']>p.get('maxCostKrw',-1) or seconds(p['expiresAt'])<=now:return None
  template=c.one('SELECT id,kind,template_id,body FROM notify_templates WHERE id=?'+self.lock,(t['templateId'],))
  if not template or template['kind'] not in {'sms','alimtalk'} or not isinstance(template['body'],str) or not 1<=len(template['body'])<=2000 or '#{' in template['body'] or hashlib.sha256(template['body'].encode()).hexdigest()!=t['digest'] or (template['kind']=='alimtalk' and not template['template_id']):return None
  # Provider-local identity only. Contact resolution belongs exclusively to the trusted transport.
  return {'customerId':m['customer_id'],'memberId':m['member_id'],'orderId':m['order_id'],'purpose':p['purpose'],'templateId':template['id'],'providerTemplateId':template['template_id'],'text':template['body'],'kind':template['kind'],'maxCostKrw':min(t['maxCostKrw'],p['maxCostKrw'])}
 def nonce(self,tenant,shop,nonce,now):
  with self.db() as c:
   self._scope(c,tenant,shop);require(not c.one('SELECT id FROM collective_consumer_nonce WHERE tenant=? AND store=? AND id=?',(tenant,shop,nonce)),409,'nonce_replay');require(c.one('SELECT COUNT(*) n FROM collective_consumer_nonce WHERE tenant=? AND store=? AND at>?',(tenant,shop,now-60))['n']<120,429,'rate_limited');c.exec('INSERT INTO collective_consumer_nonce VALUES(?,?,?,?)',(tenant,shop,nonce,now));c.exec('DELETE FROM collective_consumer_nonce WHERE at<?',(now-600,))
 def _row(self,c,tenant,shop,request):return c.one('SELECT * FROM collective_consumer_outbox WHERE tenant=? AND store=? AND id=?'+self.lock,(tenant,shop,request))
 def _finish(self,c,row,status,cost,now,code=None):
  receipt=SQLiteConsumerStore._receipt(row['id'],row['digest'],status,cost,now,code);c.exec("UPDATE collective_consumer_outbox SET status=?,receipt=?,payload='{}',cancel_pending=0 WHERE tenant=? AND store=? AND id=?",(status,dumps(receipt),row['tenant'],row['store'],row['id']));return receipt
 def execute(self,action,tenant,shop,body,now):
  with self.db() as c:
   self._scope(c,tenant,shop);row=self._row(c,tenant,shop,body['requestId'])
   if row:require(row['digest']==body['payloadDigest'],409,'request_conflict')
   if action=='send':
    if row:return json.loads(row['receipt']) if row['receipt'] else None
    require(payload_digest(body['payload'])==body['payloadDigest'] and self._eligible(c,body['payload'],now),409,'current_purpose_consent_required')
    r=SQLiteConsumerStore._receipt(body['requestId'],body['payloadDigest'],'accepted',None,now);c.exec('INSERT INTO collective_consumer_outbox VALUES(?,?,?,?,?,?,?,?,0)',(tenant,shop,body['requestId'],body['payloadDigest'],dumps(body['payload']),'accepted',dumps(r),body['payload']['maxCostKrw']));return r
   if not row:return None
   if action=='cancel':
    if row['status']=='accepted':return self._finish(c,row,'failed',0,now,'cancelled')
    c.exec("UPDATE collective_consumer_outbox SET payload='{}',cancel_pending=? WHERE tenant=? AND store=? AND id=?",(1 if row['status']=='unknown' else 0,tenant,shop,row['id']))
   return json.loads(row['receipt']) if row['receipt'] else None
 def _authorization(self,tenant,shop,request,digest,now):
  try:return self.authorize(tenant,shop,request,digest,now) if self.authorize else None
  except Exception:return None
 def deliver(self,tenant,shop,request,transport,now=None):
  if transport is None:return None
  clock=lambda:int(time.time()) if now is None else now
  with self.db() as c:
   self._scope(c,tenant,shop);row=self._row(c,tenant,shop,request)
   if not row or row['status']!='accepted':return None
  allowed=self._authorization(tenant,shop,request,row['digest'],clock())
  if allowed is None:return None
  with self.db() as c:
   self._scope(c,tenant,shop);row=self._row(c,tenant,shop,request)
   if not row or row['status']!='accepted':return None
   payload=json.loads(row['payload'])
   if allowed is not True or not self._eligible(c,payload,clock()):return self._finish(c,row,'failed',0,clock(),'rejected')
   c.exec("UPDATE collective_consumer_outbox SET status='unknown',receipt=NULL WHERE tenant=? AND store=? AND id=?",(tenant,shop,request))
  allowed=self._authorization(tenant,shop,request,row['digest'],clock())
  if allowed is None:return None
  with self.db() as c:
   self._scope(c,tenant,shop);row=self._row(c,tenant,shop,request)
   if not row or row['status']!='unknown':return None
   context=self._eligible(c,payload,clock()) if allowed is True and not row['cancel_pending'] and row['payload']==dumps(payload) else None
   if not context:return self._finish(c,row,'failed',0,clock(),'rejected')
  try:
   result=transport(request,context)
   return self.finish(tenant,shop,request,result['status'],result['costKrw'],clock()) if isinstance(result,dict) and set(result)=={'status','costKrw'} else None
  except Exception:return None
 def finish(self,tenant,shop,request,status,cost,now):
  with self.db() as c:
   self._scope(c,tenant,shop);row=self._row(c,tenant,shop,request);require(row and row['status']=='unknown',409,'not_claimed');require(status in {'delivered','failed'} and money(cost) and cost<=row['max_cost']);return self._finish(c,row,status,cost,now)
 def reconcile(self,tenant,shop,request,lookup,now=None):
  with self.db() as c:
   self._scope(c,tenant,shop);row=self._row(c,tenant,shop,request)
   if not row or row['status']!='unknown':return None
  try:
   result=lookup(request);return self.finish(tenant,shop,request,result['status'],result['costKrw'],int(time.time()) if now is None else now) if isinstance(result,dict) and set(result)=={'status','costKrw'} else None
  except Exception:return None
 def erase_customer(self,customer,now):
  with self.db() as c:
   self._scope(c,self.tenant,self.shop);key=self._key(customer);mappings=c.all('SELECT id FROM collective_consumer_recipient WHERE tenant=? AND store=? AND customer_key=?',(self.tenant,self.shop,key))
   for m in mappings:
    rows=c.all("SELECT * FROM collective_consumer_outbox WHERE tenant=? AND store=? AND status IN ('accepted','unknown') AND payload LIKE ?",(self.tenant,self.shop,'%'+m['id']+'%'))
    for row in rows:
     if json.loads(row['payload']).get('recipientId')!=m['id']:continue
     if row['status']=='accepted':self._finish(c,row,'failed',0,now,'erased')
     else:c.exec("UPDATE collective_consumer_outbox SET payload='{}',cancel_pending=1 WHERE tenant=? AND store=? AND id=?",(self.tenant,self.shop,row['id']))
   c.exec("UPDATE collective_consumer_recipient SET customer_id=NULL,member_id=NULL,order_id=NULL,status='erased' WHERE tenant=? AND store=? AND customer_key=?",(self.tenant,self.shop,key))

def consumer_factory(db,is_pg,config,env,*,transport=None):
 """Installer factory; construction is inert. A host closure injects real transport.

 config: fixed tenantId/storeId, secretEnv, mappingKeyEnv, policies, templates,
 authorization{origin,owner,campaignId,allowedHosts}. transport.check() must verify
 its installed credentials, UUID idempotency, exact max KRW and read-only receipt
 lookup; send(id,context) and lookup(id) must never log contacts or message bodies.
 Host must schedule capability.app.work_once(); it is not called by construction.
 """
 from integration import Capability,secret
 from consumer_asgi import ConsumerASGI
 require(isinstance(config,dict) and set(config)=={'tenantId','storeId','secretEnv','mappingKeyEnv','policies','templates','authorization'})
 auth=config['authorization'];require(isinstance(auth,dict) and set(auth)=={'origin','owner','campaignId','allowedHosts'})
 signing=secret(env,config['secretEnv']);mapping=secret(env,config['mappingKeyEnv']);require(mapping!=signing)
 authorize=CollectiveAuthorizationClient(auth['origin'],auth['owner'],auth['campaignId'],signing,auth['allowedHosts'])
 store=MapdalConsumerStore(db,is_pg,config['tenantId'],config['storeId'],mapping,config['policies'],config['templates'],authorize)
 app=ConsumerASGI(ConsumerBridge(store,signing,config['tenantId'],config['storeId'],enabled=True),transport)
 def check():
  store.check()
  with db() as c:
   for table in ['collective_consumer_scope','collective_consumer_recipient','collective_consumer_nonce','collective_consumer_outbox','collective_consumer_cursor']:c.exec('SELECT * FROM '+table+' LIMIT 0')
   store._scope(c,config['tenantId'],config['storeId'])
  require(transport is not None and all(callable(getattr(transport,k,None)) for k in ('check','send','lookup')),503,'delivery_transport_not_installed')
  transport.check()
 return Capability(app,check,store.migrate)
