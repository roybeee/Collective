"""Service-only MAPDAL member_inquiries adapter. Actual answer + receipt are one transaction.

Inject app.db/app.IS_PG. Installation is explicit; no live DB or sends at import.
Inquiry/customer UUIDs originate here after current customer/order ownership checks.
"""
import datetime as dt
import hashlib
import json
import re
import time
import uuid
from consumer_bridge import UUID,HEX,ID,iso,dumps,payload_digest,require,SQLiteConsumerStore

class MapdalCsStore:
    def __init__(self, db, is_pg, tenant, shop, source_key, templates, authorize=None):
        require(ID.fullmatch(tenant) and ID.fullmatch(shop) and re.fullmatch(r'[a-z0-9][a-z0-9_-]{1,39}',source_key))
        require(templates and all(UUID.fullmatch(k) and isinstance(v,str) and 1<=len(v)<=2000 for k,v in templates.items()))
        self.db,self.lock,self.tenant,self.shop,self.source_key,self.templates,self.authorize=db,' FOR UPDATE' if is_pg else '',tenant,shop,source_key,dict(templates),authorize
    def migrate(self):
        with self.db() as c:
            c.exec('SELECT id,member_id,customer_id,order_id,title,body,created,status,answer,answered_at,answered_by FROM member_inquiries LIMIT 0')
            c.exec('SELECT order_id,customer_id,member_id FROM orders LIMIT 0');c.exec('SELECT id,status,withdrawn_at FROM customer_profiles LIMIT 0')
            for sql in [
                'CREATE TABLE IF NOT EXISTS collective_cs_scope(tenant TEXT,store TEXT,PRIMARY KEY(tenant,store))',
                'CREATE TABLE IF NOT EXISTS collective_cs_customer(tenant TEXT,store TEXT,customer_id TEXT,customer_uuid TEXT,PRIMARY KEY(tenant,store,customer_id),UNIQUE(tenant,store,customer_uuid))',
                'CREATE TABLE IF NOT EXISTS collective_cs_inquiry(tenant TEXT,store TEXT,inquiry_id TEXT,inquiry_uuid TEXT,customer_id TEXT,customer_uuid TEXT,order_id TEXT,received_at TEXT,PRIMARY KEY(tenant,store,inquiry_id),UNIQUE(tenant,store,inquiry_uuid))',
                'CREATE TABLE IF NOT EXISTS collective_cs_nonce(tenant TEXT,store TEXT,nonce TEXT,at BIGINT,PRIMARY KEY(tenant,store,nonce))',
                'CREATE TABLE IF NOT EXISTS collective_cs_outbox(tenant TEXT,store TEXT,id TEXT,digest TEXT,payload TEXT,status TEXT,receipt TEXT,PRIMARY KEY(tenant,store,id))']:
                c.exec(sql)
            c.exec('INSERT INTO collective_cs_scope VALUES(?,?) ON CONFLICT(tenant,store) DO NOTHING',(self.tenant,self.shop))
    def _scope(self,c,tenant,store):
        require(tenant==self.tenant and store==self.shop,403,'scope_denied');require(c.one('SELECT tenant FROM collective_cs_scope WHERE tenant=? AND store=?'+self.lock,(tenant,store)),503,'not_installed')
    def nonce(self,tenant,store,nonce,now):
        with self.db() as c:
            self._scope(c,tenant,store);require(not c.one('SELECT nonce FROM collective_cs_nonce WHERE tenant=? AND store=? AND nonce=?',(tenant,store,nonce)),409,'nonce_replay')
            count=c.one('SELECT COUNT(*) n FROM collective_cs_nonce WHERE tenant=? AND store=? AND at>?',(tenant,store,now-60));require(count['n']<120,429,'rate_limited');c.exec('INSERT INTO collective_cs_nonce VALUES(?,?,?,?)',(tenant,store,nonce,now))
    def _basis(self,c,m):
        q=c.one('SELECT * FROM member_inquiries WHERE id=?'+self.lock,(m['inquiry_id'],))
        if not q:return dict(id=m['inquiry_uuid'],customerId=m['customer_uuid'],sourceKey=self.source_key,externalOrderId=m['order_id'],sourceDigest=hashlib.sha256(dumps({'deleted':m['inquiry_uuid']}).encode()).hexdigest(),receivedAt=m['received_at'],status='withdrawn',category='product_question')
        order=c.one('SELECT order_id,customer_id,member_id FROM orders WHERE order_id=?'+self.lock,(q['order_id'],));customer=c.one('SELECT id,status,withdrawn_at FROM customer_profiles WHERE id=?'+self.lock,(m['customer_id'],))
        own=bool(q['order_id']==m.get('order_id',q['order_id']) and order and customer and customer['status']=='ACTIVE' and not customer['withdrawn_at'] and q['customer_id']==m['customer_id'] and order['customer_id']==m['customer_id'] and q['member_id'] and order['member_id']==q['member_id'])
        status='withdrawn' if not own or q['status'] in {'취소','철회','삭제'} else 'closed' if q['answer'] or q['status']=='답변완료' else 'open'
        # Full original fields influence CAS, but only their digest leaves the provider.
        digest=hashlib.sha256(dumps({'inquiry':q,'order':order,'customer':customer}).encode()).hexdigest()
        created=dt.datetime.fromisoformat(q['created'].replace('Z','+00:00'))
        if created.tzinfo is None:created=created.replace(tzinfo=dt.timezone(dt.timedelta(hours=9)))
        return dict(id=m['inquiry_uuid'],customerId=m['customer_uuid'],sourceKey=self.source_key,externalOrderId=m.get('order_id',q['order_id']),sourceDigest=digest,receivedAt=iso(created.timestamp()),status=status,category='product_question')
    def inbox(self,tenant,store,cursor,limit):
        require(cursor is None or isinstance(cursor,str) and UUID.fullmatch(cursor));require(type(limit) is int and 1<=limit<=50)
        with self.db() as c:
            self._scope(c,tenant,store);rows=c.all('SELECT id,customer_id,order_id,member_id FROM member_inquiries ORDER BY id LIMIT 2001');intake_held=len(rows)>2000
            for q in ([] if intake_held else rows):
                if not q['customer_id'] or not re.fullmatch(r'MD-\d{8}-[A-F0-9]{6}',q['order_id'] or ''):continue
                if c.one('SELECT inquiry_uuid FROM collective_cs_inquiry WHERE tenant=? AND store=? AND inquiry_id=?',(tenant,store,q['id'])):continue
                candidate={'inquiry_id':q['id'],'inquiry_uuid':str(uuid.uuid4()),'customer_id':q['customer_id'],'customer_uuid':str(uuid.uuid4())}
                basis=self._basis(c,candidate)
                if basis['status']=='withdrawn':continue
                customer=c.one('SELECT customer_uuid FROM collective_cs_customer WHERE tenant=? AND store=? AND customer_id=?',(tenant,store,q['customer_id']))
                if customer:candidate['customer_uuid']=customer['customer_uuid']
                else:c.exec('INSERT INTO collective_cs_customer VALUES(?,?,?,?)',(tenant,store,q['customer_id'],candidate['customer_uuid']))
                c.exec('INSERT INTO collective_cs_inquiry VALUES(?,?,?,?,?,?,?,?)',(tenant,store,q['id'],candidate['inquiry_uuid'],q['customer_id'],candidate['customer_uuid'],q['order_id'],basis['receivedAt']))
            mappings=c.all('SELECT * FROM collective_cs_inquiry WHERE tenant=? AND store=? AND inquiry_uuid>? ORDER BY inquiry_uuid LIMIT ?',(tenant,store,cursor or '',limit+1))
            items=[self._basis(c,m) for m in mappings[:limit]]
            return {'items':items,'nextCursor':items[-1]['id'] if len(mappings)>limit else None,'intakeHeld':intake_held}
    def _eligible(self,c,p,now):
        if p.get('purpose')!='service_reply' or p.get('maxCostKrw')!=0:return False
        ref=p.get('serviceContext') or {};m=c.one('SELECT * FROM collective_cs_inquiry WHERE tenant=? AND store=? AND inquiry_uuid=?',(self.tenant,self.shop,ref.get('ticketId')))
        if not m or m['customer_uuid']!=p['recipientId']:return False
        source=self._basis(c,m);text=self.templates.get(p['templateId']);expiry=dt.datetime.fromisoformat(p['expiresAt'].replace('Z','+00:00')).timestamp()
        return bool(source['status']=='open' and source['sourceDigest']==ref.get('sourceDigest') and text and hashlib.sha256(text.encode()).hexdigest()==p['templateDigest'] and expiry>now)
    def _row(self,c,tenant,store,request):return c.one('SELECT * FROM collective_cs_outbox WHERE tenant=? AND store=? AND id=?'+self.lock,(tenant,store,request))
    def _receipt(self,row,status,now,code=None):return SQLiteConsumerStore._receipt(row['id'],row['digest'],status,0 if status!='accepted' else None,now,code)
    def execute(self,action,tenant,store,body,now):
        with self.db() as c:
            self._scope(c,tenant,store);row=self._row(c,tenant,store,body['requestId'])
            if row:require(row['digest']==body['payloadDigest'],409,'request_conflict')
            if action=='send':
                if row:return json.loads(row['receipt']) if row['receipt'] else None
                require(body['payloadDigest']==payload_digest(body['payload']) and self._eligible(c,body['payload'],now),409,'current_inquiry_required')
                receipt=SQLiteConsumerStore._receipt(body['requestId'],body['payloadDigest'],'accepted',None,now)
                c.exec('INSERT INTO collective_cs_outbox VALUES(?,?,?,?,?,?,?)',(tenant,store,body['requestId'],body['payloadDigest'],dumps(body['payload']),'accepted',dumps(receipt)));return receipt
            if not row:return None
            if action=='cancel' and row['status']=='accepted':
                receipt=self._receipt(row,'failed',now,'cancelled');c.exec("UPDATE collective_cs_outbox SET status='failed',payload='{}',receipt=? WHERE tenant=? AND store=? AND id=?",(dumps(receipt),tenant,store,row['id']));return receipt
            return json.loads(row['receipt']) if row['receipt'] else None
    def deliver_pending(self,limit=10):
        # Invoke from the provider's scheduled worker; accepted is never reported delivered here by assumption.
        require(type(limit) is int and 1<=limit<=10)
        with self.db() as c:
            self._scope(c,self.tenant,self.shop)
            rows=c.all("SELECT id FROM collective_cs_outbox WHERE tenant=? AND store=? AND status='accepted' ORDER BY id LIMIT ?",(self.tenant,self.shop,limit))
        completed=0
        for row in rows:
            try:result=self.deliver(self.tenant,self.shop,row['id'],int(time.time()))
            except Exception:continue
            if result and result['status'] in {'delivered','failed'}:completed+=1
        return {'attempted':len(rows),'completed':completed}
    def deliver(self,tenant,store,request,now):
        # Authorize without a provider DB lock; then CAS every source field in the publish transaction.
        with self.db() as c:
            self._scope(c,tenant,store);row=self._row(c,tenant,store,request)
            if not row or row['status']!='accepted':return None
        try:allowed=self.authorize(tenant,store,request,row['digest'],now) if self.authorize else None
        except Exception:allowed=None
        if allowed is None:return None
        with self.db() as c:
            self._scope(c,tenant,store);current=self._row(c,tenant,store,request)
            if not current or current['status']!='accepted':return None
            p=json.loads(current['payload'])
            if allowed is not True or not self._eligible(c,p,now):receipt=self._receipt(current,'failed',now,'rejected')
            else:
                mapping=c.one('SELECT inquiry_id FROM collective_cs_inquiry WHERE tenant=? AND store=? AND inquiry_uuid=?',(tenant,store,p['serviceContext']['ticketId']))
                c.exec("UPDATE member_inquiries SET answer=?,status='답변완료',answered_at=?,answered_by=? WHERE id=?",(self.templates[p['templateId']],iso(now),'Collective service adapter',mapping['inquiry_id']))
                receipt=self._receipt(current,'delivered',now)
            # Same transaction: process crash cannot publish an answer without a durable receipt.
            c.exec("UPDATE collective_cs_outbox SET status=?,payload='{}',receipt=? WHERE tenant=? AND store=? AND id=?",(receipt['status'],dumps(receipt),tenant,store,request));return receipt
