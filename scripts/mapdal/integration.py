"""Compose installed adapters before the shop's catch-all ASGI application.

Construction does not migrate or send. Pass app.db/Cx, and the original ASGI
application (including its lifespan). Production factories must also be inert.
"""
import asyncio
from contextlib import closing
from dataclasses import dataclass
import hashlib
import hmac
import json
import os
import pathlib
import re
import sqlite3
from bridge import ID, PRODUCT_ID, LandingBridge
from storage_adapter import MapdalLandingStore
from asgi_adapter import LandingASGI
from catalog_adapter import MapdalCatalogStore, CatalogBridge, CatalogASGI
from order_pull import OrderPull, OrderPullASGI

READY_PATH='/collective/v1/ready'
ENV_NAME=re.compile(r'[A-Z][A-Z0-9_]{2,100}')
SECTIONS={'landing','catalog','orders','cs','consumer','experiment'}


def invalid():
    raise ValueError('configuration_invalid')


def validate_manifest(value):
    if not isinstance(value,dict) or set(value)-({'version','tenantId','storeId','products','readinessTokenEnv'}|SECTIONS):invalid()
    if type(value.get('version')) is not int or value['version']!=1:invalid()
    for name in ['tenantId','storeId']:
        if not isinstance(value.get(name),str) or not ID.fullmatch(value[name]):invalid()
    products=value.get('products',[])
    if not isinstance(products,list) or len(products)>500 or any(not isinstance(p,str) or not PRODUCT_ID.fullmatch(p) for p in products) or len(set(products))!=len(products):invalid()
    if not isinstance(value.get('readinessTokenEnv'),str) or not ENV_NAME.fullmatch(value['readinessTokenEnv']):invalid()
    allowed={'landing':{'enabled','secretEnv','writeEnabled'},'catalog':{'enabled','secretEnv'},'orders':{'enabled','tokenEnv','outbox'},'cs':{'enabled','config'},'consumer':{'enabled','config'},'experiment':{'enabled','config'}}
    for name in SECTIONS:
        section=value.get(name,{'enabled':False})
        if not isinstance(section,dict) or set(section)-allowed[name] or type(section.get('enabled')) is not bool:invalid()
        if 'writeEnabled' in section and type(section['writeEnabled']) is not bool:invalid()
        for key in ['secretEnv','tokenEnv']:
            if key in section and (not isinstance(section[key],str) or not ENV_NAME.fullmatch(section[key])):invalid()
        if 'config' in section and not isinstance(section['config'],dict):invalid()
        if not section['enabled']:continue
        if name in {'landing','catalog'} and (not products or 'secretEnv' not in section):invalid()
        if name=='orders':
            if 'tokenEnv' not in section or not isinstance(section.get('outbox'),str) or not pathlib.Path(section['outbox']).is_absolute():invalid()
        if name in {'cs','consumer','experiment'} and 'config' not in section:invalid()
    # Copy caller-owned containers: a later UI edit must not mutate installed scope.
    return json.loads(json.dumps(value,allow_nan=False))


def secret(env,name):
    value=env.get(name,'')
    if not isinstance(value,str) or not 32<=len(value.encode())<=2000 or any(c.isspace() for c in value):invalid()
    return value


@dataclass(frozen=True)
class Capability:
    app: object
    check: object
    migrate: object


def schema_check(db,queries,scope=None):
    def check():
        with db() as cx:
            for query in queries:cx.exec(query)
            if scope is not None and not cx.one('SELECT tenant FROM collective_landing_scope WHERE tenant=? AND store=?',scope):raise ValueError('scope_not_installed')
    return check


def _orders(section,env,tenant,shop):
    path=pathlib.Path(section['outbox']);token=secret(env,section['tokenEnv'])
    def check():
        resolved=path.resolve(strict=True)
        with closing(sqlite3.connect(resolved.as_uri()+'?mode=ro',uri=True,timeout=2)) as cx:
            cx.execute('SELECT order_id,revision,digest,body,sent FROM outbox LIMIT 0')
            cx.execute('SELECT order_id FROM holds LIMIT 0')
            scope=dict(cx.execute('SELECT key,value FROM scope'))
            if (scope.get('collective_tenant'),scope.get('collective_store'))!=(tenant,shop):raise ValueError('outbox_scope_mismatch')
    def migrate():
        from adapter import Outbox
        box=Outbox(str(path))
        try:
            with box.db as cx:
                cx.execute('BEGIN IMMEDIATE')
                scope=dict(cx.execute('SELECT key,value FROM scope'))
                bound=(scope.get('collective_tenant'),scope.get('collective_store'))
                if bound==(tenant,shop):return
                if scope or cx.execute('SELECT 1 FROM outbox LIMIT 1').fetchone() or cx.execute('SELECT 1 FROM holds LIMIT 1').fetchone():raise ValueError('outbox_scope_mismatch')
                cx.executemany('INSERT INTO scope(key,value) VALUES(?,?)',[('collective_tenant',tenant),('collective_store',shop)])
        finally:box.close()
    # One cached wrapper preserves its rate limit across requests; initialize only
    # after explicit schema installation, never during factory construction.
    cached=[]
    async def stable_app(scope,receive,send):
        if not cached:cached.append(OrderPullASGI(OrderPull(path,token,expected_scope=(tenant,shop))))
        await cached[0](scope,receive,send)
    return Capability(stable_app,check,migrate)


