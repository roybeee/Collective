import sys, pathlib, sqlite3, contextlib, unittest, json, hashlib, hmac, uuid, time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts/mapdal'))
from catalog_adapter import MapdalCatalogStore, CatalogBridge, PATH
class AdapterTest(unittest.TestCase):
 def setUp(self):
  self.conn=sqlite3.connect(':memory:');self.conn.row_factory=sqlite3.Row;self.conn.executescript('CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,price INTEGER,soldout INTEGER,stock INTEGER); INSERT INTO products VALUES("mpd::1","상품",100,0,8);')
  outer=self
  class Cx:
   def exec(self,q,p=()):return outer.conn.execute(q,p)
   def one(self,q,p=()):
    r=self.exec(q,p).fetchone();return dict(r) if r else None
  @contextlib.contextmanager
  def db():
   with self.conn:yield Cx()
  self.store=MapdalCatalogStore(db,'tenant','shop',['mpd::1']);self.store.migrate();self.secret='test-only-not-real-signing-key-000000';self.bridge=CatalogBridge(self.store,self.secret,'tenant','shop')
 def request(self,nonce=None):
  self.now=int(time.time());self.nonce=nonce or str(uuid.uuid4());self.raw=json.dumps({'tenantId':'tenant','storeId':'shop','productId':'mpd::1'},separators=(',',':')).encode();self.headers={'x-collective-timestamp':str(self.now),'x-collective-nonce':self.nonce};self.headers['x-collective-signature']=hmac.new(self.secret.encode(),f'{self.now}\n{self.nonce}\nPOST\n{PATH}\n'.encode()+self.raw,hashlib.sha256).hexdigest();return self.bridge.handle('POST',PATH,self.headers,self.raw,self.now)
 def test_reads_actual_stock_without_writing_products(self):
  status,result=self.request();self.assertEqual(status,200);self.assertEqual(result['snapshot']['sellable'],8);self.assertEqual(self.conn.execute('SELECT stock FROM products').fetchone()[0],8)
 def test_null_stock_remains_unknown(self):
  self.conn.execute('UPDATE products SET stock=NULL');self.assertEqual(self.request()[1]['snapshot']['state'],'unknown')
 def test_missing_mapped_product_is_deleted(self):
  self.conn.execute('DELETE FROM products');self.assertEqual(self.request()[1]['snapshot']['state'],'deleted')
 def test_replay_rejected(self):
  self.request();self.assertEqual(self.request(self.nonce)[0],409)
 def test_response_signed_to_nonce_path(self):
  _,r=self.request();expected=hmac.new(self.secret.encode(),f'{self.now}\n{self.nonce}\n200\n{PATH}\n{r["snapshotJson"]}'.encode(),hashlib.sha256).hexdigest();self.assertEqual(r['signature'],expected)
 def test_bad_signature_is_rejected(self):
  self.request();self.headers['x-collective-signature']='0'*64;self.assertEqual(self.bridge.handle('POST',PATH,self.headers,self.raw,self.now)[0],401)
 def test_stale_signature_is_rejected(self):
  self.request();self.assertEqual(self.bridge.handle('POST',PATH,self.headers,self.raw,self.now+301)[0],401)
 def test_negative_stock_is_unknown(self):
  self.conn.execute('UPDATE products SET stock=-1');self.assertEqual(self.request()[1]['snapshot']['state'],'unknown')
if __name__=='__main__':unittest.main()
