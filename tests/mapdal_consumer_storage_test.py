import asyncio,contextlib,hashlib,hmac,json,pathlib,sqlite3,sys,time,unittest,uuid
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts/mapdal'))
from consumer_storage_adapter import MapdalConsumerStore
from consumer_bridge import iso,payload_digest,Rejected
class StoreTest(unittest.TestCase):
 def setUp(self):
  self.conn=sqlite3.connect(':memory:',check_same_thread=False);self.conn.row_factory=sqlite3.Row
  self.conn.executescript('''CREATE TABLE customer_profiles(id TEXT PRIMARY KEY,status TEXT,marketing_ok INTEGER,withdrawn_at TEXT);CREATE TABLE auth_identities(id TEXT PRIMARY KEY,customer_id TEXT,member_id TEXT);CREATE TABLE consent_history(id TEXT PRIMARY KEY,customer_id TEXT,member_id TEXT,consent_type TEXT,policy_version TEXT,granted INTEGER,source TEXT,created_at TEXT);CREATE TABLE orders(order_id TEXT PRIMARY KEY,customer_id TEXT,member_id TEXT);CREATE TABLE notify_templates(id TEXT PRIMARY KEY,kind TEXT,template_id TEXT,body TEXT);INSERT INTO customer_profiles VALUES('customer','ACTIVE',1,NULL);INSERT INTO auth_identities VALUES('identity','customer','member');INSERT INTO orders VALUES('MD-20261004-ABCDEF','customer','member');INSERT INTO notify_templates VALUES('template','sms','','합성 알림');''')
  outer=self
  class Cx:
   def exec(self,q,p=()):return outer.conn.execute(q,p)
   def one(self,q,p=()):
    r=self.exec(q,p).fetchone();return dict(r) if r else None
   def all(self,q,p=()):return [dict(r) for r in self.exec(q,p).fetchall()]
  @contextlib.contextmanager
  def db():
   with self.conn:yield Cx()
  self.now=int(time.time());self.template=str(uuid.uuid4());self.allow=True
  self.store=MapdalConsumerStore(db,False,'tenant','shop','fixture-mapping-key-000000000000000',{'post_purchase':{'consentType':'COLLECTIVE_POST_PURCHASE','policyVersion':'v1','maxAgeSeconds':3600},'marketing_reorder':{'consentType':'COLLECTIVE_MARKETING_REORDER','policyVersion':'v1','maxAgeSeconds':3600}},{self.template:{'templateId':'template','purpose':'post_purchase','digest':hashlib.sha256('합성 알림'.encode()).hexdigest(),'maxCostKrw':5}},authorize=lambda *a:self.allow)
  self.store.migrate();self.conn.execute('INSERT INTO consent_history VALUES(?,?,?,?,?,?,?,?)',('consent','customer','member','COLLECTIVE_POST_PURCHASE','v1',1,'ACCOUNT',iso(self.now-1)));self.conn.commit()
  self.recipient=self.store.bind_authenticated('customer','member','MD-20261004-ABCDEF',self.now)
  rid=str(uuid.uuid4());self.payload={'requestId':rid,'recipientId':self.recipient,'purpose':'post_purchase','templateId':self.template,'templateDigest':hashlib.sha256('합성 알림'.encode()).hexdigest(),'maxCostKrw':5,'expiresAt':iso(self.now+100),'consentDigest':'a'*64};self.body={'requestId':rid,'payloadDigest':payload_digest(self.payload),'payload':self.payload};self.calls=0
 def tearDown(self):self.conn.close()
 def send(self):return self.store.execute('send','tenant','shop',self.body,self.now)
 def transport(self,rid,context):self.calls+=1;self.assertEqual(context['customerId'],'customer');return {'status':'delivered','costKrw':3}
 def test_real_schema_purpose_allows_queue(self):self.assertEqual(self.send()['status'],'accepted')
 def test_marketing_flag_alone_never_grants(self):
  self.conn.execute('DELETE FROM consent_history');self.conn.execute("INSERT INTO consent_history VALUES('legacy','customer','member','MARKETING','v1',1,'ACCOUNT',?)",(iso(self.now),))
  with self.assertRaises(Rejected):self.send()
 def test_wrong_identity_cannot_map(self):
  with self.assertRaises(Rejected):self.store.bind_authenticated('customer','other','MD-20261004-ABCDEF',self.now)
 def test_foreign_order_cannot_map(self):
  self.conn.execute("UPDATE orders SET customer_id='other'")
  with self.assertRaises(Rejected):self.store.bind_authenticated('customer','member','MD-20261004-ABCDEF',self.now)
 def test_latest_revocation_denies(self):
  self.conn.execute('INSERT INTO consent_history VALUES(?,?,?,?,?,?,?,?)',('revoke','customer','member','COLLECTIVE_POST_PURCHASE','v1',0,'ACCOUNT',iso(self.now)))
  with self.assertRaises(Rejected):self.send()
 def test_expired_consent_denies(self):
  self.conn.execute('UPDATE consent_history SET created_at=?',(iso(self.now-4000),))
  with self.assertRaises(Rejected):self.send()
 def test_changed_template_denies(self):
  self.conn.execute("UPDATE notify_templates SET body='changed'")
  with self.assertRaises(Rejected):self.send()
 def test_no_transport_does_not_claim(self):self.send();self.assertIsNone(self.store.deliver('tenant','shop',self.payload['requestId'],None,self.now));self.assertEqual(self.store.execute('receipt','tenant','shop',self.body,self.now)['status'],'accepted')
 def test_deliver_once_and_record_receipt(self):
  self.send();self.assertEqual(self.store.deliver('tenant','shop',self.payload['requestId'],self.transport,self.now)['status'],'delivered');self.store.deliver('tenant','shop',self.payload['requestId'],self.transport,self.now);self.assertEqual(self.calls,1)
 def test_unknown_transport_never_resends(self):
  def unknown(*a):self.calls+=1;raise TimeoutError()
  self.send();self.store.deliver('tenant','shop',self.payload['requestId'],unknown,self.now);self.store.deliver('tenant','shop',self.payload['requestId'],unknown,self.now);self.assertEqual(self.calls,1);self.assertIsNone(self.store.execute('receipt','tenant','shop',self.body,self.now))
 def test_withdraw_before_claim_suppresses(self):
  self.send();self.conn.execute("UPDATE customer_profiles SET status='WITHDRAWN'");self.store.deliver('tenant','shop',self.payload['requestId'],self.transport,self.now);self.assertEqual(self.calls,0)
 def test_withdraw_during_authorization_suppresses(self):
  def auth(*a):self.conn.execute("UPDATE customer_profiles SET withdrawn_at='now'");return True
  self.send();self.store.authorize=auth;self.store.deliver('tenant','shop',self.payload['requestId'],self.transport,self.now);self.assertEqual(self.calls,0)
 def test_erase_scrubs_mapping_payload_and_blocks_rebind(self):
  self.send();self.store.erase_customer('customer',self.now);dump=self.conn.execute('SELECT * FROM collective_consumer_recipient').fetchone();self.assertIsNone(dump['customer_id']);self.assertEqual(self.conn.execute('SELECT payload FROM collective_consumer_outbox').fetchone()[0],'{}')
  with self.assertRaises(Rejected):self.store.bind_authenticated('customer','member','MD-20261004-ABCDEF',self.now)
 def test_wrong_scope_denied(self):
  with self.assertRaises(Rejected):self.store.execute('send','other','shop',self.body,self.now)
 def test_trusted_lookup_settles_unknown_without_resend(self):
  self.send();self.store.deliver('tenant','shop',self.payload['requestId'],lambda *a:None,self.now)
  r=self.store.reconcile('tenant','shop',self.payload['requestId'],lambda rid:{'status':'delivered','costKrw':2},self.now)
  self.assertEqual(r['costKrw'],2);self.assertEqual(self.calls,0)
 def test_unknown_cancel_scrubs_without_false_free_receipt(self):
  self.send();self.store.deliver('tenant','shop',self.payload['requestId'],lambda *a:None,self.now);self.store.execute('cancel','tenant','shop',self.body,self.now)
  row=self.conn.execute('SELECT * FROM collective_consumer_outbox').fetchone();self.assertEqual(row['status'],'unknown');self.assertEqual(row['payload'],'{}');self.assertEqual(row['cancel_pending'],1)
 def test_factory_without_transport_is_explicitly_blocked(self):
  from consumer_storage_adapter import consumer_factory
  config={'tenantId':'tenant','storeId':'shop','secretEnv':'CONSUMER_SECRET','mappingKeyEnv':'MAPPING_SECRET','policies':self.store.policies,'templates':self.store.templates,'authorization':{'origin':'https://collective.example','owner':'owner','campaignId':'campaign','allowedHosts':['collective.example']}}
  cap=consumer_factory(self.store.db,False,config,{'CONSUMER_SECRET':'synthetic-bridge-secret-000000000000','MAPPING_SECRET':'synthetic-mapping-secret-0000000000'})
  with self.assertRaises(Rejected):cap.check()
 def test_asgi_wrong_content_type_is_rejected(self):
  from consumer_asgi import ConsumerASGI
  from consumer_bridge import ConsumerBridge
  app=ConsumerASGI(ConsumerBridge(self.store,'fixture-signature-key-000000000000','tenant','shop',True));events=[]
  async def receive():return {'type':'http.request','body':b'{}'}
  async def send(event):events.append(event)
  asyncio.run(app({'type':'http','method':'POST','path':'/collective/v1/consumer/send','headers':[]},receive,send));self.assertEqual(events[0]['status'],415)
 def test_readiness_rejects_uninstalled_shop_scope(self):
  from consumer_storage_adapter import consumer_factory
  config={'tenantId':'tenant','storeId':'other','secretEnv':'CONSUMER_SECRET','mappingKeyEnv':'MAPPING_SECRET','policies':self.store.policies,'templates':self.store.templates,'authorization':{'origin':'https://collective.example','owner':'owner','campaignId':'campaign','allowedHosts':['collective.example']}}
  class Transport:
   def check(self):pass
   def send(self,*a):raise AssertionError('must not send')
   def lookup(self,*a):return None
  cap=consumer_factory(self.store.db,False,config,{'CONSUMER_SECRET':'synthetic-bridge-secret-000000000000','MAPPING_SECRET':'synthetic-mapping-secret-0000000000'},transport=Transport())
  with self.assertRaises(Rejected):cap.check()
 def test_second_authorization_revoke_finishes_zero_without_send(self):
  decisions=iter([True,False]);self.store.authorize=lambda *a:next(decisions)
  self.send();r=self.store.deliver('tenant','shop',self.payload['requestId'],self.transport,self.now)
  self.assertEqual(r['status'],'failed');self.assertEqual(r['costKrw'],0);self.assertEqual(self.calls,0)
 def test_worker_rotates_unresolved_heads(self):
  from consumer_asgi import ConsumerASGI
  from consumer_bridge import ConsumerBridge
  self.send();first=self.payload['requestId'];second=str(uuid.uuid4());p={**self.payload,'requestId':second}
  self.store.execute('send','tenant','shop',{'requestId':second,'payloadDigest':payload_digest(p),'payload':p},self.now)
  checked=[];self.store.authorize=lambda t,s,r,d,n:checked.append(r)
  class Transport:
   def check(self):pass
   def send(self,*args):raise AssertionError('must not send')
   def lookup(self,*args):return None
  app=ConsumerASGI(ConsumerBridge(self.store,'fixture-signature-key-000000000000','tenant','shop',True),Transport())
  app.work_once();app.work_once();self.assertEqual(set(checked),{first,second})
 def test_signed_asgi_queues_and_replay_rejected(self):
  from consumer_asgi import ConsumerASGI
  from consumer_bridge import ConsumerBridge
  secret='fixture-signature-key-000000000000';path='/collective/v1/consumer/send';stamp=str(self.now);nonce=str(uuid.uuid4())
  raw=json.dumps({**self.body,'tenantId':'tenant','storeId':'shop'},separators=(',',':')).encode()
  signed=(stamp+'\n'+nonce+'\nPOST\n'+path+'\n').encode()+raw
  headers={'content-type':'application/json','x-collective-timestamp':stamp,'x-collective-nonce':nonce,'x-collective-signature':hmac.new(secret.encode(),signed,hashlib.sha256).hexdigest()}
  app=ConsumerASGI(ConsumerBridge(self.store,secret,'tenant','shop',True))
  async def invoke():
   events=[]
   async def receive():return {'type':'http.request','body':raw}
   async def send(event):events.append(event)
   await app({'type':'http','method':'POST','path':path,'headers':[(k.encode(),v.encode()) for k,v in headers.items()]},receive,send)
   return events
  first=asyncio.run(invoke());self.assertEqual(first[0]['status'],200);self.assertEqual(json.loads(first[1]['body'])['status'],'accepted')
  self.assertEqual(asyncio.run(invoke())[0]['status'],409)
if __name__=='__main__':unittest.main()
