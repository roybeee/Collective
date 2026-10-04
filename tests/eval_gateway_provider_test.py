import json,pathlib,sys,unittest,hmac,hashlib,uuid
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
from eval_gateway.providers import OpenAIProvider, SignedFixedProvider
from eval_gateway.core import canonical,digest,Error
from eval_gateway_core_test import Provider
class ProvidersTest(unittest.TestCase):
 def test_openai_exact_output_cap_and_no_tools_retries(self):
  calls=[]
  def http(method,url,headers,body):calls.append((method,url,json.loads(body)));return {'id':'chat-id','choices':[{'message':{'content':'ok'}}],'usage':{'prompt_tokens':3,'completion_tokens':2}}
  p=OpenAIProvider('synthetic-api-key',http=http);q={'maxOutputTokens':99};p.generate({'instructions':'judge','input':'case'},q,str(uuid.uuid4()));body=calls[0][2]
  self.assertEqual(len(calls),1);self.assertEqual(body['max_completion_tokens'],99);self.assertEqual(body['n'],1);self.assertNotIn('tools',body);self.assertFalse(body['store']);self.assertEqual(body['model'],'gpt-4.1-mini-2025-04-14')
 def test_openai_never_claims_fixed_krw(self):self.assertEqual(OpenAIProvider('fixture').contract()['billing']['enforcement'],'local_estimate')
 def test_fixed_contract_and_receipt_signatures(self):
  key='synthetic-upstream-signing-000000000';owner='upstream-owner';calls=[];contract=Provider().contract();contract={**contract,'digest':digest(contract)}
  def http(method,url,headers,body):
   from urllib.parse import urlsplit
   path=urlsplit(url).path;calls.append(method);v=contract
   if path.endswith('eval-quotes'):
    b=json.loads(body);v={'schema':'collective.eval-quote.v1','quoteId':str(uuid.uuid4()),'requestDigest':digest(b['request']),'contractDigest':contract['digest'],'model':'fixed-model','maxInputTokens':33024,'maxOutputTokens':b['maxOutputTokens'],'maxChargeKrw':7,'expiresAt':'2099-01-01T00:00:00Z'}
   return {**v,'signature':hmac.new(key.encode(),f'collective.eval-cost.v1\n{method}\n{path}\n{owner}\n{canonical(v)}'.encode(),hashlib.sha256).hexdigest()}
  p=SignedFixedProvider('https://provider.example','auth-token-fixture',key,owner,'synthetic-fixed-v1','fixed-model',http=http);self.assertEqual(p.contract()['billing']['mode'],'fixed_krw');q=p.quote({'instructions':'judge','input':'case'},100,contract);self.assertEqual(q['maxChargeKrw'],7);self.assertEqual(calls,['GET','POST'])
 def test_bad_signature_rejected(self):
  p=SignedFixedProvider('https://provider.example','token','synthetic-trust-key-000000000000000','owner','contract','model',http=lambda *a:{'signature':'0'*64})
  with self.assertRaises(Error):p.contract()
 def test_non_https_upstream_rejected(self):
  with self.assertRaises(Error):SignedFixedProvider('http://localhost','token','key','o','c','m')



class SignedSupplier:
 def __init__(self):
  self.key='synthetic-supplier-signing-key-000000000';self.owner='supplier-owner';self.posts=0;self.gets=0;self.corrupt=None;self.timeout=False;self.submission=None;self.quote_id=str(uuid.uuid4())
  body=Provider().contract();self.contract={**body,'digest':digest(body)}
 def http(self,method,url,headers,body):
  from urllib.parse import urlsplit
  path=urlsplit(url).path
  if path=='/v1/eval-contract':value=self.contract
  elif path=='/v1/eval-quotes':
   b=json.loads(body);value={'schema':'collective.eval-quote.v1','quoteId':self.quote_id,'requestDigest':digest(b['request']),'contractDigest':self.contract['digest'],'model':'fixed-model','maxInputTokens':33024,'maxOutputTokens':b['maxOutputTokens'],'maxChargeKrw':7,'expiresAt':'2099-01-01T00:00:00Z'}
  else:
   if method=='POST':
    self.posts+=1;self.submission=json.loads(body)
    if self.timeout:raise TimeoutError('synthetic lost response')
   else:self.gets+=1
   b=self.submission;value={k:b[k] for k in ['requestId','quoteId','requestDigest','contractDigest']}
   value={**value,'schema':'collective.eval-receipt.v1','model':'fixed-model','status':'running' if method=='POST' else 'completed','settlement':'reserved' if method=='POST' else 'final','chargeKrw':None if method=='POST' else 5,'usage':None if method=='POST' else {'inputTokens':3,'outputTokens':4},'output':'합성 결과','providerRunId':'supplier-run'}
   if self.corrupt and self.corrupt!='signature' and method=='GET':value={**value,self.corrupt:'wrong'}
  signature=hmac.new(self.key.encode(),f'collective.eval-cost.v1\n{method}\n{path}\n{self.owner}\n{canonical(value)}'.encode(),hashlib.sha256).hexdigest()
  return {**value,'signature':'0'*64 if self.corrupt=='signature' and method=='GET' and path.startswith('/v1/eval-submissions/') else signature}


