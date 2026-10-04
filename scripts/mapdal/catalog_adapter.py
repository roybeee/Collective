"""Read-only real MAPDAL products adapter. Only additive nonce migration is performed.

products.stock is SELLABLE after checkout deductions, never physical on-hand.
Inject app.db; install explicitly. No product/price/stock updates exist here.
"""
import asyncio
import datetime as dt
import hashlib
import hmac
import json
import time
from bridge import ID, PRODUCT_ID, LandingBridge, Rejected, require, canonical
PATH = '/collective/v1/catalog/read'

class MapdalCatalogStore:
    def __init__(self, db, tenant, shop, products):
        require(ID.fullmatch(tenant) and ID.fullmatch(shop), 400, 'invalid_scope')
        require(0 < len(products) <= 500 and all(PRODUCT_ID.fullmatch(x) for x in products), 400, 'invalid_mapping')
        self.db,self.tenant,self.shop,self.products=db,tenant,shop,frozenset(products)
    def migrate(self):
        with self.db() as c:
            c.exec('SELECT id,name,price,soldout,stock FROM products LIMIT 0')
            c.exec('CREATE TABLE IF NOT EXISTS collective_catalog_nonce(tenant TEXT,store TEXT,nonce TEXT,at BIGINT,PRIMARY KEY(tenant,store,nonce))')
            c.exec('CREATE INDEX IF NOT EXISTS collective_catalog_nonce_rate ON collective_catalog_nonce(tenant,store,at)')
    def read(self, product, nonce, now):
        require(product in self.products, 403, 'product_not_mapped')
        with self.db() as c:
            require(c.one('SELECT nonce FROM collective_catalog_nonce WHERE tenant=? AND store=? AND nonce=?',(self.tenant,self.shop,nonce)) is None,409,'nonce_replayed')
            count=c.one('SELECT COUNT(*) n FROM collective_catalog_nonce WHERE tenant=? AND store=? AND at>=?',(self.tenant,self.shop,now-60))
            require(count['n']<120,429,'rate_limited')
            c.exec('INSERT INTO collective_catalog_nonce VALUES(?,?,?,?)',(self.tenant,self.shop,nonce,now))
            row=c.one('SELECT id,name,price,soldout,stock FROM products WHERE id=?',(product,))
        state,title,price,sellable='deleted','',None,None
        if row:
            title=row['name'] if isinstance(row['name'],str) and len(row['name'])<=500 else ''
            price=row['price'] if type(row['price']) is int and 0<=row['price']<=9007199254740991 else None
            stock=row['stock'] if type(row['stock']) is int and 0<=row['stock']<=9007199254740991 else None
            sellable=0 if row['soldout']==1 else stock if row['soldout']==0 else None
            state='active' if price is not None and sellable is not None and title else 'unknown'
        return {'tenantId':self.tenant,'storeId':self.shop,'productId':product,'state':state,'title':title,'price':price,'sellable':sellable,'unit':'piece','observedAt':dt.datetime.fromtimestamp(now,dt.timezone.utc).isoformat().replace('+00:00','Z')}

class CatalogBridge:
    def __init__(self,store,secret,tenant,shop):
        require(isinstance(secret,str) and len(secret.encode())>=32,400,'invalid_secret')
        self.store,self.secret,self.tenant,self.shop=store,secret.encode(),tenant,shop
    def handle(self,method,path,headers,raw,now=None):
        now=int(time.time()) if now is None else now
        try:
            require(method=='POST' and path==PATH,404,'unknown_path');require(len(raw)<=32768,413,'request_too_large')
            nonce,stamp=LandingBridge._authenticate(self,method,path,headers,raw,now)
            body=json.loads(raw.decode('utf-8'))
            require(isinstance(body,dict) and set(body)=={'tenantId','storeId','productId'},400,'invalid_request')
            require(body['tenantId']==self.tenant and body['storeId']==self.shop,403,'scope_denied')
            require(isinstance(body['productId'],str) and PRODUCT_ID.fullmatch(body['productId']),400,'invalid_product')
            snapshot=self.store.read(body['productId'],nonce,now);raw_snapshot=canonical(snapshot)
            signed=f'{stamp}\n{nonce}\n200\n{PATH}\n{raw_snapshot}'.encode()
            return 200,{'snapshot':snapshot,'snapshotJson':raw_snapshot,'signature':hmac.new(self.secret,signed,hashlib.sha256).hexdigest()}
        except Rejected as error:return error.status,{'status':'rejected','code':error.code}
        except (ValueError,TypeError,KeyError,UnicodeError):return 400,{'status':'rejected','code':'invalid_request'}

class CatalogASGI:
    def __init__(self,bridge):self.bridge=bridge
    async def __call__(self,scope,receive,send):
        if scope['type']!='http':return
        status,value=400,{'status':'rejected','code':'invalid_request'}
        try:
            pairs=[(k.decode('latin1').lower(),v.decode('latin1')) for k,v in scope.get('headers',[])];headers=dict(pairs)
            checked=['content-type','content-length','x-collective-timestamp','x-collective-nonce','x-collective-signature']
            if scope.get('query_string') or any(sum(k==name for k,_ in pairs)>1 for name in checked) or headers.get('content-type','').split(';')[0]!='application/json':raise ValueError()
            raw=bytearray();deadline=time.monotonic()+10
            while True:
                event=await asyncio.wait_for(receive(),max(0,deadline-time.monotonic()))
                if event['type']!='http.request':raise ValueError()
                raw.extend(event.get('body',b''))
                if len(raw)>32768:raise ValueError()
                if not event.get('more_body',False):break
            if 'content-length' in headers and int(headers['content-length'])!=len(raw):raise ValueError()
            status,value=await asyncio.to_thread(self.bridge.handle,scope['method'],scope['path'],headers,bytes(raw))
        except (ValueError,asyncio.TimeoutError):pass
        await send({'type':'http.response.start','status':status,'headers':[(b'content-type',b'application/json'),(b'cache-control',b'no-store')]})
        await send({'type':'http.response.body','body':canonical(value).encode()})
