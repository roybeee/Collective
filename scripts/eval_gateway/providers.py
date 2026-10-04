"""Explicit single-model adapters. HTTP has no redirect, SDK retry, fallback or tools."""
import hmac
import hashlib
import json
import time
import urllib.request
from urllib.parse import urlsplit
from .core import canonical,digest,require,Error,iso,integer,PREFIX

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def http_json(method,url,headers,body=None):
 request=urllib.request.Request(url,data=body,headers=headers,method=method)
 with urllib.request.build_opener(NoRedirect()).open(request,timeout=25) as response:
  require(response.status==200 or response.status==202,'upstream_status')
  require(response.headers.get_content_type()=='application/json','upstream_content_type')
  raw=response.read(262145);require(len(raw)<=262144,'upstream_body_limit')
  return json.loads(raw)

class OpenAIProvider:
 """Runnable USD adapter for diagnostics; never eligible for the KRW-paid submission path."""
 MODEL='gpt-4.1-mini-2025-04-14'
 def __init__(self,api_key,http=http_json):require(bool(api_key),'provider_not_configured');self.key,self.http=api_key,http
 def contract(self):
  return {'schema':PREFIX,'id':'openai-gpt41mini-usd-v1','provider':'openai','model':self.MODEL,'priceVersion':'documented-2026-10-04-usd-accounting','validUntil':'2027-01-01T00:00:00Z','billing':{'mode':'usd_conservative_conversion','enforcement':'local_estimate','taxAndFeesIncluded':False},'limits':{'maxInputTokens':33024,'maxOutputTokens':4096,'maxRequests':1,'tools':False,'fallback':False,'retries':False},'durableIdempotency':True,'receiptLookup':True}
 def quote(self,request,max_output,contract):
  # No FX multiplier can convert a USD invoice into an enforceable KRW ceiling.
  return {'maxChargeKrw':None,'expiresAt':iso(time.time()+300)}
 def generate(self,request,quote,request_id):
  require(integer(quote['maxOutputTokens'],1,4096),'output_limit')
  body={'model':self.MODEL,'messages':[{'role':'system','content':request['instructions']},{'role':'user','content':request['input']}],'max_completion_tokens':quote['maxOutputTokens'],'n':1,'stream':False,'store':False}
  v=self.http('POST','https://api.openai.com/v1/chat/completions',{'Authorization':'Bearer '+self.key,'Content-Type':'application/json'},canonical(body).encode())
  return {'output':v['choices'][0]['message']['content'],'usage':{'inputTokens':v['usage']['prompt_tokens'],'outputTokens':v['usage']['completion_tokens']},'providerRunId':v['id'],'chargeKrw':None}
 def recover(self,quote,request_id):
  # A timeout without a provider ID cannot be recovered or retried. Ledger remains unknown.
  return None

class SignedFixedProvider:
 """Only a supplier-signed tax/fee-inclusive KRW quote authorizes this transport."""
 def __init__(self,base_url,token,signing_key,owner,contract_id,model,http=http_json):
  require(isinstance(signing_key,str) and len(signing_key)>=32 and signing_key!=token,'upstream_trust_key_required')
  u=urlsplit(base_url);require(u.scheme=='https' and bool(u.hostname) and not u.username and not u.password and u.path in ('','/') and not u.query and not u.fragment,'invalid_provider_origin')
  self.url,self.token,self.key,self.owner,self.contract_id,self.model,self.http=base_url.rstrip('/'),token,signing_key,owner,contract_id,model,http
 def call(self,method,path,body=None):
  headers={'Authorization':'Bearer '+self.token,'x-collective-owner':self.owner,'Content-Type':'application/json'}
  v=self.http(method,self.url+path,headers,canonical(body).encode() if body is not None else None)
  require(isinstance(v,dict) and isinstance(v.get('signature'),str),'unsigned_upstream')
  clean={k:x for k,x in v.items() if k!='signature'};expected=hmac.new(self.key.encode(),f'{PREFIX}\n{method}\n{path}\n{self.owner}\n{canonical(clean)}'.encode(),hashlib.sha256).hexdigest()
  require(hmac.compare_digest(v['signature'],expected),'invalid_upstream_signature');return clean
 def contract(self):
  c=self.call('GET','/v1/eval-contract');require(c.get('id')==self.contract_id and c.get('model')==self.model,'provider_contract_mismatch')
  require(c.get('billing')=={'mode':'fixed_krw','enforcement':'provider_fixed_krw','taxAndFeesIncluded':True},'fixed_krw_contract_required')
  require(c.get('digest')==digest({k:v for k,v in c.items() if k!='digest'}),'contract_digest_mismatch');return c
 def quote(self,request,max_output,contract):
  q=self.call('POST','/v1/eval-quotes',{'request':request,'maxOutputTokens':max_output,'contractDigest':contract['digest']})
  require(q.get('schema')=='collective.eval-quote.v1' and q.get('requestDigest')==digest(request) and q.get('contractDigest')==contract['digest'] and q.get('model')==self.model and q.get('maxOutputTokens')==max_output and q.get('maxInputTokens')==contract['limits']['maxInputTokens'],'upstream_quote_mismatch')
  return {'maxChargeKrw':q['maxChargeKrw'],'expiresAt':q['expiresAt'],'upstreamQuoteId':q['quoteId']}
 def receipt(self,r,quote,request_id):
  require(r.get('requestId')==request_id and r.get('quoteId')==quote['upstreamQuoteId'] and r.get('requestDigest')==quote['requestDigest'] and r.get('contractDigest')==quote['contractDigest'] and r.get('model')==self.model,'upstream_receipt_mismatch')
  if r.get('status') not in ('completed','rejected') or r.get('settlement')!='final':return None
  return r
 def generate(self,request,quote,request_id):
  body={'requestId':request_id,'quoteId':quote['upstreamQuoteId'],'requestDigest':quote['requestDigest'],'contractDigest':quote['contractDigest'],'request':request}
  r=self.call('POST','/v1/eval-submissions',body)
  return self.receipt(r,quote,request_id)
 def recover(self,quote,request_id):
  return self.receipt(self.call('GET','/v1/eval-submissions/'+request_id),quote,request_id)
