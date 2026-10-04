import concurrent.futures, hashlib, json, pathlib, sqlite3, sys, tempfile, threading, unittest, uuid
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
from eval_gateway.core import Gateway, canonical, digest, Error, iso

class Provider:
 def __init__(self): self.calls=0;self.reads=0;self.fail=False;self.barrier=None
 def contract(self): return {'schema':'collective.eval-cost.v1','id':'synthetic-fixed-v1','provider':'synthetic','model':'fixed-model','priceVersion':'fixture-v1','validUntil':'2099-01-01T00:00:00Z','billing':{'mode':'fixed_krw','enforcement':'provider_fixed_krw','taxAndFeesIncluded':True},'limits':{'maxInputTokens':33024,'maxOutputTokens':4096,'maxRequests':1,'tools':False,'fallback':False,'retries':False},'durableIdempotency':True,'receiptLookup':True}
 def quote(self,request,max_output,contract): return {'maxChargeKrw':7,'upstreamQuoteId':str(uuid.uuid4()),'expiresAt':'2099-01-01T00:00:00Z'}
 def generate(self,payload,quote,request_id):
  self.calls+=1
  if self.barrier:self.barrier.wait(2)
  if self.fail:raise TimeoutError()
  return {'output':'evaluated','usage':{'inputTokens':3,'outputTokens':4},'chargeKrw':5,'providerRunId':request_id}
 def recover(self,quote,request_id): self.reads+=1;return None

class GatewayTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.path=str(pathlib.Path(self.temp.name)/'gateway.db');self.p=Provider();self.g=Gateway(self.path,self.p,'test-bearer-token-with-32-characters',max_reserved_krw=10,signing_key='test-signing-key-separate-00000000000')
  self.payload={'instructions':'evaluate','input':'synthetic prompt'};self.rid=str(uuid.uuid4());self.body={'request':self.payload,'maxOutputTokens':100,'contractDigest':self.g.contract()['digest']}
 def tearDown(self):self.temp.cleanup()
 def quote(self):return self.g.quote(self.body)
 def submission(self,q):return {'requestId':self.rid,'request':self.payload,'requestDigest':digest(self.payload),'contractDigest':self.body['contractDigest'],'quoteId':q['quoteId']}
 def submit(self,q=None):return self.g.submit(self.submission(q or self.quote()))
 def test_quote_is_free(self):self.assertEqual(self.quote()['maxChargeKrw'],7);self.assertEqual(self.p.calls,0)
 def test_exact_digest_rejected(self):
  with self.assertRaises(Error):self.g.quote({**self.body,'contractDigest':'0'*64})
 def test_no_extra_tools_payload(self):
  payload={**self.payload,'tools':[]}
  with self.assertRaises(Error):self.g.quote({**self.body,'request':payload})
 def test_output_limit(self):
  with self.assertRaises(Error):self.g.quote({**self.body,'maxOutputTokens':4097})
 def test_complete_receipt_and_replay(self):
  q=self.quote();a=self.submit(q);b=self.submit(q);self.assertEqual(a,b);self.assertEqual(a['status'],'completed');self.assertEqual(self.p.calls,1)
 def test_unknown_never_resubmitted(self):
  self.p.fail=True;q=self.quote();self.assertEqual(self.submit(q)['status'],'unknown');self.submit(q);self.g.get(self.rid);self.assertEqual(self.p.calls,1);self.assertEqual(self.p.reads,1)
 def test_restart_retains_unknown(self):
  self.p.fail=True;q=self.quote();self.submit(q);other=Gateway(self.path,self.p,'test-bearer-token-with-32-characters',max_reserved_krw=10,signing_key='test-signing-key-separate-00000000000');other.submit(self.submission(q));self.assertEqual(self.p.calls,1)
 def test_parallel_submissions_send_once(self):
  q=self.quote();self.p.barrier=threading.Event()
  with concurrent.futures.ThreadPoolExecutor(2) as pool:
   first=pool.submit(self.submit,q);second=pool.submit(self.submit,q);self.p.barrier.set();first.result();second.result()
  self.assertEqual(self.p.calls,1)
 def test_reservation_retained_for_unknown(self):
  self.p.fail=True;self.submit();q=self.quote();body={**self.submission(q),'requestId':str(uuid.uuid4())}
  with self.assertRaises(Error):self.g.submit(body)
  self.assertEqual(self.p.calls,1)
 def test_prompt_not_persisted(self):
  self.submit();db=sqlite3.connect(self.path);dump=''.join(db.iterdump());db.close();self.assertNotIn('synthetic prompt',dump)
 def test_auth_required(self):self.assertEqual(self.g.handle('GET','/v1/eval-contract',{},b'')[0],401)
 def test_database_cannot_be_reopened_for_another_owner(self):
  self.submit()
  with self.assertRaises(Error):Gateway(self.path,self.p,'other-bearer-token-with-32-characters',10,owner='other',signing_key='other-signing-key-separate-00000000000')
 def test_legacy_unscoped_data_requires_explicit_migration(self):
  self.submit()
  with self.g.connect() as db:db.execute('DROP TABLE IF EXISTS gateway_scope')
  with self.assertRaises(Error):Gateway(self.path,self.p,'test-bearer-token-with-32-characters',10,signing_key='test-signing-key-separate-00000000000')
 def test_concurrent_first_owner_is_fixed(self):
  path=str(pathlib.Path(self.temp.name)/'race.db')
  def create(owner):
   try:Gateway(path,self.p,'test-bearer-token-with-32-characters',10,owner=owner,signing_key='test-signing-key-separate-00000000000');return owner
   except (Error,sqlite3.OperationalError):return None
  with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(create,['alice','bob']))
  self.assertEqual(len([r for r in results if r]),1)
  with sqlite3.connect(path) as db:self.assertEqual(db.execute('SELECT owner FROM gateway_scope').fetchone()[0],next(r for r in results if r))
 def test_unknown_receipt_over_cap_stays_unknown(self):
  self.p.generate=lambda *a:{'output':'x','usage':{'inputTokens':1,'outputTokens':2},'chargeKrw':8,'providerRunId':'p'}
  self.assertEqual(self.submit()['status'],'unknown')
 def test_payload_changed_cannot_reuse_quote(self):
  q=self.quote();p={**self.payload,'input':'changed'}
  with self.assertRaises(Error):self.g.submit({**self.submission(q),'request':p,'requestDigest':digest(p)})
 def test_contract_changed_blocks_old_quote(self):
  q=self.quote();old=self.p.contract;self.p.contract=lambda:{**old(),'id':'changed'}
  with self.assertRaises(Error):self.submit(q)
 def test_crash_after_intent_never_resends(self):
  self.p.generate=lambda *a: (_ for _ in ()).throw(SystemExit())
  q=self.quote()
  with self.assertRaises(SystemExit):self.submit(q)
  other=Gateway(self.path,self.p,'test-bearer-token-with-32-characters',10,signing_key='test-signing-key-separate-00000000000')
  self.assertEqual(other.submit(self.submission(q))['status'],'unknown')
 def test_expired_quote_never_sends(self):
  q=self.quote();q['expiresAt']='2000-01-01T00:00:00Z'
  with self.g.connect() as db:db.execute('UPDATE quotes SET data=? WHERE id=?',(canonical(q),q['quoteId']))
  with self.assertRaises(Error):self.submit(q)
  self.assertEqual(self.p.calls,0)
 def test_same_quote_second_id_never_sends_twice(self):
  q=self.quote();self.submit(q)
  with self.assertRaises(Exception):self.g.submit({**self.submission(q),'requestId':str(uuid.uuid4())})
  self.assertEqual(self.p.calls,1)
 def test_global_cap_race_reserves_atomically(self):
  q1=self.quote();q2=self.quote();self.p.fail=True
  def run(q,rid):
   try:return self.g.submit({**self.submission(q),'requestId':rid})
   except Error:return None
  with concurrent.futures.ThreadPoolExecutor(2) as pool:
   a=pool.submit(run,q1,str(uuid.uuid4()));b=pool.submit(run,q2,str(uuid.uuid4()));results=[a.result(),b.result()]
  self.assertEqual(sum(r is not None for r in results),1);self.assertEqual(self.p.calls,1)
 def test_signed_zero_charge_rejection_releases_reservation(self):
  self.p.generate=lambda *a:{'status':'rejected','settlement':'final','chargeKrw':0,'usage':None}
  r=self.submit();self.assertEqual(r['status'],'rejected');self.assertEqual(r['chargeKrw'],0)
if __name__=='__main__':unittest.main()
