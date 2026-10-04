"""MAPDAL member_inquiries actual column schema in temporary SQLite. No live replies."""
import contextlib
import hashlib
import hmac
import json
import pathlib
import sqlite3
import sys
import tempfile
import unittest
import uuid
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/mapdal'))
from cs_storage_adapter import MapdalCsStore
from cs_bridge import CsBridge
from consumer_bridge import payload_digest,iso,Rejected

class CsTest(unittest.TestCase):
    @contextlib.contextmanager
    def db(self):
        conn=sqlite3.connect(self.path);conn.row_factory=sqlite3.Row;conn.execute('BEGIN IMMEDIATE')
        class Cx:
            def exec(self,q,args=()):return conn.execute(q,args)
            def one(self,q,args=()):
                r=self.exec(q,args).fetchone();return dict(r) if r else None
            def all(self,q,args=()):return [dict(r) for r in self.exec(q,args).fetchall()]
        try:yield Cx();conn.commit()
        except Exception:conn.rollback();raise
        finally:conn.close()
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=str(pathlib.Path(self.tmp.name)/'shop.db');self.now=1800000000;self.allow=True;self.template=str(uuid.uuid4());self.text='문의하신 상품은 주문 상세 화면에서 확인하실 수 있습니다.';self.digest=hashlib.sha256(self.text.encode()).hexdigest()
        with self.db() as c:
            c.exec('CREATE TABLE member_inquiries(id TEXT PRIMARY KEY,member_id TEXT,order_id TEXT,title TEXT,body TEXT,created TEXT,status TEXT,answer TEXT,answered_at TEXT,answered_by TEXT,customer_id TEXT)')
            c.exec('CREATE TABLE customer_profiles(id TEXT PRIMARY KEY,status TEXT,withdrawn_at TEXT)')
            c.exec('CREATE TABLE orders(order_id TEXT PRIMARY KEY,customer_id TEXT,member_id TEXT,status TEXT)')
            c.exec("INSERT INTO customer_profiles VALUES('customer','ACTIVE',NULL)")
            c.exec("INSERT INTO orders VALUES('MD-20261004-A1B2C3','customer','member','REFUNDED')")
            c.exec('INSERT INTO member_inquiries VALUES(?,?,?,?,?,?,?,?,?,?,?)',('inquiry','member','MD-20261004-A1B2C3','RAW PRIVATE TITLE','RAW PRIVATE BODY',iso(self.now-60),'접수','','','','customer'))
        self.store=MapdalCsStore(self.db,False,'tenant','shop','mapdal',{self.template:self.text},authorize=lambda *a:self.allow);self.store.migrate();self.source=self.store.inbox('tenant','shop',None,50)['items'][0]
        self.request=str(uuid.uuid4());self.payload=dict(requestId=self.request,recipientId=self.source['customerId'],purpose='service_reply',templateId=self.template,templateDigest=self.digest,maxCostKrw=0,expiresAt=iso(self.now+3600),consentDigest='a'*64,serviceContext=dict(ticketId=self.source['id'],ticketVersion=1,sourceDigest=self.source['sourceDigest']));self.body=dict(requestId=self.request,payloadDigest=payload_digest(self.payload),payload=self.payload)
    def tearDown(self):self.tmp.cleanup()
    def send(self):return self.store.execute('send','tenant','shop',self.body,self.now)
    def test_source_has_uuid_mapping_and_no_raw_text(self):
        self.assertNotIn('RAW',str(self.source));self.assertEqual(self.store.inbox('tenant','shop',None,50)['items'][0]['id'],self.source['id']);self.assertEqual(self.source['status'],'open')
    def test_actual_answer_and_receipt_commit_together(self):
        self.assertEqual(self.send()['status'],'accepted');r=self.store.deliver('tenant','shop',self.request,self.now);self.assertEqual(r['status'],'delivered')
        with self.db() as c:q=c.one('SELECT * FROM member_inquiries')
        self.assertEqual(q['answer'],self.text);self.assertEqual(q['status'],'답변완료');self.assertEqual(q['body'],'RAW PRIVATE BODY');self.assertEqual(self.store.execute('receipt','tenant','shop',self.body,self.now)['receiptId'],r['receiptId']);self.assertEqual(self.send()['receiptId'],r['receiptId'])
    def test_direct_answer_change_is_not_overwritten(self):
        self.send()
        with self.db() as c:c.exec("UPDATE member_inquiries SET answer='manual answer',status='답변완료'")
        self.assertEqual(self.store.deliver('tenant','shop',self.request,self.now)['status'],'failed')
        with self.db() as c:self.assertEqual(c.one('SELECT answer FROM member_inquiries')['answer'],'manual answer')
    def test_withdraw_or_order_reassignment_blocks_reply(self):
        self.send()
        with self.db() as c:c.exec("UPDATE orders SET customer_id='other'")
        self.assertEqual(self.store.deliver('tenant','shop',self.request,self.now)['status'],'failed')
    def test_customer_withdraw_after_callback_blocks_atomic_publish(self):
        self.send()
        def revoke(*args):
            with self.db() as c:c.exec("UPDATE customer_profiles SET status='WITHDRAWN',withdrawn_at='withdrawn'")
            return True
        self.store.authorize=revoke;self.assertEqual(self.store.deliver('tenant','shop',self.request,self.now)['status'],'failed')
        with self.db() as c:self.assertEqual(c.one('SELECT answer FROM member_inquiries')['answer'],'')
    def test_authorization_missing_and_cancel_are_safe(self):
        self.send();self.store.authorize=None;self.assertIsNone(self.store.deliver('tenant','shop',self.request,self.now));self.assertEqual(self.store.execute('cancel','tenant','shop',self.body,self.now)['status'],'failed');self.assertIsNone(self.store.deliver('tenant','shop',self.request,self.now))
    def test_signed_gateway_inbox_and_service_payload(self):
        secret='synthetic-cs-service-key-00000000000000';app=CsBridge(self.store,secret,'tenant','shop',enabled=True)
        def call(action,value):
            body=json.dumps(dict(tenantId='tenant',storeId='shop',**value),separators=(',',':')).encode();nonce=str(uuid.uuid4());path='/collective/v1/cs/'+action;stamp=str(self.now)
            signature=hmac.new(secret.encode(),(stamp+'\n'+nonce+'\nPOST\n'+path+'\n').encode()+body,hashlib.sha256).hexdigest()
            return app.handle('POST',path,{'x-collective-timestamp':stamp,'x-collective-nonce':nonce,'x-collective-signature':signature},body,self.now)
        self.assertEqual(call('inbox',dict(cursor=None,limit=50))[0],200)
        self.assertEqual(call('send',self.body)[0],200)
        self.payload['phone']='01012345678';self.body['payloadDigest']=payload_digest(self.payload)
        self.assertEqual(call('send',self.body)[0],400)

    def test_intake_overflow_still_recovers_mapped_withdrawal(self):
        with self.db() as c:
            for n in range(2000):c.exec('INSERT INTO member_inquiries(id,customer_id) VALUES(?,?)',('overflow-'+str(n),'customer'))
            c.exec("UPDATE customer_profiles SET status='WITHDRAWN'")
        page=self.store.inbox('tenant','shop',None,50)
        self.assertTrue(page['intakeHeld']);self.assertEqual(page['items'][0]['status'],'withdrawn')
    def test_deleted_inquiry_is_failed_and_tombstoned(self):
        self.send()
        with self.db() as c:c.exec('DELETE FROM member_inquiries')
        self.assertEqual(self.store.deliver('tenant','shop',self.request,self.now)['status'],'failed')
        self.assertEqual(self.store.inbox('tenant','shop',None,50)['items'][0]['status'],'withdrawn')

    def test_changed_inquiry_order_preserves_old_binding_as_withdrawn(self):
        self.send()
        with self.db() as c:
            c.exec("INSERT INTO orders VALUES('MD-20261004-D4E5F6','customer','member','PAID')")
            c.exec("UPDATE member_inquiries SET order_id='MD-20261004-D4E5F6'")
        source=self.store.inbox('tenant','shop',None,50)['items'][0]
        self.assertEqual(source['status'],'withdrawn')
        self.assertEqual(source['externalOrderId'],self.source['externalOrderId'])
        self.assertEqual(self.store.deliver('tenant','shop',self.request,self.now)['status'],'failed')

    def test_arbitrary_recipient_mapping_is_rejected(self):
        self.payload['recipientId']=str(uuid.uuid4());self.body['payloadDigest']=payload_digest(self.payload)
        with self.assertRaises(Rejected):self.send()

if __name__=='__main__':unittest.main()
