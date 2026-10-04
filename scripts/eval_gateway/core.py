"""Durable, single-send evaluation ledger. No arbitrary tools or retries."""
import contextlib
import datetime
import hashlib
import hmac
import json
import sqlite3
import time
import uuid
MAX_BODY=65536
PREFIX='collective.eval-cost.v1'
def canonical(v): return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def digest(v): return hashlib.sha256(canonical(v).encode()).hexdigest()
def iso(t): return datetime.datetime.fromtimestamp(t,datetime.timezone.utc).isoformat().replace('+00:00','Z')
def instant(v): return datetime.datetime.fromisoformat(v.replace('Z','+00:00')).timestamp()
class Error(Exception):
 def __init__(self,code,status=409): self.code,self.status=code,status;super().__init__(code)
def require(ok,code,status=409):
 if not ok: raise Error(code,status)
def integer(v,low,high): return type(v) is int and low<=v<=high
def identifier(v):
 try: require(isinstance(v,str) and str(uuid.UUID(v))==v,'invalid_id',400)
 except (ValueError,TypeError,AttributeError): raise Error('invalid_id',400)
 return v
def unique_object(pairs):
 result={}
 for k,v in pairs: require(k not in result,'duplicate_json_key',400);result[k]=v
 return result
class Gateway:
 def __init__(self,path,provider,token,max_reserved_krw,owner='owner',signing_key=None):
  require(isinstance(token,str) and len(token)>=32,'auth_not_configured');require(integer(max_reserved_krw,0,1000000000),'budget_not_configured')
  require(isinstance(signing_key,str) and len(signing_key)>=32 and signing_key!=token,'signing_not_configured')
  self.path,self.provider,self.token,self.cap,self.owner,self.key=path,provider,token,max_reserved_krw,owner,signing_key
  require(isinstance(owner,str) and 1<=len(owner)<=200,'owner_not_configured')
  with self.connect() as db:
   db.executescript('''CREATE TABLE IF NOT EXISTS quotes(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,quote_id TEXT NOT NULL UNIQUE,digest TEXT NOT NULL,status TEXT NOT NULL,reserved INTEGER NOT NULL,actual INTEGER,data TEXT NOT NULL);CREATE TABLE IF NOT EXISTS request_rate(bucket INTEGER PRIMARY KEY,n INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS gateway_scope(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL);''')
   db.execute('BEGIN IMMEDIATE')
   scope=db.execute('SELECT owner FROM gateway_scope WHERE id=1').fetchone()
   if scope is None:
    require(db.execute('SELECT (SELECT COUNT(*) FROM quotes)+(SELECT COUNT(*) FROM submissions) n').fetchone()['n']==0,'unscoped_database_requires_migration')
    db.execute('INSERT INTO gateway_scope VALUES(1,?)',(owner,))
   else:require(scope['owner']==owner,'database_owner_mismatch')
 @contextlib.contextmanager
 def connect(self):
  db=sqlite3.connect(self.path,timeout=10);db.row_factory=sqlite3.Row
  try:
   db.execute('PRAGMA journal_mode=WAL');db.execute('PRAGMA synchronous=FULL')
   with db: yield db
  finally: db.close()
 def signed(self,method,path,value):
  body={k:v for k,v in value.items() if k!='signature'};signature=hmac.new(self.key.encode(),f'{PREFIX}\n{method}\n{path}\n{self.owner}\n{canonical(body)}'.encode(),hashlib.sha256).hexdigest()
  return {**body,'signature':signature}
 def contract(self):
  c=self.provider.contract();limits=c.get('limits',{});billing=c.get('billing',{})
  require(c.get('schema')==PREFIX and isinstance(c.get('id'),str) and isinstance(c.get('model'),str),'invalid_contract')
  require(limits.get('maxRequests')==1 and all(limits.get(k) is False for k in ('tools','fallback','retries')),'unbounded_contract')
  require(integer(limits.get('maxInputTokens'),257,33024) and integer(limits.get('maxOutputTokens'),1,8192),'invalid_limits')
  require(c.get('durableIdempotency') is True and c.get('receiptLookup') is True,'invalid_recovery_contract')
  require(billing.get('mode') in ('fixed_krw','usd_conservative_conversion'),'unsupported_charge')
  require(billing.get('enforcement')==('provider_fixed_krw' if billing['mode']=='fixed_krw' else 'local_estimate'),'invalid_charge_contract')
  require(instant(c['validUntil'])>time.time(),'contract_expired')
  clean={k:v for k,v in c.items() if k not in ('digest','signature')};return {**clean,'digest':digest(clean)}
 def request(self,request,contract):
  require(isinstance(request,dict) and set(request)=={'instructions','input'} and all(isinstance(v,str) for v in request.values()),'invalid_request',400)
  require(request['input'] and sum(len(v.encode()) for v in request.values())+256<=contract['limits']['maxInputTokens'],'input_limit',400)
  return digest(request)
 def quote(self,body):
  require(isinstance(body,dict) and set(body)=={'request','maxOutputTokens','contractDigest'},'invalid_fields',400)
  c=self.contract();rd=self.request(body['request'],c);require(body['contractDigest']==c['digest'],'contract_changed')
  require(integer(body['maxOutputTokens'],1,c['limits']['maxOutputTokens']),'output_limit',400)
  upstream=self.provider.quote(body['request'],body['maxOutputTokens'],c)
  cost=upstream.get('maxChargeKrw');fixed=c['billing']['mode']=='fixed_krw'
  require((fixed and integer(cost,0,1000000000)) or (not fixed and cost is None),'invalid_quote_cost')
  q={**upstream,'schema':'collective.eval-quote.v1','quoteId':str(uuid.uuid4()),'contractDigest':c['digest'],'requestDigest':rd,'model':c['model'],'maxInputTokens':c['limits']['maxInputTokens'],'maxOutputTokens':body['maxOutputTokens'],'maxChargeKrw':cost,'expiresAt':iso(min(instant(upstream['expiresAt']),instant(c['validUntil']),time.time()+300))}
  require(instant(q['expiresAt'])>time.time(),'quote_expired')
  with self.connect() as db:
   require(db.execute('SELECT COUNT(*) n FROM quotes').fetchone()['n']<10000,'quote_capacity')
   db.execute('INSERT INTO quotes VALUES(?,?)',(q['quoteId'],canonical(q)))
  return q
 def submit(self,body):
  require(isinstance(body,dict) and set(body)=={'requestId','quoteId','requestDigest','contractDigest','request'},'invalid_fields',400)
  identifier(body['requestId']);identifier(body['quoteId']);c=self.contract();rd=self.request(body['request'],c);require(body['requestDigest']==rd,'request_digest_mismatch')
  with self.connect() as db:
   db.execute('BEGIN IMMEDIATE');old=db.execute('SELECT * FROM submissions WHERE id=?',(body['requestId'],)).fetchone()
   if old:
    result=json.loads(old['data']);require(old['digest']==rd and old['quote_id']==body['quoteId'] and result['contractDigest']==body['contractDigest'],'request_conflict');return result
   row=db.execute('SELECT data FROM quotes WHERE id=?',(body['quoteId'],)).fetchone();require(row is not None,'quote_missing');q=json.loads(row['data'])
   require(q['requestDigest']==rd and q['contractDigest']==body['contractDigest']==c['digest'],'quote_mismatch');require(instant(q['expiresAt'])>time.time(),'quote_expired')
   require(c['billing']=={'mode':'fixed_krw','enforcement':'provider_fixed_krw','taxAndFeesIncluded':True},'krw_contract_required')
   used=db.execute('SELECT COALESCE(SUM(COALESCE(actual,reserved)),0) n FROM submissions').fetchone()['n'];require(used+q['maxChargeKrw']<=self.cap,'budget_exceeded')
   r={k:body[k] for k in ('requestId','quoteId','requestDigest','contractDigest')}
   r={**r,'schema':'collective.eval-receipt.v1','model':c['model'],'status':'unknown','settlement':'reserved','chargeKrw':None,'usage':None}
   db.execute('INSERT INTO submissions VALUES(?,?,?,?,?,?,?)',(body['requestId'],q['quoteId'],rd,'unknown',q['maxChargeKrw'],None,canonical(r)))
  try: return self.complete(r,q,self.provider.generate(body['request'],q,body['requestId']))
  except Exception: return r
 def complete(self,r,q,receipt):
  require(isinstance(receipt,dict),'invalid_receipt');cost=receipt.get('chargeKrw');usage=receipt.get('usage');text=receipt.get('output')
  if receipt.get('status')=='rejected':
   require(receipt.get('settlement')=='final' and cost==0,'invalid_rejection')
   final={**r,'status':'rejected','settlement':'final','chargeKrw':0,'usage':None}
  else:
   require(integer(cost,0,q['maxChargeKrw']) and isinstance(usage,dict) and set(usage)=={'inputTokens','outputTokens'},'receipt_over_cap')
   require(integer(usage['inputTokens'],0,q['maxInputTokens']) and integer(usage['outputTokens'],0,q['maxOutputTokens']),'usage_over_cap')
   require(isinstance(text,str) and len(text.encode())<=131072 and isinstance(receipt.get('providerRunId'),str),'invalid_output')
   final={**r,'status':'completed','settlement':'final','chargeKrw':cost,'usage':usage,'output':text,'providerRunId':receipt['providerRunId']}
  with self.connect() as db:
   db.execute("UPDATE submissions SET status=?,actual=?,data=? WHERE id=? AND status='unknown'",(final['status'],cost,canonical(final),r['requestId']))
   return json.loads(db.execute('SELECT data FROM submissions WHERE id=?',(r['requestId'],)).fetchone()['data'])
 def get(self,request_id):
  identifier(request_id)
  with self.connect() as db:
   row=db.execute('SELECT data,quote_id FROM submissions WHERE id=?',(request_id,)).fetchone();require(row is not None,'submission_missing',404);r=json.loads(row['data']);q=json.loads(db.execute('SELECT data FROM quotes WHERE id=?',(row['quote_id'],)).fetchone()['data'])
  if r['status']=='unknown':
   try:
    receipt=self.provider.recover(q,request_id)
    if receipt is not None:return self.complete(r,q,receipt)
   except Exception:pass
  return r
 def handle(self,method,path,headers,raw):
  try:
   require(hmac.compare_digest(headers.get('authorization',''),'Bearer '+self.token) and headers.get('x-collective-owner')==self.owner,'unauthorized',401);require(len(raw)<=MAX_BODY,'body_limit',413)
   with self.connect() as db:
    minute=int(time.time()//60);db.execute('INSERT INTO request_rate VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET n=n+1',(minute,));count=db.execute('SELECT n FROM request_rate WHERE bucket=?',(minute,)).fetchone()['n'];db.execute('DELETE FROM request_rate WHERE bucket<?',(minute-2,))
   require(count<=120,'rate_limit',429)
   if method=='GET':
    require(not raw,'unexpected_body',400)
    if path=='/v1/eval-contract':return 200,self.signed(method,path,self.contract())
    if path.startswith('/v1/eval-submissions/'):
     r=self.get(path.removeprefix('/v1/eval-submissions/'));return (200 if r['status']=='completed' else 202),self.signed(method,path,r)
   if method=='POST' and path in ('/v1/eval-quotes','/v1/eval-submissions'):
    require(headers.get('content-type','').split(';')[0]=='application/json','content_type',415);body=json.loads(raw,object_pairs_hook=unique_object);r=self.quote(body) if path.endswith('quotes') else self.submit(body);return (202 if r.get('status')=='unknown' else 200),self.signed(method,path,r)
   raise Error('not_found',404)
  except Error as e:return e.status,{'error':e.code}
  except Exception:return 400,{'error':'invalid_or_unavailable'}
