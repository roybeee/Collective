import asyncio,contextlib,hashlib,json,pathlib,sqlite3,sys,time,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts/mapdal'))
from consumer_consent import ConsumerConsentASGI
class ConsentTest(unittest.TestCase):
 def setUp(self):
  self.conn=sqlite3.connect(':memory:',check_same_thread=False);self.conn.row_factory=sqlite3.Row
  self.conn.executescript("CREATE TABLE customer_profiles(id TEXT,status TEXT,marketing_ok INTEGER,withdrawn_at TEXT);CREATE TABLE auth_identities(customer_id TEXT,member_id TEXT);CREATE TABLE orders(order_id TEXT,customer_id TEXT,member_id TEXT);CREATE TABLE consent_history(id TEXT,customer_id TEXT,member_id TEXT,consent_type TEXT,policy_version TEXT,granted INTEGER,source TEXT,ip TEXT,created_at TEXT);INSERT INTO customer_profiles VALUES('c','ACTIVE',0,NULL);INSERT INTO auth_identities VALUES('c','m');INSERT INTO orders VALUES('MD-20261004-ABCDEF','c','m');")
  outer=self
  class Cx:
   def exec(self,q,p=()):return outer.conn.execute(q,p)
   def one(self,q,p=()):
    r=self.exec(q,p).fetchone();return dict(r) if r else None
   def all(self,q,p=()):return [dict(r) for r in self.exec(q,p).fetchall()]
  @contextlib.contextmanager
  def db():
   with self.conn:yield Cx()
  self.context={'customerId':'c','memberId':'m','orderId':'MD-20261004-ABCDEF','csrfToken':'synthetic-csrf-000000000000000'}
  async def resolve(scope):return self.context
  self.notices={p:{'version':'fixture-v1','text':'합성 테스트 고지 '+p,'maxAgeSeconds':3600} for p in ('post_purchase','marketing_reorder')}
  self.notices={p:{**n,'version':hashlib.sha256(json.dumps({'purpose':p,'text':n['text'],'maxAgeSeconds':n['maxAgeSeconds']},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()} for p,n in self.notices.items()}
  self.app=ConsumerConsentASGI(db,False,resolve,self.notices)
 def tearDown(self):self.conn.close()
 def call(self,method='GET',body=None,headers=None,raw=None):
  h={'host':'mapdal.kr','origin':'https://mapdal.kr','sec-fetch-site':'same-origin','x-csrf-token':'synthetic-csrf-000000000000000','content-type':'application/json',**(headers or {})};events=[]
  async def receive():return {'type':'http.request','body':raw if raw is not None else json.dumps(body).encode() if body is not None else b''}
  async def send(event):events.append(event)
  asyncio.run(self.app({'type':'http','method':method,'path':'/collective/consumer-consents/','headers':[(k.encode(),v.encode()) for k,v in h.items()]},receive,send))
  return events[0]['status'],json.loads(events[1]['body'])
 def grant(self,**extra):return self.call('POST',{'purpose':'post_purchase','granted':True,'version':self.notices[extra.get('purpose','post_purchase')]['version'],**extra})
 def test_get_initial_unchecked_and_no_identity(self):
  status,r=self.call();self.assertEqual(status,200);self.assertFalse(r['purposes'][0]['granted']);self.assertNotIn('customerId',json.dumps(r))
 def test_explicit_grant_persists_exact_purpose(self):
  self.assertEqual(self.grant()[0],200);r=self.conn.execute('SELECT * FROM consent_history').fetchone();self.assertEqual((r['consent_type'],r['source'],r['granted']),('COLLECTIVE_POST_PURCHASE','ACCOUNT',1))
 def test_grant_never_changes_marketing_profile(self):self.assertEqual(self.grant(purpose='marketing_reorder')[0],200);self.assertEqual(self.conn.execute('SELECT marketing_ok FROM customer_profiles').fetchone()[0],0)
 def test_choices_are_independent(self):
  self.grant();values={p['purpose']:p for p in self.call()[1]['purposes']};self.assertTrue(values['post_purchase']['granted']);self.assertFalse(values['marketing_reorder']['granted'])
 def test_withdraw_records_false(self):
  self.grant();self.assertEqual(self.grant(granted=False)[0],200);self.assertEqual(self.conn.execute('SELECT SUM(granted=0) FROM consent_history').fetchone()[0],1)
 def test_current_notice_version_required(self):self.assertEqual(self.grant(version='old')[0],409)
 def test_browser_identity_rejected(self):self.assertEqual(self.grant(customerId='other')[0],400)
 def test_boolean_is_strict(self):self.assertEqual(self.grant(granted=1)[0],400)
 def test_origin_denied(self):self.assertEqual(self.call(headers={'origin':'https://other.example'})[0],403)
 def test_csrf_denied(self):self.assertEqual(self.call(headers={'x-csrf-token':'bad'})[0],403)
 def test_unauthenticated_denied(self):self.context=None;self.assertEqual(self.call()[0],401)
 def test_withdrawn_customer_denied(self):self.conn.execute("UPDATE customer_profiles SET withdrawn_at='now'");self.assertEqual(self.grant()[0],403)
 def test_order_reassignment_denied(self):self.conn.execute("UPDATE orders SET member_id='other'");self.assertEqual(self.grant()[0],403)
 def test_old_marketing_never_grants_purpose(self):
  self.conn.execute("INSERT INTO consent_history VALUES('old','c','m','MARKETING','fixture-v1',1,'ACCOUNT','',?)",('2099-01-01T00:00:00Z',));self.assertTrue(all(not p['granted'] for p in self.call()[1]['purposes']))
 def test_expired_consent_unchecked(self):
  self.grant();self.conn.execute("UPDATE consent_history SET created_at='2000-01-01T00:00:00Z'");self.assertFalse(self.call()[1]['purposes'][0]['granted'])
 def test_duplicate_json_rejected(self):self.assertEqual(self.call('POST',raw=b'{"purpose":"post_purchase","purpose":"marketing_reorder","granted":true,"version":"fixture-v1"}')[0],400)
 def test_large_body_rejected(self):self.assertEqual(self.call('POST',raw=b'x'*1025)[0],413)
 def test_grant_rate_limited(self):
  for _ in range(30):self.assertEqual(self.call()[0],200)
  self.assertEqual(self.call()[0],429)
 def test_missing_notice_config_rejected(self):
  with self.assertRaises(ValueError):ConsumerConsentASGI(None,False,None,{})
 def test_reusing_version_for_changed_notice_is_rejected(self):
  notices={**self.notices,'post_purchase':{**self.notices['post_purchase'],'text':'changed'}}
  with self.assertRaises(ValueError):ConsumerConsentASGI(None,False,None,notices)
if __name__=='__main__':unittest.main()
