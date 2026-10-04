import hashlib,hmac,http.client,json,pathlib,sys,tempfile,threading,unittest,uuid
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
from eval_gateway.core import Gateway,canonical,digest
from eval_gateway.serve import GatewayServer,configured_gateway
from eval_gateway_core_test import Provider
class HTTPTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.p=Provider();self.key='fixture-signing-key-000000000000000';self.token='fixture-auth-token-0000000000000000';self.g=Gateway(self.temp.name+'/db',self.p,self.token,100,'owner',self.key);self.server=GatewayServer(('127.0.0.1',0),self.g);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
 def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
 def request(self,method,path,body=None,headers=None):
  conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=3);conn.request(method,path,body=canonical(body) if body is not None else None,headers=headers or {'authorization':'Bearer '+self.token,'x-collective-owner':'owner','content-type':'application/json'});r=conn.getresponse();status=r.status;v=json.loads(r.read());conn.close();return status,v
 def test_full_signed_http_contract_quote_submit_lookup(self):
  status,c=self.request('GET','/v1/eval-contract');self.assertEqual(status,200);signature=c.pop('signature');self.assertEqual(signature,hmac.new(self.key.encode(),f'collective.eval-cost.v1\nGET\n/v1/eval-contract\nowner\n{canonical(c)}'.encode(),hashlib.sha256).hexdigest())
  request={'instructions':'judge','input':'fixture'};_,q=self.request('POST','/v1/eval-quotes',{'request':request,'maxOutputTokens':100,'contractDigest':c['digest']});rid=str(uuid.uuid4());status,r=self.request('POST','/v1/eval-submissions',{'requestId':rid,'quoteId':q['quoteId'],'requestDigest':digest(request),'contractDigest':c['digest'],'request':request});self.assertEqual(status,200);self.assertEqual(r['schema'],'collective.eval-receipt.v1');self.assertEqual(r['settlement'],'final');self.assertEqual(self.request('GET','/v1/eval-submissions/'+rid)[1]['chargeKrw'],5);self.assertEqual(self.p.calls,1)
 def test_wrong_owner_rejected(self):self.assertEqual(self.request('GET','/v1/eval-contract',headers={'authorization':'Bearer '+self.token,'x-collective-owner':'other'})[0],401)
 def test_oversized_body(self):self.assertEqual(self.request('POST','/v1/eval-quotes',{'x':'a'*65536})[0],413)
 def test_missing_config_fails_closed(self):
  with self.assertRaises(Exception):configured_gateway({})
 def test_output_bound_violation_stays_unknown(self):
  self.p.generate=lambda *a:{'output':'x','usage':{'inputTokens':1,'outputTokens':101},'chargeKrw':1,'providerRunId':'fixture'}
  request={'instructions':'judge','input':'fixture'};c=self.g.contract();q=self.g.quote({'request':request,'maxOutputTokens':100,'contractDigest':c['digest']});r=self.g.submit({'requestId':str(uuid.uuid4()),'quoteId':q['quoteId'],'requestDigest':digest(request),'contractDigest':c['digest'],'request':request});self.assertEqual(r['status'],'unknown')
if __name__=='__main__':unittest.main()
