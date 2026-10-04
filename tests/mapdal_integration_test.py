import asyncio
import contextlib
import json
import pathlib
import sqlite3
import sys
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts/mapdal'))
from integration import create_integration, validate_manifest

class IntegrationTest(unittest.TestCase):
    def setUp(self):
        self.conn=sqlite3.connect(':memory:',check_same_thread=False);self.conn.row_factory=sqlite3.Row
        self.conn.executescript("CREATE TABLE products(id TEXT PRIMARY KEY,descr TEXT,name TEXT,price INTEGER,soldout INTEGER,stock INTEGER); INSERT INTO products VALUES('mpd::1','original','상품',100,0,4);")
        outer=self
        class Cx:
            def exec(self,q,p=()):return outer.conn.execute(q,p)
            def one(self,q,p=()):
                r=self.exec(q,p).fetchone();return dict(r) if r else None
        @contextlib.contextmanager
        def db():
            with outer.conn:yield Cx()
        self.db=db;self.calls=[];self.ready=True
        async def host(scope,receive,send):
            self.calls.append(scope['type'])
            if scope['type']=='lifespan':
                await receive();await send({'type':'lifespan.startup.complete'});return
            await send({'type':'http.response.start','status':418,'headers':[]});await send({'type':'http.response.body','body':b'static fallback'})
        self.host=host
        self.env={'READINESS_KEY':'synthetic-ready-000000000000000000000','LANDING_KEY':'synthetic-landing-0000000000000000000','CATALOG_KEY':'synthetic-catalog-0000000000000000000'}
        self.manifest={'version':1,'tenantId':'tenant','storeId':'shop','products':['mpd::1'],'readinessTokenEnv':'READINESS_KEY','landing':{'enabled':True,'secretEnv':'LANDING_KEY','writeEnabled':False},'catalog':{'enabled':True,'secretEnv':'CATALOG_KEY'}}
    def tearDown(self):self.conn.close()
    def make(self,**kwargs):return create_integration(self.host,self.db,self.manifest,env=self.env,ready=lambda:self.ready,**kwargs)
    def request(self,app,path='/collective/v1/ready',headers=None,method='GET',body=b'{}'):
        async def run():
            events=[]
            async def receive():return {'type':'http.request','body':body}
            async def send(v):events.append(v)
            await app({'type':'http','path':path,'method':method,'headers':headers or [],'query_string':b''},receive,send)
            return events[0]['status'],events[1]['body']
        return asyncio.run(run())
    def auth(self):return [(b'authorization',('Bearer '+self.env['READINESS_KEY']).encode())]
    def test_same_origin_experiment_sdk_path_uses_production_factory(self):
        from integration import Capability
        seen=[]
        async def endpoint(scope,receive,send):
            seen.append(scope['path']);await send({'type':'http.response.start','status':202,'headers':[]});await send({'type':'http.response.body','body':b'{}'})
        self.manifest['experiment']={'enabled':True,'config':{}}
        app=self.make(experiment_factory=lambda *args:Capability(endpoint,lambda:None,lambda:None));app.migrate()
        self.assertEqual(self.request(app,'/collective/experiment/',method='POST')[0],202);self.assertEqual(seen,['/collective/experiment/'])
    def test_signed_catalog_uses_real_mapped_product_without_updates(self):
        import hashlib,hmac,time,uuid
        app=self.make();app.migrate();path='/collective/v1/catalog/read';stamp=str(int(time.time()));nonce=str(uuid.uuid4())
        body=json.dumps({'tenantId':'tenant','storeId':'shop','productId':'mpd::1'},separators=(',',':')).encode()
        signature=hmac.new(self.env['CATALOG_KEY'].encode(),f'{stamp}\n{nonce}\nPOST\n{path}\n'.encode()+body,hashlib.sha256).hexdigest()
        headers=[(b'content-type',b'application/json'),(b'x-collective-timestamp',stamp.encode()),(b'x-collective-nonce',nonce.encode()),(b'x-collective-signature',signature.encode())]
        status,raw=self.request(app,path,headers,'POST',body)
        self.assertEqual(status,200);self.assertEqual(json.loads(raw)['snapshot']['sellable'],4);self.assertEqual(self.conn.execute('SELECT stock FROM products').fetchone()[0],4)
    def test_unmigrated_new_store_scope_is_not_ready(self):
        app=self.make();app.migrate();self.manifest['storeId']='other'
        self.assertEqual(self.request(self.make(),headers=self.auth())[0],503)
    def test_construction_does_not_migrate_or_change_products(self):
        self.make();self.assertEqual(self.conn.execute("SELECT count(*) FROM sqlite_master WHERE name LIKE 'collective_%'").fetchone()[0],0);self.assertEqual(self.conn.execute('SELECT descr,stock FROM products').fetchone()[:],('original',4))
    def test_readiness_requires_authentication_and_redacts_secrets(self):
        app=self.make();self.assertEqual(self.request(app)[0],401);status,raw=self.request(app,headers=self.auth());self.assertEqual(status,503)
        for secret in list(self.env.values())+['mpd::1','tenant','shop']:self.assertNotIn(secret,raw.decode())
    def test_explicit_migration_is_idempotent_and_readiness_then_passes(self):
        app=self.make();app.migrate();app.migrate();self.assertEqual(self.request(app,headers=self.auth())[0],200);self.assertEqual(self.conn.execute('SELECT descr,stock FROM products').fetchone()[:],('original',4))
    def test_adapter_is_reached_before_host_static_catchall(self):
        app=self.make();app.migrate();self.assertEqual(self.request(app,'/collective/v1/catalog/read',method='POST')[0],400);self.assertEqual(self.calls,[])
    def test_unrelated_route_falls_back_to_original_host(self):
        self.assertEqual(self.request(self.make(),'/p/mpd::1')[0],418);self.assertEqual(self.calls,['http'])
    def test_unknown_collective_path_never_reaches_static_host(self):
        self.assertEqual(self.request(self.make(),'/collective/v1/not-configured')[0],404);self.assertEqual(self.calls,[])
    def test_host_not_ready_blocks_adapters(self):
        app=self.make();app.migrate();self.ready=False;self.assertEqual(self.request(app,'/collective/v1/catalog/read',method='POST')[0],503)
    def test_lifespan_is_forwarded_once(self):
        app=self.make();events=[]
        async def receive():return {'type':'lifespan.startup'}
        async def send(v):events.append(v)
        asyncio.run(app({'type':'lifespan'},receive,send));self.assertEqual(self.calls,['lifespan']);self.assertEqual(events,[{'type':'lifespan.startup.complete'}])
    def test_enabled_consumer_without_production_factory_fails_closed(self):
        self.manifest['consumer']={'enabled':True,'config':{}}
        with self.assertRaises(ValueError):self.make()
    def test_enabled_experiment_without_session_factory_fails_closed(self):
        self.manifest['experiment']={'enabled':True,'config':{}}
        with self.assertRaises(ValueError):self.make()
    def test_missing_secret_rejected_without_leaking_value(self):
        self.env.pop('LANDING_KEY')
        with self.assertRaisesRegex(ValueError,'configuration_invalid'):self.make()
    def test_unrecognized_and_ambiguous_configuration_rejected(self):
        for patch in [{'extra':True},{'products':['mpd::1','mpd::1']},{'tenantId':'../tenant'},{'landing':{'enabled':'true','secretEnv':'LANDING_KEY'}},{'readinessTokenEnv':'literal-secret'}]:
            with self.subTest(patch=patch),self.assertRaises(ValueError):validate_manifest({**self.manifest,**patch})
    def test_authenticated_readiness_rejects_duplicate_header(self):
        self.assertEqual(self.request(self.make(),headers=self.auth()+self.auth())[0],401)
    def test_disabled_capability_cannot_fall_through_to_host(self):
        self.manifest['catalog']={'enabled':False};app=self.make();app.migrate();self.assertEqual(self.request(app,'/collective/v1/catalog/read',method='POST')[0],404)


class InstallCommandTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.temp=tempfile.TemporaryDirectory();self.path=pathlib.Path(self.temp.name)/'manifest.json'
        self.manifest={'version':1,'tenantId':'tenant','storeId':'shop','products':[],'readinessTokenEnv':'READY_KEY'}
        self.path.write_text(json.dumps(self.manifest))
    def tearDown(self):self.temp.cleanup()
    def invoke(self,*args):
        import io
        import install
        output=io.StringIO()
        with contextlib.redirect_stdout(output):code=install.main([*args,'--manifest',str(self.path)])
        return code,json.loads(output.getvalue())
    def test_plan_never_imports_factory_or_looks_up_credentials(self):
        code,value=self.invoke('plan','--factory','module_does_not_exist:create')
        self.assertEqual(code,0);self.assertEqual(value['database'],'not_accessed');self.assertEqual(value['network'],'not_called')
    def test_migrate_requires_explicit_switch_before_import(self):
        code,value=self.invoke('migrate','--factory','module_does_not_exist:create')
        self.assertEqual(code,1);self.assertEqual(value,{'status':'unavailable','code':'installation_check_failed'})
    def test_duplicate_manifest_keys_rejected(self):
        self.path.write_text('{"version":1,"version":1}')
        self.assertEqual(self.invoke('plan')[0],1)
    def test_manifest_error_output_has_no_paths_or_secrets(self):
        self.path.write_text('synthetic-sensitive-fixture')
        _,value=self.invoke('plan');raw=json.dumps(value)
        self.assertNotIn(self.temp.name,raw);self.assertNotIn('synthetic-sensitive-fixture',raw)
    def test_verify_rejects_redirect_and_arbitrary_origin(self):
        import install
        with self.assertRaises(ValueError):install.NoRedirect().redirect_request(None,None,302,None,None,'https://evil.example')
        with self.assertRaises(ValueError):install.verify_remote('https://evil.example',self.manifest,{})
    def test_verify_requires_exact_enabled_capability_set(self):
        from unittest.mock import patch
        import install
        class Reply:
            status=200
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def read(self,n):return json.dumps({'status':'ready','capabilities':{name:'ready' for name in install.SECTIONS}}).encode()
        class Opener:
            def open(self,*args,**kwargs):return Reply()
        with patch.object(install.urllib.request,'build_opener',return_value=Opener()),self.assertRaises(ValueError):install.verify_remote('https://mapdal.kr',self.manifest,{'READY_KEY':'synthetic-ready-key-00000000000000000'})

class OrderScopeTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.temp=tempfile.TemporaryDirectory();self.path=pathlib.Path(self.temp.name)/'orders.db'
        self.env={'READY_KEY':'synthetic-ready-key-000000000000000','ORDERS_KEY':'synthetic-orders-key-000000000000000'}
        self.manifest={'version':1,'tenantId':'tenant','storeId':'shop','products':[],'readinessTokenEnv':'READY_KEY','orders':{'enabled':True,'outbox':str(self.path),'tokenEnv':'ORDERS_KEY'}}
        async def host(*args):raise AssertionError('orders must not reach host')
        self.host=host
    def tearDown(self):self.temp.cleanup()
    def make(self,store='shop'):
        return create_integration(self.host,lambda:None,{**self.manifest,'storeId':store},env=self.env)
    def test_order_readiness_closes_sqlite_connection_on_success_and_failure(self):
        from unittest.mock import patch
        import integration
        app=self.make();app.migrate();opened=[];connect=sqlite3.connect
        def tracked(*args,**kwargs):
            db=connect(*args,**kwargs);opened.append(db);return db
        with patch.object(integration.sqlite3,'connect',side_effect=tracked):
            self.assertEqual(app.check()['status'],'ready')
            self.assertEqual(self.make('other').check()['status'],'unavailable')
        try:
            for db in opened:
                with self.assertRaises(sqlite3.ProgrammingError):db.execute('SELECT 1')
        finally:
            for db in opened:db.close()
    def test_empty_outbox_is_pinned_once_and_other_store_is_rejected(self):
        a=self.make();self.assertEqual(a.migrate()['status'],'ready');self.assertEqual(a.migrate()['status'],'ready')
        b=self.make('other');self.assertEqual(b.check()['status'],'unavailable')
        with self.assertRaises(ValueError):b.migrate()
        with contextlib.closing(sqlite3.connect(self.path)) as db, db:self.assertEqual(dict(db.execute('SELECT key,value FROM scope'))['collective_store'],'shop')
    def test_populated_legacy_outbox_is_never_adopted(self):
        from adapter import Outbox
        box=Outbox(str(self.path));box.db.execute('INSERT INTO outbox VALUES(?,?,?,?,?)',('old',1,'digest','{}',0));box.db.commit();box.close()
        with self.assertRaises(ValueError):self.make().migrate()
        with contextlib.closing(sqlite3.connect(self.path)) as db, db:self.assertEqual(db.execute('SELECT count(*) FROM scope').fetchone()[0],0);self.assertEqual(db.execute('SELECT count(*) FROM outbox').fetchone()[0],1)
    def test_legacy_endpoint_binding_is_not_silently_reassigned(self):
        from adapter import Outbox
        box=Outbox(str(self.path));box.db.execute('INSERT INTO scope VALUES(?,?)',('endpoint','https://previous.example'));box.db.commit();box.close()
        with self.assertRaises(ValueError):self.make().migrate()
    def test_http_read_rechecks_scope_in_the_same_database_transaction(self):
        from order_pull import OrderPull
        self.make().migrate();pull=OrderPull(str(self.path),self.env['ORDERS_KEY'],expected_scope=('tenant','shop'))
        self.assertEqual(pull.handle('GET','/collective/v1/orders','limit=100',{'authorization':'Bearer '+self.env['ORDERS_KEY']})[0],200)
        with contextlib.closing(sqlite3.connect(self.path)) as db, db:db.execute("UPDATE scope SET value='other' WHERE key='collective_store'")
        self.assertEqual(pull.handle('GET','/collective/v1/orders','limit=100',{'authorization':'Bearer '+self.env['ORDERS_KEY']})[0],503)
    def test_missing_scope_blocks_http_even_with_valid_token(self):
        from adapter import Outbox
        from order_pull import OrderPull
        box=Outbox(str(self.path));box.close();pull=OrderPull(str(self.path),self.env['ORDERS_KEY'],expected_scope=('tenant','shop'))
        self.assertEqual(pull.handle('GET','/collective/v1/orders','limit=100',{'authorization':'Bearer '+self.env['ORDERS_KEY']})[0],503)

if __name__=='__main__':unittest.main()