class FixedProviderExecutionTest(unittest.TestCase):
 def setUp(self):
  import tempfile
  self.temp=tempfile.TemporaryDirectory()
 def tearDown(self):self.temp.cleanup()
 def fixture(self):
  from eval_gateway.core import Gateway
  supplier=SignedSupplier();provider=SignedFixedProvider('https://supplier.example','supplier-bearer',supplier.key,supplier.owner,'synthetic-fixed-v1','fixed-model',http=supplier.http)
  gateway=Gateway(str(pathlib.Path(self.temp.name)/(str(uuid.uuid4())+'.db')),provider,'synthetic-gateway-bearer-token-000000',10,signing_key='synthetic-gateway-signing-key-000000')
  request={'instructions':'정확 판정','input':'합성 사례'};contract=gateway.contract();quote=gateway.quote({'request':request,'maxOutputTokens':100,'contractDigest':contract['digest']})
  submission={'requestId':str(uuid.uuid4()),'request':request,'requestDigest':digest(request),'contractDigest':contract['digest'],'quoteId':quote['quoteId']}
  return supplier,gateway,submission
 def assert_reserved(self,gateway,submission):
  with gateway.connect() as db:
   row=db.execute('SELECT status,reserved,actual FROM submissions WHERE id=?',(submission['requestId'],)).fetchone()
   self.assertEqual(tuple(row),('unknown',7,None))
 def test_signed_timeout_recovers_exact_final_receipt_and_settles_krw_once(self):
  supplier,gateway,submission=self.fixture();supplier.timeout=True
  self.assertEqual(gateway.submit(submission)['status'],'unknown');self.assert_reserved(gateway,submission)
  final=gateway.get(submission['requestId']);self.assertEqual((final['status'],final['chargeKrw'],final['model']),('completed',5,'fixed-model'))
  for field in ['requestId','requestDigest','quoteId','contractDigest']:self.assertEqual(final[field],submission[field])
  self.assertEqual(supplier.submission['quoteId'],supplier.quote_id)
  self.assertEqual(gateway.submit(submission),final);self.assertEqual(gateway.get(submission['requestId']),final)
  self.assertEqual((supplier.posts,supplier.gets),(1,1))
  with gateway.connect() as db:self.assertEqual(db.execute('SELECT sum(coalesce(actual,reserved)) FROM submissions').fetchone()[0],5)
 def test_wrong_signed_receipt_identity_keeps_reservation_and_never_reposts(self):
  for field in ['requestId','requestDigest','quoteId','contractDigest']:
   with self.subTest(field=field):
    supplier,gateway,submission=self.fixture();gateway.submit(submission);supplier.corrupt=field
    for _ in range(2):self.assertEqual(gateway.get(submission['requestId'])['status'],'unknown');gateway.submit(submission)
    self.assert_reserved(gateway,submission);self.assertEqual(supplier.posts,1)
 def test_wrong_signed_model_keeps_reservation_and_never_reposts(self):
  supplier,gateway,submission=self.fixture();gateway.submit(submission);supplier.corrupt='model'
  self.assertEqual(gateway.get(submission['requestId'])['status'],'unknown');gateway.submit(submission);self.assert_reserved(gateway,submission);self.assertEqual(supplier.posts,1)
 def test_invalid_signature_keeps_reservation_until_valid_get_receipt(self):
  supplier,gateway,submission=self.fixture();gateway.submit(submission);supplier.corrupt='signature'
  self.assertEqual(gateway.get(submission['requestId'])['status'],'unknown');self.assert_reserved(gateway,submission)
  gateway.submit(submission);supplier.corrupt=None;self.assertEqual(gateway.get(submission['requestId'])['chargeKrw'],5);self.assertEqual(supplier.posts,1)


class HttpBoundaryTest(unittest.TestCase):
 def test_http_json_bounds_status_type_payload_and_closes_responses(self):
  from unittest.mock import patch
  from eval_gateway.providers import http_json,NoRedirect
  class Reply:
   def __init__(self,status,content_type,raw):
    from email.message import Message
    self.status=status;self.headers=Message();self.headers['content-type']=content_type;self.raw=raw;self.closed=False;self.read_size=None
   def __enter__(self):return self
   def __exit__(self,*args):self.closed=True
   def read(self,size):self.read_size=size;return self.raw[:size]
  for status,content_type,raw,error in [(200,'application/json',b'"'+b'x'*262142+b'"',None),(202,'application/json',b'{}',None),(500,'application/json',b'{}',Error),(200,'text/html',b'{}',Error),(200,'application/json',b'x'*262145,Error),(200,'application/json',b'not-json',ValueError)]:
   with self.subTest(status=status,content_type=content_type,length=len(raw)):
    reply=Reply(status,content_type,raw)
    class Opener:
     def open(self,request,timeout):
      self_request=request;self_timeout=timeout
      assert self_request.full_url=='https://supplier.example/v1/test' and self_request.method=='POST' and self_timeout==25
      return reply
    with patch('eval_gateway.providers.urllib.request.build_opener',return_value=Opener()) as build:
     if error:
      with self.assertRaises(error):http_json('POST','https://supplier.example/v1/test',{},b'{}')
     else:http_json('POST','https://supplier.example/v1/test',{},b'{}')
     self.assertIsInstance(build.call_args.args[0],NoRedirect)
    self.assertTrue(reply.closed)
    if reply.read_size is not None:self.assertEqual(reply.read_size,262145)
 def test_redirect_handler_rejects_redirect_without_followup(self):
  import io,urllib.error,urllib.request,urllib.response
  from email.message import Message
  from eval_gateway.providers import NoRedirect
  calls=[];responses=[]
  class SyntheticHTTPS(urllib.request.HTTPSHandler):
   def https_open(self,request):
    calls.append(request.full_url);headers=Message();headers['location']='https://other.example'
    response=urllib.response.addinfourl(io.BytesIO(b''),headers,request.full_url,302);response.msg='Found';responses.append(response);return response
  try:
   with self.assertRaises(urllib.error.HTTPError) as rejected:urllib.request.build_opener(NoRedirect(),SyntheticHTTPS()).open('https://supplier.example',timeout=1)
   rejected.exception.close()
   self.assertEqual(calls,['https://supplier.example'])
  finally:
   for response in responses:response.close()

if __name__=='__main__':unittest.main()