async def response(send,status,value):
    await send({'type':'http.response.start','status':status,'headers':[(b'content-type',b'application/json'),(b'cache-control',b'no-store'),(b'x-content-type-options',b'nosniff')]})
    await send({'type':'http.response.body','body':json.dumps(value,separators=(',',':')).encode()})


class Integration:
    def __init__(self,host,capabilities,token,ready):
        self.host,self.capabilities,self.ready=host,dict(capabilities),ready
        self.token_hash=hashlib.sha256(token.encode()).digest()
    def check(self,require_ready=True):
        statuses={name:'disabled' for name in sorted(SECTIONS)}
        try:host_ready=bool(self.ready()) if require_ready else True
        except Exception:host_ready=False
        for name,capability in self.capabilities.items():
            try:
                if not host_ready:raise ValueError()
                capability.check();statuses[name]='ready'
            except Exception:statuses[name]='unavailable'
        return {'status':'ready' if host_ready and all(v!='unavailable' for v in statuses.values()) else 'unavailable','capabilities':statuses}
    def migrate(self):
        # Only invoked explicitly by the installation command. Every underlying
        # migration checks host tables and adds its own namespaced tables.
        for capability in self.capabilities.values():capability.migrate()
        return self.check(require_ready=False)
    async def __call__(self,scope,receive,send):
        if scope['type']!='http':return await self.host(scope,receive,send)
        path=scope.get('path','')
        if not path.startswith('/collective/v1/') and path not in {'/collective/experiment','/collective/experiment/'}:return await self.host(scope,receive,send)
        if path==READY_PATH:
            headers=[v for k,v in scope.get('headers',[]) if k.lower()==b'authorization']
            candidate=headers[0][7:] if len(headers)==1 and headers[0].startswith(b'Bearer ') else b''
            if not hmac.compare_digest(hashlib.sha256(candidate).digest(),self.token_hash):return await response(send,401,{'status':'unauthorized'})
            if scope.get('method')!='GET' or scope.get('query_string'):return await response(send,400,{'status':'invalid_request'})
            result=await asyncio.to_thread(self.check)
            return await response(send,200 if result['status']=='ready' else 503,result)
        name=next((name for name in self.capabilities if (path.startswith('/collective/v1/'+name+'/') if name in {'landing','cs','consumer'} else path in {'/collective/experiment','/collective/experiment/'} if name=='experiment' else path=={'catalog':'/collective/v1/catalog/read','orders':'/collective/v1/orders'}[name])),None)
        if not name:return await response(send,404,{'status':'not_found'})
        try:
            if not self.ready():raise ValueError()
            await asyncio.to_thread(self.capabilities[name].check)
        except Exception:return await response(send,503,{'status':'unavailable'})
        # Adapter owns authentication and request limits. No exception details or
        # host/customer data cross this boundary when storage is unavailable.
        started=False
        async def tracked_send(event):
            nonlocal started
            if event['type']=='http.response.start':started=True
            await send(event)
        try:return await self.capabilities[name].app(scope,receive,tracked_send)
        except Exception:
            if started:raise
            return await response(send,503,{'status':'unavailable'})


def create_integration(host_app,db,manifest,*,is_pg=False,ready=lambda:True,env=None,consumer_factory=None,experiment_factory=None,cs_factory=None):
    manifest=validate_manifest(manifest);env=os.environ if env is None else env
    token=secret(env,manifest['readinessTokenEnv']);tenant,shop=manifest['tenantId'],manifest['storeId'];caps={}
    for name in ['landing','catalog','orders','cs','consumer','experiment']:
        section=manifest.get(name,{'enabled':False})
        if not section['enabled']:continue
        if name=='landing':
            store=MapdalLandingStore(db,is_pg,tenant,shop,{p:p for p in manifest['products']})
            scopes={'landing:read'}|({'landing:write'} if section.get('writeEnabled') else set())
            app=LandingASGI(LandingBridge(store,secret(env,section['secretEnv']),tenant,shop,scopes))
            queries=['SELECT id,descr FROM products LIMIT 0','SELECT tenant,store FROM collective_landing_scope LIMIT 0','SELECT product,real_id,version,fields_digest FROM collective_landing_state LIMIT 0','SELECT nonce,at FROM collective_landing_nonces LIMIT 0','SELECT request,body_digest,receipt,before_snapshot FROM collective_landing_receipts LIMIT 0']
            caps[name]=Capability(app,schema_check(db,queries,(tenant,shop)),store.migrate)
        elif name=='catalog':
            store=MapdalCatalogStore(db,tenant,shop,manifest['products'])
            caps[name]=Capability(CatalogASGI(CatalogBridge(store,secret(env,section['secretEnv']),tenant,shop)),schema_check(db,['SELECT id,name,price,soldout,stock FROM products LIMIT 0','SELECT tenant,store,nonce,at FROM collective_catalog_nonce LIMIT 0']),store.migrate)
        elif name=='orders':caps[name]=_orders(section,env,tenant,shop)
        else:
            factory={'cs':cs_factory,'consumer':consumer_factory,'experiment':experiment_factory}[name]
            if not callable(factory):invalid()
            cap=factory(db,is_pg,{**section['config'],'tenantId':tenant,'storeId':shop},env)
            if not isinstance(cap,Capability) or not all(callable(v) for v in [cap.app,cap.check,cap.migrate]):invalid()
            caps[name]=cap
    return Integration(host_app,caps,token,ready)
